import { SESSION_COOKIE } from '@codebase-copilot/shared';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { argon2Hasher } from '../src/lib/password';
import { createPrisma, type PrismaClient } from '../src/lib/prisma';
import { createRedis, type Redis } from '../src/lib/redis';
import { createUserRepository } from '../src/repositories/user.repository';
import { createAuthService } from '../src/services/auth.service';
import { buildTestApp } from './support/app';

const { DATABASE_URL, REDIS_URL, RUN_INTEGRATION } = process.env;

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL && REDIS_URL)('auth (integration)', () => {
  let prisma: PrismaClient;
  let redis: Redis;
  let app: FastifyInstance;
  const email = `auth-test-${randomUUID()}@example.test`;
  const password = 'correct horse battery staple';

  beforeAll(async () => {
    prisma = createPrisma(DATABASE_URL!);
    redis = createRedis(REDIS_URL!);
    await redis.connect();
    app = await buildTestApp({
      auth: createAuthService({ users: createUserRepository(prisma), hasher: argon2Hasher }),
      redis,
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
    await redis.quit();
  });

  it('registers, reads the session, and logs in against Postgres with Argon2', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password },
    });
    expect(registered.statusCode).toBe(201);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);

    const token = registered.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(me.json().user.email).toBe(email);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
  });

  it('keeps rate-limit counters in Redis', async () => {
    // A unique client address so earlier runs or tests don't share the counter.
    const remoteAddress = `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 255)).join('.')}`;
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: 'wrong' },
        remoteAddress,
      });

    await attempt();
    const keys = await redis.keys(`rate-limit:*${remoteAddress}*`);
    expect(keys.length).toBeGreaterThan(0);
    for (let i = 0; i < 9; i++) await attempt();
    expect((await attempt()).statusCode).toBe(429);
  });
});
