import type { FastifyPluginAsync } from 'fastify';
import { getHealth, type HealthChecks } from '../services/health.service';

export interface HealthRouteOptions {
  checks: HealthChecks;
  version: string;
  startedAt: number;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (app, opts) => {
  app.get('/api/health', async (_request, reply) => {
    const health = await getHealth(opts.checks, opts);
    return reply.code(health.status === 'ok' ? 200 : 503).send(health);
  });
};
