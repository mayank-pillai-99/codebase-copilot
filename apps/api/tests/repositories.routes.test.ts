import type { SnapshotDto } from '@codebase-copilot/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors';
import type { RepositoryService } from '../src/services/repository.service';
import { buildTestApp, signIn, unusedRepositories } from './support/app';

const SNAPSHOT_ID = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';

function snapshot(overrides: Partial<SnapshotDto> = {}): SnapshotDto {
  return {
    id: SNAPSHOT_ID,
    repository: { id: '0f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f', owner: 'expressjs', name: 'express' },
    commitSha: 'a'.repeat(40),
    ref: 'master',
    status: 'QUEUED',
    failureReason: null,
    progress: null,
    stats: null,
    createdAt: new Date(0).toISOString(),
    readyAt: null,
    ...overrides,
  };
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function setup(repositories: Partial<RepositoryService>) {
  app = await buildTestApp({ repositories: { ...unusedRepositories, ...repositories } });
  return signIn(app);
}

describe('repository routes', () => {
  it('require a session to add or list repositories', async () => {
    app = await buildTestApp();
    for (const [method, url] of [
      ['POST', '/api/repos'],
      ['GET', '/api/repos'],
    ] as const) {
      const res = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('pass anonymous snapshot reads to the service as viewer null (demo repositories)', async () => {
    const getSnapshot = vi.fn(async () => snapshot({ status: 'READY' }));
    const listRoutes = vi.fn(async () => []);
    app = await buildTestApp({
      repositories: { ...unusedRepositories, getSnapshot, listRoutes },
    });
    const one = await app.inject({ method: 'GET', url: `/api/snapshots/${SNAPSHOT_ID}` });
    expect(one.statusCode).toBe(200);
    expect(getSnapshot).toHaveBeenCalledWith(null, SNAPSHOT_ID);
    await app.inject({ method: 'GET', url: `/api/snapshots/${SNAPSHOT_ID}/routes` });
    expect(listRoutes).toHaveBeenCalledWith(null, SNAPSHOT_ID);
  });

  it('GET /api/demo is public', async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/demo' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ repositories: [] });
  });

  it('POST /api/repos queues indexing and answers 202 with the snapshot', async () => {
    const addRepository = vi.fn(async () => snapshot());
    const { userId, cookies } = await setup({ addRepository });

    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      cookies,
      payload: { url: ' https://github.com/expressjs/express ' },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().snapshot.status).toBe('QUEUED');
    expect(addRepository).toHaveBeenCalledWith(userId, 'https://github.com/expressjs/express');
  });

  it('POST /api/repos answers 200 when that commit is already indexed', async () => {
    const { cookies } = await setup({ addRepository: async () => snapshot({ status: 'READY' }) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      cookies,
      payload: { url: 'expressjs/express' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/repos rejects non-GitHub URLs before calling the service', async () => {
    const addRepository = vi.fn();
    const { cookies } = await setup({ addRepository });
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      cookies,
      payload: { url: 'https://gitlab.com/o/r' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().issues[0].message).toMatch(/github\.com\/owner\/repo/);
    expect(addRepository).not.toHaveBeenCalled();
  });

  it('passes GitHub errors through with their message', async () => {
    const { cookies } = await setup({
      addRepository: async () => {
        throw new AppError(503, 'GitHub rate limit reached. Try again later.');
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      cookies,
      payload: { url: 'o/r' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'GitHub rate limit reached. Try again later.' });
  });

  it('GET endpoints return data for the signed-in user', async () => {
    const getSnapshot = vi.fn(async () => snapshot({ status: 'PARSING' }));
    const listRoutes = vi.fn(async () => []);
    const { userId, cookies } = await setup({
      getSnapshot,
      listRoutes,
      listRepositories: async () => [],
    });

    const one = await app.inject({ method: 'GET', url: `/api/snapshots/${SNAPSHOT_ID}`, cookies });
    expect(one.json().snapshot.status).toBe('PARSING');
    expect(getSnapshot).toHaveBeenCalledWith(userId, SNAPSHOT_ID);

    const routes = await app.inject({
      method: 'GET',
      url: `/api/snapshots/${SNAPSHOT_ID}/routes`,
      cookies,
    });
    expect(routes.json()).toEqual({ routes: [] });

    const list = await app.inject({ method: 'GET', url: '/api/repos', cookies });
    expect(list.json()).toEqual({ repositories: [] });
  });
});
