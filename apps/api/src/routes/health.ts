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

  // TEMPORARY: shows which proxy headers reach the API, to set TRUST_PROXY. Remove after.
  app.get('/api/health/proxy-debug', async (request) => ({
    ip: request.ip,
    ips: request.ips,
    clientIp: request.clientIp,
    socket: request.socket.remoteAddress,
    xff: request.headers['x-forwarded-for'] ?? null,
    cfConnectingIp: request.headers['cf-connecting-ip'] ?? null,
    trueClientIp: request.headers['true-client-ip'] ?? null,
    xRealIp: request.headers['x-real-ip'] ?? null,
    forwardedClientIp: request.headers['x-client-ip'] ?? null,
    signed: request.headers['x-proxy-secret'] ? 'present' : 'absent',
  }));

  app.get('/api/health', async (_request, reply) => {
    const health = await getHealth(opts.checks, opts);
    return reply.code(health.status === 'ok' ? 200 : 503).send(health);
  });
};
