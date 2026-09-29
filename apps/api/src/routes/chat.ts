import { chatRequestSchema, type ChatEvent } from '@codebase-copilot/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ChatService } from '../chat/chat.service';
import { AppError } from '../lib/errors';
import type { DailyQuota } from '../lib/quota';

export interface ChatRouteOptions {
  chat: ChatService;
  /** Absent in tests; per-user daily cap on answers otherwise. */
  quota?: DailyQuota | undefined;
}

type SnapshotParams = { Params: { id: string } };
type SessionParams = { Params: { sessionId: string } };

/** Rate-limit per signed-in user rather than per IP (many users can share an IP). */
async function userKey(request: FastifyRequest): Promise<string> {
  try {
    await request.jwtVerify();
    return `user:${request.user.sub}`;
  } catch {
    return `ip:${request.ip}`;
  }
}

export const chatRoutes: FastifyPluginAsync<ChatRouteOptions> = async (app, { chat, quota }) => {
  app.addHook('preHandler', app.authenticate);

  app.post<SnapshotParams>(
    '/api/snapshots/:id/chat',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: userKey } } },
    async (request, reply) => {
      const { message, sessionId } = chatRequestSchema.parse(request.body);
      if (quota && !(await quota.consume(request.user.sub))) {
        throw new AppError(
          429,
          "You've reached today's question limit. It resets at midnight UTC.",
        );
      }
      // Everything that can fail with a status code happens before the stream starts.
      const prepared = await chat.prepare({
        userId: request.user.sub,
        snapshotId: request.params.id,
        sessionId,
        message,
      });

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Tells nginx-style proxies not to buffer the stream.
        'x-accel-buffering': 'no',
      });

      const abort = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) abort.abort();
      });
      const emit = (event: ChatEvent) => {
        if (!res.writableEnded)
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      await chat.answer(prepared, emit, abort.signal);
      res.end();
    },
  );

  app.get<SnapshotParams>('/api/snapshots/:id/chat/sessions', async (request) => ({
    sessions: await chat.listSessions(request.user.sub, request.params.id),
  }));

  app.get<SessionParams>('/api/chat/sessions/:sessionId', async (request) =>
    chat.getSession(request.user.sub, request.params.sessionId),
  );
};
