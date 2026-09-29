import { buildApp, type AppDeps } from '../../src/app';
import { createAuthService } from '../../src/services/auth.service';
import type { HealthChecks } from '../../src/services/health.service';
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

/** App wired with in-memory fakes; override any dependency per test. */
export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  return buildApp({
    env: testEnv,
    healthChecks: healthyChecks,
    auth: createAuthService({ users: createInMemoryUsers(), hasher: fakeHasher }),
    ...overrides,
  });
}
