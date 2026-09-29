import { healthResponseSchema } from '@codebase-copilot/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, healthyChecks } from './support/app';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/health', () => {
  it('returns 200 and a schema-valid body when every dependency is up', async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    const body = healthResponseSchema.parse(res.json());
    expect(body.status).toBe('ok');
    expect(body.version).toBe('1.2.3');
    expect(body.dependencies.pgvector.detail).toBe('v0.8.0');
  });

  it('returns 503 and names the failing dependency', async () => {
    app = await buildTestApp({
      healthChecks: {
        ...healthyChecks,
        redis: async () => {
          throw new Error('connection refused');
        },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(503);
    const body = healthResponseSchema.parse(res.json());
    expect(body.status).toBe('degraded');
    expect(body.dependencies.redis).toMatchObject({ ok: false, detail: 'connection refused' });
    expect(body.dependencies.database.ok).toBe(true);
  });
});

describe('error handling', () => {
  it('returns JSON 404 for unknown routes', async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
  });

  it('hides internal error details from clients', async () => {
    app = await buildTestApp();
    app.get('/api/boom', async () => {
      throw new Error('secret internal detail');
    });
    const res = await app.inject({ method: 'GET', url: '/api/boom' });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret internal detail');
  });
});
