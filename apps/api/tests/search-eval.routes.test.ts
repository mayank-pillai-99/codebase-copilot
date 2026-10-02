import type { EvalRun } from '@codebase-copilot/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchService } from '../src/services/search.service';
import { buildTestApp, signIn } from './support/app';

const SNAPSHOT = '00000000-0000-4000-8000-000000000001';

describe('POST /api/snapshots/:id/search', () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  function withSearch() {
    const search = vi.fn<SearchService['search']>(async (_viewer, _snapshot, { retriever }) => ({
      retriever,
      results: [],
    }));
    return { search, service: { search } satisfies SearchService };
  }

  it('defaults to hybrid with 10 results and allows anonymous visitors', async () => {
    const { search, service } = withSearch();
    app = await buildTestApp({ search: service });
    const res = await app.inject({
      method: 'POST',
      url: `/api/snapshots/${SNAPSHOT}/search`,
      payload: { query: '  password hashing ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ retriever: 'hybrid', results: [] });
    expect(search).toHaveBeenCalledWith(null, SNAPSHOT, {
      query: 'password hashing',
      retriever: 'hybrid',
      k: 10,
    });
  });

  it('passes the signed-in user and the chosen retriever', async () => {
    const { search, service } = withSearch();
    app = await buildTestApp({ search: service });
    const { userId, cookies } = await signIn(app);
    await app.inject({
      method: 'POST',
      url: `/api/snapshots/${SNAPSHOT}/search`,
      cookies,
      payload: { query: 'auth', retriever: 'vector', k: 5 },
    });
    expect(search).toHaveBeenCalledWith(userId, SNAPSHOT, {
      query: 'auth',
      retriever: 'vector',
      k: 5,
    });
  });

  it.each([
    [{ query: '   ' }],
    [{ query: 'x', retriever: 'agentic' }],
    [{ query: 'x', k: 31 }],
    [{}],
  ])('rejects invalid input %j', async (payload) => {
    const { search, service } = withSearch();
    app = await buildTestApp({ search: service });
    const res = await app.inject({
      method: 'POST',
      url: `/api/snapshots/${SNAPSHOT}/search`,
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });
});

describe('search rate limits', () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  it('lets anonymous visitors type full-text searches but caps embedding searches', async () => {
    const search: SearchService = {
      search: async (_v, _s, { retriever }) => ({ retriever, results: [] }),
    };
    app = await buildTestApp({ search });
    const send = (retriever: string) =>
      app.inject({
        method: 'POST',
        url: `/api/snapshots/${SNAPSHOT}/search`,
        payload: { query: 'auth', retriever },
      });

    const hybrid = [];
    for (let i = 0; i < 11; i++) hybrid.push((await send('hybrid')).statusCode);
    expect(hybrid.slice(0, 10).every((code) => code === 200)).toBe(true);
    expect(hybrid[10]).toBe(429);

    await app.close();
    app = await buildTestApp({ search });
    const fulltext = [];
    for (let i = 0; i < 40; i++) fulltext.push((await send('fulltext')).statusCode);
    expect(fulltext.every((code) => code === 200)).toBe(true);
    expect((await send('fulltext')).statusCode).toBe(429);
  });
});

describe('GET /api/eval/latest', () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  it('reports that nothing has been measured yet', async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/eval/latest' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ run: null });
  });

  it('returns the latest run publicly, with a short cache lifetime', async () => {
    const run = { id: 'run' } as unknown as EvalRun;
    app = await buildTestApp({ evals: { latest: async () => run } });
    const res = await app.inject({ method: 'GET', url: '/api/eval/latest' });
    expect(res.json()).toEqual({ run });
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });
});
