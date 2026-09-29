import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ChatService } from './chat/chat.service';
import type { Env } from './config/env';
import { AppError } from './lib/errors';
import { loggerOptions } from './lib/logger';
import type { DailyQuota } from './lib/quota';
import type { Redis } from './lib/redis';
import { authPlugin } from './plugins/auth';
import { analysisRoutes } from './routes/analysis';
import { authRoutes } from './routes/auth';
import { chatRoutes } from './routes/chat';
import { codeRoutes } from './routes/code';
import { evalRoutes } from './routes/eval';
import { healthRoutes } from './routes/health';
import { repositoryRoutes } from './routes/repositories';
import { searchRoutes } from './routes/search';
import type { ArchitectureService } from './services/architecture.service';
import type { AuthService } from './services/auth.service';
import type { CodeService } from './services/code.service';
import type { EvalService } from './services/eval.service';
import type { HealthChecks } from './services/health.service';
import type { RepositoryService } from './services/repository.service';
import type { SearchService } from './services/search.service';
import type { TraceService } from './services/trace.service';

export interface AppDeps {
  env: Pick<
    Env,
    'NODE_ENV' | 'LOG_LEVEL' | 'WEB_ORIGIN' | 'APP_VERSION' | 'JWT_SECRET' | 'TRUST_PROXY'
  >;
  healthChecks: HealthChecks;
  auth: AuthService;
  repositories: RepositoryService;
  chat: ChatService;
  code: CodeService;
  search: SearchService;
  evals: EvalService;
  architecture: ArchitectureService;
  trace: TraceService;
  /** Daily caps on chat answers (per user, and per IP for anonymous demo visitors); omitted in tests. */
  chatQuota?: { user: DailyQuota; anonymous: DailyQuota };
  /** Overrides the SSE heartbeat interval (tests). */
  chatHeartbeatMs?: number;
  /** Shared rate-limit counters across instances; in-memory when omitted (tests). */
  redis?: Redis;
}

export async function buildApp({
  env,
  healthChecks,
  auth,
  repositories,
  chat,
  code,
  search,
  evals,
  architecture,
  trace,
  chatQuota,
  chatHeartbeatMs,
  redis,
}: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(env), trustProxy: env.TRUST_PROXY });

  // Only JSON bodies are accepted. Plain-text bodies are what a cross-site HTML form
  // can send, so refusing them is part of the CSRF defense.
  app.removeContentTypeParser('text/plain');

  await app.register(helmet);
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(rateLimit, {
    global: false,
    ...(redis && { redis, nameSpace: 'rate-limit:' }),
    // If Redis is unavailable, serve the request rather than fail closed.
    skipOnError: true,
  });
  await app.register(authPlugin, {
    jwtSecret: env.JWT_SECRET,
    secureCookies: env.NODE_ENV === 'production',
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'Invalid request',
        issues: error.issues.map(({ path, message }) => ({ path, message })),
      });
    }
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (error instanceof AppError) {
      // Written for users, so safe at any status (e.g. 503 "GitHub rate limit reached").
      if (statusCode >= 500) request.log.warn({ err: error }, 'upstream or dependency error');
      return reply.code(statusCode).send({ error: error.message });
    }
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      return reply.code(500).send({ error: 'Something went wrong. Please try again.' });
    }
    return reply
      .code(statusCode)
      .send({ error: error instanceof Error ? error.message : 'Request failed' });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));

  await app.register(healthRoutes, {
    checks: healthChecks,
    version: env.APP_VERSION,
    startedAt: Date.now(),
  });
  await app.register(authRoutes, { auth });
  await app.register(repositoryRoutes, { repositories });
  await app.register(chatRoutes, {
    chat,
    quota: chatQuota,
    ...(chatHeartbeatMs && { heartbeatMs: chatHeartbeatMs }),
  });
  await app.register(codeRoutes, { code });
  await app.register(searchRoutes, { search });
  await app.register(evalRoutes, { evals });
  await app.register(analysisRoutes, { architecture, trace });

  return app;
}
