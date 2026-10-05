import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodeService } from '../src/services/code.service';
import { buildTestApp, unusedCode } from './support/app';

const SNAPSHOT = '00000000-0000-4000-8000-000000000001';

describe('GET /api/snapshots/:id/references', () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  it('passes the path and line to the service, anonymously for demos', async () => {
    const getReferences = vi.fn<CodeService['getReferences']>(async () => ({
      symbol: null,
      routes: [],
      callers: [],
      callees: [],
      truncated: false,
    }));
    app = await buildTestApp({ code: { ...unusedCode, getReferences } });
    const res = await app.inject({
      method: 'GET',
      url: `/api/snapshots/${SNAPSHOT}/references?path=src%2Fa.ts&line=12`,
    });
    expect(res.statusCode).toBe(200);
    expect(getReferences).toHaveBeenCalledWith(null, SNAPSHOT, 'src/a.ts', 12);
  });

  it.each(['path=src%2Fa.ts&line=0', 'path=src%2Fa.ts&line=abc', 'line=3', 'path=&line=3'])(
    'rejects %s',
    async (query) => {
      app = await buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: `/api/snapshots/${SNAPSHOT}/references?${query}`,
      });
      expect(res.statusCode).toBe(400);
    },
  );
});

describe('GET /api/snapshots/:id/impact', () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  it('passes the path and line to the service, anonymously for demos', async () => {
    const getImpact = vi.fn<CodeService['getImpact']>(async () => ({
      symbol: null,
      routes: [],
      dependents: [],
      tests: [],
      hasTests: false,
      truncated: false,
    }));
    app = await buildTestApp({ code: { ...unusedCode, getImpact } });
    const res = await app.inject({
      method: 'GET',
      url: `/api/snapshots/${SNAPSHOT}/impact?path=src%2Fa.ts&line=12`,
    });
    expect(res.statusCode).toBe(200);
    expect(getImpact).toHaveBeenCalledWith(null, SNAPSHOT, 'src/a.ts', 12);
  });

  it('rejects a missing line', async () => {
    app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/snapshots/${SNAPSHOT}/impact?path=a.ts`,
    });
    expect(res.statusCode).toBe(400);
  });
});
