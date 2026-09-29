import { SESSION_COOKIE } from '@codebase-copilot/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../../src/app';
import { AppError } from '../../src/lib/errors';
import { createAuthService } from '../../src/services/auth.service';
import type { HealthChecks } from '../../src/services/health.service';
import type { RepositoryService } from '../../src/services/repository.service';
import { createInMemoryUsers, fakeHasher } from './fakes';

export const testEnv: AppDeps['env'] = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  WEB_ORIGIN: 'http://localhost:3000',
  APP_VERSION: '1.2.3',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  TRUST_PROXY: false,
};

export const healthyChecks: HealthChecks = {
  database: async () => undefined,
  pgvector: async () => 'v0.8.0',
  redis: async () => undefined,
};

/** Repository service for tests that don't exercise it. */
export const unusedRepositories: RepositoryService = {
  addRepository: async () => {
    throw new AppError(501, 'not used in this test');
  },
  listRepositories: async () => [],
  getSnapshot: async () => {
    throw new AppError(404, 'Not found');
  },
  listRoutes: async () => [],
};

/** App wired with in-memory fakes; override any dependency per test. */
export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  return buildApp({
    env: testEnv,
    healthChecks: healthyChecks,
    auth: createAuthService({ users: createInMemoryUsers(), hasher: fakeHasher }),
    repositories: unusedRepositories,
    ...overrides,
  });
}

/** Registers a user and returns the id plus a cookie header value for authenticated requests. */
export async function signIn(app: FastifyInstance, email = 'ada@example.com') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'correct horse' },
  });
  const token = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  return { userId: res.json().user.id as string, cookies: { [SESSION_COOKIE]: token } };
}
