import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Env } from './config/env';
import { loggerOptions } from './lib/logger';
import { healthRoutes } from './routes/health';
import type { HealthChecks } from './services/health.service';

export interface AppDeps {
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL' | 'WEB_ORIGIN' | 'APP_VERSION'>;
  healthChecks: HealthChecks;
}

export async function buildApp({ env, healthChecks }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(env) });

  await app.register(helmet);
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Invalid request', issues: error.issues });
    }
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
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

  return app;
}
