import { SESSION_COOKIE } from '@codebase-copilot/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../../src/app';
import { AppError } from '../../src/lib/errors';
import { createAuthService } from '../../src/services/auth.service';
import type { HealthChecks } from '../../src/services/health.service';
import type { RepositoryService } from '../../src/services/repository.service';
import type { ChatService } from '../../src/chat/chat.service';
import type { CodeService } from '../../src/services/code.service';
import type { ArchitectureService } from '../../src/services/architecture.service';
import type { EvalService } from '../../src/services/eval.service';
import type { GuideService } from '../../src/services/guide.service';
import type { SearchService } from '../../src/services/search.service';
import type { TraceService } from '../../src/services/trace.service';
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
  listDemo: async () => [],
  seedDemo: async () => undefined,
};

/** Chat service for tests that don't exercise it. */
export const unusedChat: ChatService = {
  prepare: async () => {
    throw new AppError(501, 'not used in this test');
  },
  answer: async () => undefined,
  listSessions: async () => [],
  getSession: async () => {
    throw new AppError(404, 'Conversation not found');
  },
};

/** Code service for tests that don't exercise it. */
export const unusedCode: CodeService = {
  listFiles: async () => [],
  getFile: async () => {
    throw new AppError(404, 'File not found in this snapshot');
  },
};

/** Search service for tests that don't exercise it. */
export const unusedSearch: SearchService = {
  search: async () => {
    throw new AppError(404, 'Not found');
  },
};

/** No evaluation has been run. */
export const noEvals: EvalService = { latest: async () => null };

/** Analysis services for tests that don't exercise them. */
export const unusedArchitecture: ArchitectureService = {
  getArchitecture: async () => {
    throw new AppError(404, 'Not found');
  },
};
export const unusedTrace: TraceService = {
  trace: async () => {
    throw new AppError(404, 'Not found');
  },
};
export const unusedGuide: GuideService = {
  getGuide: async () => {
    throw new AppError(404, 'Not found');
  },
  getSummary: async () => ({ summary: null, reason: 'not used in this test' }),
};

/** App wired with in-memory fakes; override any dependency per test. */
export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  return buildApp({
    env: testEnv,
    healthChecks: healthyChecks,
    auth: createAuthService({ users: createInMemoryUsers(), hasher: fakeHasher }),
    repositories: unusedRepositories,
    chat: unusedChat,
    code: unusedCode,
    search: unusedSearch,
    evals: noEvals,
    architecture: unusedArchitecture,
    trace: unusedTrace,
    guide: unusedGuide,
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
