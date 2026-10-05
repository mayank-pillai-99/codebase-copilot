import { impactResponseSchema } from '@codebase-copilot/shared';
import { describe, expect, it } from 'vitest';
import { computeImpact, type ImpactInput } from '../src/analysis/impact';

const ROUTE_A = '00000000-0000-4000-8000-00000000000a';
const ROUTE_B = '00000000-0000-4000-8000-00000000000b';
const ROUTE_C = '00000000-0000-4000-8000-00000000000c';

const symbol = (
  id: string,
  path: string,
  qualifiedName: string,
  startLine: number,
  endLine: number,
) => ({
  id,
  path,
  qualifiedName,
  kind: 'FUNCTION',
  startLine,
  endLine,
});

// controller → service → repo.find → db.query; an inline route also calls service.
const input: ImpactInput = {
  symbols: [
    symbol('query', 'src/db.ts', 'query', 1, 10),
    symbol('find', 'src/repo.ts', 'find', 1, 10),
    symbol('service', 'src/service.ts', 'getUser', 1, 20),
    symbol('controller', 'src/controller.ts', 'showUser', 1, 10),
    symbol('unrelated', 'src/other.ts', 'other', 1, 5),
    symbol('test', 'src/service.test.ts', 'run', 1, 30),
  ],
  calls: [
    { fromSymbolId: 'find', toSymbolId: 'query', path: 'src/repo.ts', line: 4 },
    { fromSymbolId: 'service', toSymbolId: 'find', path: 'src/service.ts', line: 7 },
    { fromSymbolId: 'controller', toSymbolId: 'service', path: 'src/controller.ts', line: 3 },
    // Inline route handler in the routes file (no enclosing symbol).
    { fromSymbolId: null, toSymbolId: 'service', path: 'src/routes.ts', line: 12 },
    // Module-level call.
    { fromSymbolId: null, toSymbolId: 'query', path: 'src/seed.ts', line: 2 },
    // A test calls the service; it's recorded but not followed.
    { fromSymbolId: 'test', toSymbolId: 'service', path: 'src/service.test.ts', line: 9 },
    { fromSymbolId: 'unrelated', toSymbolId: 'controller', path: 'src/other.ts', line: 2 },
  ],
  routes: [
    {
      id: ROUTE_A,
      method: 'GET',
      path: '/users/:id',
      filePath: 'src/routes.ts',
      handlerSymbolId: 'controller',
      startLine: 5,
      endLine: 5,
    },
    {
      id: ROUTE_B,
      method: 'POST',
      path: '/users',
      filePath: 'src/routes.ts',
      handlerSymbolId: null,
      startLine: 10,
      endLine: 14,
    },
    {
      id: ROUTE_C,
      method: 'GET',
      path: '/health',
      filePath: 'src/routes.ts',
      handlerSymbolId: null,
      startLine: 20,
      endLine: 22,
    },
  ],
  targets: ['query'],
  hasTests: true,
};

describe('computeImpact', () => {
  const impact = computeImpact(input);

  it('matches the shared schema', () => {
    expect(impactResponseSchema.parse({ symbol: null, ...impact })).toEqual({
      symbol: null,
      ...impact,
    });
  });

  it('lists dependents by distance, including inline handlers and top-level code, without tests', () => {
    expect(impact.dependents.map((d) => [d.label, d.depth])).toEqual([
      ['find', 1],
      ['top-level code', 1],
      ['getUser', 2],
      ['showUser', 3],
      ['POST /users handler', 3],
      ['other', 4],
    ]);
  });

  it('finds routes through named and inline handlers, with a shortest chain', () => {
    expect(impact.routes.map((r) => [r.method, r.path, r.depth])).toEqual([
      ['POST', '/users', 3],
      ['GET', '/users/:id', 3],
    ]);
    const get = impact.routes.find((r) => r.id === ROUTE_A)!;
    expect(get.chain.map((s) => [s.label, s.callLine])).toEqual([
      ['showUser', 3],
      ['getUser', 7],
      ['find', 4],
      ['query', null],
    ]);
    const post = impact.routes.find((r) => r.id === ROUTE_B)!;
    expect(post.chain[0]).toMatchObject({ label: 'POST /users handler', callLine: 12 });
    expect(post.chain.at(-1)!.label).toBe('query');
  });

  it('records tests that reach the code', () => {
    expect(impact.tests).toEqual([
      { path: 'src/service.test.ts', depth: 3, calls: 'getUser', line: 9 },
    ]);
    expect(impact.truncated).toBe(false);
  });

  it('treats a route handler target as depth 0', () => {
    const own = computeImpact({ ...input, targets: ['controller'] });
    expect(own.routes).toEqual([
      expect.objectContaining({
        id: ROUTE_A,
        depth: 0,
        chain: [expect.objectContaining({ label: 'showUser', callLine: null })],
      }),
    ]);
    expect(own.dependents.map((d) => d.label)).toEqual(['other']);
  });

  it('handles call cycles', () => {
    const cyclic = computeImpact({
      ...input,
      calls: [
        { fromSymbolId: 'find', toSymbolId: 'query', path: 'src/repo.ts', line: 4 },
        { fromSymbolId: 'query', toSymbolId: 'find', path: 'src/db.ts', line: 5 },
      ],
    });
    expect(cyclic.dependents.map((d) => d.label)).toEqual(['find']);
  });
});
