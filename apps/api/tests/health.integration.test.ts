import { healthResponseSchema } from '@codebase-copilot/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createPrisma } from '../src/lib/prisma';
import { createRedis } from '../src/lib/redis';
import { createDependencyChecks } from '../src/services/dependency-checks';

// Runs against real Postgres + Redis (docker compose locally, service containers in CI).
const { DATABASE_URL, REDIS_URL, RUN_INTEGRATION } = process.env;

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL && REDIS_URL)('health (integration)', () => {
  it('reports database, pgvector and redis as healthy', async () => {
    const prisma = createPrisma(DATABASE_URL!);
    const redis = createRedis(REDIS_URL!);
    const app = await buildApp({
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        WEB_ORIGIN: 'http://localhost:3000',
        APP_VERSION: 'test',
      },
      healthChecks: createDependencyChecks(prisma, redis),
    });

    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      const body = healthResponseSchema.parse(res.json());
      expect(body.dependencies).toMatchObject({
        database: { ok: true },
        pgvector: { ok: true },
        redis: { ok: true },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
      await prisma.$disconnect();
      await redis.quit();
    }
  });
});
