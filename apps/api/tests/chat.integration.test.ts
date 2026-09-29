import { randomUUID } from 'node:crypto';
import type { ChatEvent } from '@codebase-copilot/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChatService, type ChatService } from '../src/chat/chat.service';
import type { PromptMessage } from '../src/chat/prompt';
import type { GitHubClient } from '../src/github/client';
import { createIndexer } from '../src/indexing/indexer';
import { createCodeParser } from '../src/indexing/parser';
import { AppError } from '../src/lib/errors';
import { createPrisma, type PrismaClient } from '../src/lib/prisma';
import { ChatModelError, type ChatModel } from '../src/llm/chat-model';
import { createFullTextRetriever } from '../src/retrieval/fulltext';
import { createHybridRetriever } from '../src/retrieval/hybrid';
import { createVectorRetriever } from '../src/retrieval/vector';
import { hashingEmbedder } from './support/fakes';
import { fixtureEntries } from './support/fixture-repo';
import { makeTarball, toWebStream } from './support/tar';

const { DATABASE_URL, RUN_INTEGRATION } = process.env;
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** Streams a scripted answer and records the prompts it received. */
function scriptedModel(answer: string | (() => never)) {
  const prompts: PromptMessage[][] = [];
  const model: ChatModel = {
    model: 'scripted',
    async *stream(messages) {
      prompts.push(messages);
      if (typeof answer === 'function') answer();
      for (const word of (answer as string).split(/(?<= )/)) yield word;
    },
  };
  return { model, prompts };
}

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL)('chat (integration)', () => {
  let prisma: PrismaClient;
  let snapshotId = '';
  let userId = '';
  const owner = `chat-${randomUUID().slice(0, 8)}`;
  const embedder = hashingEmbedder();

  beforeAll(async () => {
    prisma = createPrisma(DATABASE_URL!);
    const github: GitHubClient = {
      getRepository: async () => {
        throw new Error('unused');
      },
      resolveCommit: async () => 'x',
      downloadTarball: async () => toWebStream(makeTarball(fixtureEntries())),
    };
    const repository = await prisma.repository.create({
      data: { owner, name: 'api', defaultBranch: 'main' },
    });
    const user = await prisma.user.create({
      data: { email: `${owner}@example.test`, passwordHash: 'x' },
    });
    userId = user.id;
    await prisma.trackedRepository.create({ data: { userId, repositoryId: repository.id } });
    const snapshot = await prisma.snapshot.create({
      data: { repositoryId: repository.id, commitSha: 'e'.repeat(40), ref: 'main' },
    });
    snapshotId = snapshot.id;
    await createIndexer({
      prisma,
      github,
      getParser: createCodeParser,
      embedder,
      limits: {
        maxArchiveBytes: 1e7,
        maxFileBytes: 2e5,
        maxTotalBytes: 1e7,
        maxCodeFiles: 100,
        maxChunks: 1000,
      },
      logger: silent,
    })(snapshotId, { isFinalAttempt: true });
  });

  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { owner } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  function service(model: ChatModel | null): ChatService {
    const retriever = createHybridRetriever(
      prisma,
      createVectorRetriever(prisma, embedder),
      createFullTextRetriever(prisma),
    );
    return createChatService({ prisma, retriever, model, logger: silent });
  }

  async function ask(chat: ChatService, message: string, sessionId?: string) {
    const events: ChatEvent[] = [];
    const prepared = await chat.prepare({ userId, snapshotId, sessionId, message });
    await chat.answer(prepared, (e) => events.push(e), new AbortController().signal);
    return events;
  }

  it('streams a grounded answer and saves it with validated citations', async () => {
    const { model, prompts } = scriptedModel(
      'Payments are created in createPayment [1], which calls the service [2]. Refunds use [42].',
    );
    const events = await ask(service(model), 'How is a payment created?');

    expect(events.map((e) => e.type)).toEqual([
      'session',
      'sources',
      ...events.filter((e) => e.type === 'token').map(() => 'token'),
      'done',
    ]);
    const sources = events.find((e) => e.type === 'sources')!;
    expect(sources.type === 'sources' && sources.sources.length).toBeGreaterThan(1);

    const done = events.at(-1)!;
    if (done.type !== 'done') throw new Error('expected done');
    expect(done.flagged).toBe(true);
    expect(done.content).toBe(
      'Payments are created in createPayment [1], which calls the service [2]. Refunds use.',
    );
    expect(done.citations.map((c) => c.marker)).toEqual([1, 2]);
    // Locations come from the retrieved chunks, not from the model's text.
    const source1 = sources.type === 'sources' ? sources.sources[0]! : null;
    expect(done.citations[0]).toMatchObject({ path: source1?.path, startLine: source1?.startLine });

    // The prompt carried numbered sources and the grounding rules.
    expect(prompts[0]![0]!.content).toMatch(/ONLY the numbered source excerpts/);
    expect(prompts[0]!.at(-1)!.content).toMatch(/\[1\] src\//);

    const saved = await prisma.chatMessage.findUniqueOrThrow({
      where: { id: done.messageId },
      include: { citations: true },
    });
    expect(saved).toMatchObject({ role: 'assistant', flagged: true, retriever: 'hybrid' });
    expect(saved.citations.map((c) => c.marker).sort()).toEqual([1, 2]);
  });

  it('continues a conversation with history and returns it on reload', async () => {
    const chat = service(scriptedModel('It is registered in the router [1].').model);
    const first = await ask(chat, 'How is a payment created?');
    const sessionId = (first[0] as { sessionId: string }).sessionId;

    const { model, prompts } = scriptedModel('Yes, see [1].');
    const second = await ask(service(model), 'Where is it registered?', sessionId);
    expect(second[0]).toEqual({ type: 'session', sessionId });
    expect(prompts[0]!.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);

    const history = await chat.getSession(userId, sessionId);
    expect(history.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'How is a payment created?'],
      ['assistant', 'It is registered in the router [1].'],
      ['user', 'Where is it registered?'],
      ['assistant', 'Yes, see [1].'],
    ]);
    expect(history.messages[1]!.citations[0]).toMatchObject({
      marker: 1,
      path: expect.any(String),
    });
    expect((await chat.listSessions(userId, snapshotId)).map((s) => s.id)).toContain(sessionId);
  });

  it('answers without the model when nothing relevant is found', async () => {
    const { model, prompts } = scriptedModel('should not be called');
    // Full-text only: vector search always returns nearest neighbors, however distant.
    const textOnly = createChatService({
      prisma,
      retriever: createFullTextRetriever(prisma),
      model,
      logger: silent,
    });
    const events = await ask(textOnly, 'zzzqqq xylophone quux');
    expect(events.find((e) => e.type === 'sources')).toEqual({ type: 'sources', sources: [] });
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      citations: [],
      content: expect.stringMatching(/couldn't find/),
    });
    expect(prompts).toHaveLength(0);
  });

  it('turns model failures into an error event', async () => {
    const failing = scriptedModel(() => {
      throw new ChatModelError('The AI service is busy (rate limit). Try again in a minute.');
    });
    const events = await ask(service(failing.model), 'How is a payment created?');
    expect(events.at(-1)).toEqual({
      type: 'error',
      message: 'The AI service is busy (rate limit). Try again in a minute.',
    });
  });

  it('refuses unknown sessions, unready snapshots and missing configuration before streaming', async () => {
    const chat = service(scriptedModel('x').model);
    await expect(
      chat.prepare({ userId, snapshotId, sessionId: randomUUID(), message: 'hi' }),
    ).rejects.toEqual(new AppError(404, 'Conversation not found'));

    await expect(
      service(null).prepare({ userId, snapshotId, message: 'hi' }),
    ).rejects.toMatchObject({
      statusCode: 503,
    });

    await prisma.snapshot.update({ where: { id: snapshotId }, data: { status: 'EMBEDDING' } });
    try {
      await expect(chat.prepare({ userId, snapshotId, message: 'hi' })).rejects.toMatchObject({
        statusCode: 409,
      });
    } finally {
      await prisma.snapshot.update({ where: { id: snapshotId }, data: { status: 'READY' } });
    }

    const stranger = randomUUID();
    await expect(
      chat.prepare({ userId: stranger, snapshotId, message: 'hi' }),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
