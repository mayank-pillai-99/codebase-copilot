import { chatRequestSchema, type ChatEvent } from '@codebase-copilot/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ChatService } from '../chat/chat.service';
import { AppError } from '../lib/errors';
import type { DailyQuota } from '../lib/quota';
import { viewerId } from '../plugins/auth';

export interface ChatRouteOptions {
  chat: ChatService;
  /** Daily caps on answers: per user, and per IP for anonymous demo visitors. Absent in tests. */
  quota?: { user: DailyQuota; anonymous: DailyQuota } | undefined;
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

/** Anonymous visitors (demo repositories only) get a lower per-minute limit. */
async function maxPerMinute(request: FastifyRequest): Promise<number> {
  return (await userKey(request)).startsWith('user:') ? 10 : 4;
}

export const chatRoutes: FastifyPluginAsync<ChatRouteOptions> = async (app, { chat, quota }) => {
  // Anonymous visitors may chat about demo repositories; the service enforces which.
  app.addHook('preHandler', app.identify);

  app.post<SnapshotParams>(
    '/api/snapshots/:id/chat',
    {
      config: { rateLimit: { max: maxPerMinute, timeWindow: '1 minute', keyGenerator: userKey } },
    },
    async (request, reply) => {
      const { message, sessionId } = chatRequestSchema.parse(request.body);
      const userId = viewerId(request);
      const allowed = userId
        ? await quota?.user.consume(userId)
        : await quota?.anonymous.consume(request.ip);
      if (allowed === false) {
        throw new AppError(
          429,
          userId
            ? "You've reached today's question limit. It resets at midnight UTC."
            : "The demo's daily question limit for your network has been reached. Sign up to keep asking.",
        );
      }
      // Everything that can fail with a status code happens before the stream starts.
      const prepared = await chat.prepare({
        userId,
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
    sessions: await chat.listSessions(viewerId(request), request.params.id),
  }));

  app.get<SessionParams>('/api/chat/sessions/:sessionId', async (request) =>
    chat.getSession(viewerId(request), request.params.sessionId),
  );
};
