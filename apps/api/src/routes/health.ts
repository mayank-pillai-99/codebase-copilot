import type { FastifyPluginAsync } from 'fastify';
import { getHealth, type HealthChecks } from '../services/health.service';

export interface HealthRouteOptions {
  checks: HealthChecks;
  version: string;
  startedAt: number;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (app, opts) => {
  // Liveness for the hosting platform: the process is up and serving requests.
  // Dependencies are reported by /api/health instead, because restarting the API
  // wouldn't fix a database or Redis outage.
  app.get('/api/health/live', async () => ({ status: 'ok' }));

  app.get('/api/health', async (_request, reply) => {
    const health = await getHealth(opts.checks, opts);
    return reply.code(health.status === 'ok' ? 200 : 503).send(health);
  });
};
