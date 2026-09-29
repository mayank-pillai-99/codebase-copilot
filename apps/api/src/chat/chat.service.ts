import type {
  ChatCitation,
  ChatEvent,
  ChatMessageDto,
  ChatSessionSummary,
} from '@codebase-copilot/shared';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../lib/errors';
import type { PrismaClient } from '../lib/prisma';
import { ChatModelError, type ChatModel } from '../llm/chat-model';
import type { RetrievedChunk, Retriever } from '../retrieval/types';
import { findVisibleSnapshot, isUuid } from '../services/snapshot-access';
import { checkCitations } from './citations';
import { buildPrompt, selectSources } from './prompt';

export interface PreparedChat {
  sessionId: string;
  snapshotId: string;
  question: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}

export interface ChatService {
  /** Validates access and records the question. Throws AppError before any streaming starts. */
  prepare(input: {
    userId: string;
    snapshotId: string;
    sessionId?: string | undefined;
    message: string;
  }): Promise<PreparedChat>;
  /** Streams the answer as events. Never throws; failures become an `error` event. */
  answer(
    prepared: PreparedChat,
    emit: (event: ChatEvent) => void,
    signal: AbortSignal,
  ): Promise<void>;
  listSessions(userId: string, snapshotId: string): Promise<ChatSessionSummary[]>;
  getSession(
    userId: string,
    sessionId: string,
  ): Promise<{ session: ChatSessionSummary & { snapshotId: string }; messages: ChatMessageDto[] }>;
}

const NO_SOURCES_ANSWER =
  "I couldn't find code related to that question in this repository. Try naming a file, function or feature.";
// Short follow-ups ("and where is it called?") need the previous question to retrieve well.
const FOLLOW_UP_WORDS = 12;

export function createChatService(deps: {
  prisma: PrismaClient;
  retriever: Retriever;
  /** Null when no AI key is configured. */
  model: ChatModel | null;
  logger: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  k?: number;
  historyMessages?: number;
}): ChatService {
  const { prisma, retriever, model, logger } = deps;
  const k = deps.k ?? 8;
  const historyMessages = deps.historyMessages ?? 6;

  async function saveAnswer(input: {
    sessionId: string;
    content: string;
    flagged: boolean;
    latencyMs: number;
    citations: { marker: number; chunk: RetrievedChunk }[];
  }) {
    const message = await prisma.chatMessage.create({
      data: {
        sessionId: input.sessionId,
        role: 'assistant',
        content: input.content,
        flagged: input.flagged,
        retriever: retriever.name,
        latencyMs: input.latencyMs,
        citations: {
          create: input.citations.map(({ marker, chunk }) => ({
            marker,
            chunkId: chunk.chunkId,
            fileId: chunk.fileId,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            label: chunk.label,
          })),
        },
      },
    });
    await prisma.chatSession.update({
      where: { id: input.sessionId },
      data: { updatedAt: new Date() },
    });
    return message;
  }

  return {
    async prepare({ userId, snapshotId, sessionId, message }) {
      const snapshot = await findVisibleSnapshot(prisma, userId, snapshotId);
      if (snapshot.status !== 'READY') {
        throw new AppError(
          409,
          'This repository is still being indexed. Try again when it is ready.',
        );
      }
      if (!model) {
        throw new AppError(
          503,
          'Chat is not available: no AI provider is configured on the server.',
        );
      }

      let session;
      if (sessionId) {
        session = await prisma.chatSession.findFirst({
          where: { id: sessionId, userId, snapshotId },
        });
        if (!session) throw new AppError(404, 'Conversation not found');
      } else {
        session = await prisma.chatSession.create({
          data: { userId, snapshotId, title: message.replace(/\s+/g, ' ').slice(0, 80) },
        });
      }

      const previous = await prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'desc' },
        take: historyMessages,
        select: { role: true, content: true },
      });
      await prisma.chatMessage.create({
        data: { sessionId: session.id, role: 'user', content: message },
      });

      return {
        sessionId: session.id,
        snapshotId,
        question: message,
        history: previous.reverse().map((m) => ({
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content,
        })),
      };
    },

    async answer(prepared, emit, signal) {
      const started = Date.now();
      emit({ type: 'session', sessionId: prepared.sessionId });
      try {
        const lastQuestion = [...prepared.history].reverse().find((m) => m.role === 'user');
        const query =
          lastQuestion && prepared.question.split(/\s+/).length < FOLLOW_UP_WORDS
            ? `${lastQuestion.content}\n${prepared.question}`
            : prepared.question;
        const sources = selectSources(
          await retriever.retrieve({ snapshotId: prepared.snapshotId, query, k }),
        );
        emit({
          type: 'sources',
          sources: sources.map((s, i) => ({
            marker: i + 1,
            chunkId: s.chunkId,
            path: s.path,
            startLine: s.startLine,
            endLine: s.endLine,
            label: s.label,
          })),
        });

        if (sources.length === 0) {
          const saved = await saveAnswer({
            sessionId: prepared.sessionId,
            content: NO_SOURCES_ANSWER,
            flagged: false,
            latencyMs: Date.now() - started,
            citations: [],
          });
          emit({
            type: 'done',
            messageId: saved.id,
            content: NO_SOURCES_ANSWER,
            citations: [],
            flagged: false,
          });
          return;
        }

        let text = '';
        for await (const token of model!.stream(
          buildPrompt({ question: prepared.question, sources, history: prepared.history }),
          signal,
        )) {
          text += token;
          emit({ type: 'token', text: token });
        }
        if (signal.aborted) return;

        const check = checkCitations(text, sources.length);
        const citations = check.valid.map((marker) => ({ marker, chunk: sources[marker - 1]! }));
        const saved = await saveAnswer({
          sessionId: prepared.sessionId,
          content: check.cleaned,
          flagged: check.invalid.length > 0,
          latencyMs: Date.now() - started,
          citations,
        });
        if (check.invalid.length) {
          logger.warn(
            { sessionId: prepared.sessionId, invalid: check.invalid },
            'removed invalid citations',
          );
        }
        emit({
          type: 'done',
          messageId: saved.id,
          content: check.cleaned,
          citations: citations.map(({ marker, chunk }) => toCitation(marker, chunk)),
          flagged: check.invalid.length > 0,
        });
        logger.info(
          {
            sessionId: prepared.sessionId,
            sources: sources.length,
            cited: citations.length,
            latencyMs: Date.now() - started,
          },
          'chat answered',
        );
      } catch (err) {
        if (signal.aborted) return;
        logger.error({ err, sessionId: prepared.sessionId }, 'chat failed');
        emit({
          type: 'error',
          message:
            err instanceof ChatModelError
              ? err.message
              : 'Something went wrong while answering. Please try again.',
        });
      }
    },

    async listSessions(userId, snapshotId) {
      await findVisibleSnapshot(prisma, userId, snapshotId);
      const sessions = await prisma.chatSession.findMany({
        where: { userId, snapshotId },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: { id: true, title: true, updatedAt: true },
      });
      return sessions.map((s) => ({ ...s, updatedAt: s.updatedAt.toISOString() }));
    },

    async getSession(userId, sessionId) {
      if (!isUuid(sessionId)) throw new AppError(404, 'Conversation not found');
      const session = await prisma.chatSession.findFirst({
        where: { id: sessionId, userId },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            include: {
              citations: {
                orderBy: { marker: 'asc' },
                include: { file: { select: { path: true } } },
              },
            },
          },
        },
      });
      if (!session) throw new AppError(404, 'Conversation not found');
      return {
        session: {
          id: session.id,
          snapshotId: session.snapshotId,
          title: session.title,
          updatedAt: session.updatedAt.toISOString(),
        },
        messages: session.messages.map((m) => ({
          id: m.id,
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content,
          flagged: m.flagged,
          createdAt: m.createdAt.toISOString(),
          citations: m.citations.map((c) => ({
            marker: c.marker,
            path: c.file.path,
            startLine: c.startLine,
            endLine: c.endLine,
            label: c.label,
          })),
        })),
      };
    },
  };
}

function toCitation(marker: number, chunk: RetrievedChunk): ChatCitation {
  return {
    marker,
    path: chunk.path,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    label: chunk.label,
  };
}
