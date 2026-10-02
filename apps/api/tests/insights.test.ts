import { insightsSchema } from '@codebase-copilot/shared';
import { describe, expect, it } from 'vitest';
import { computeInsights, findImportCycles } from '../src/analysis/insights';

describe('findImportCycles', () => {
  it('finds each cycle once, as a loop, ignoring acyclic edges', () => {
    const cycles = findImportCycles([
      { from: 'a.ts', to: 'b.ts' },
      { from: 'b.ts', to: 'c.ts' },
      { from: 'c.ts', to: 'a.ts' },
      { from: 'c.ts', to: 'd.ts' },
      { from: 'x.ts', to: 'y.ts' },
      { from: 'y.ts', to: 'x.ts' },
      { from: 'z.ts', to: 'z.ts' },
    ]);
    expect(cycles).toEqual([
      ['a.ts', 'b.ts', 'c.ts'],
      ['x.ts', 'y.ts'],
    ]);
  });

  it('reports a shortest loop through a tangled component', () => {
    // a ⇄ b and a → c → b → a: one component, shortest loop from a is a → b.
    const cycles = findImportCycles([
      { from: 'a.ts', to: 'c.ts' },
      { from: 'c.ts', to: 'b.ts' },
      { from: 'a.ts', to: 'b.ts' },
      { from: 'b.ts', to: 'a.ts' },
    ]);
    expect(cycles).toEqual([['a.ts', 'b.ts']]);
  });

  it('handles long chains without recursion limits', () => {
    const edges = Array.from({ length: 20_000 }, (_, i) => ({ from: `f${i}`, to: `f${i + 1}` }));
    expect(findImportCycles(edges)).toEqual([]);
  });
});

describe('computeInsights', () => {
  const file = (path: string, lineCount = 10) => ({ path, kind: 'CODE', lineCount });
  const symbol = (
    id: string,
    path: string,
    qualifiedName: string,
    startLine: number,
    endLine: number,
    kind = 'FUNCTION',
  ) => ({
    id,
    path,
    qualifiedName,
    kind,
    startLine,
    endLine,
  });

  const insights = computeInsights({
    files: [
      file('src/db.ts', 40),
      file('src/users.ts', 120),
      file('src/orders.ts', 80),
      file('src/users.test.ts', 30),
      { path: 'README.md', kind: 'DOC', lineCount: 500 },
    ],
    symbols: [
      symbol('q', 'src/db.ts', 'query', 1, 10),
      symbol('u', 'src/users.ts', 'createUser', 1, 90),
      symbol('o', 'src/orders.ts', 'placeOrder', 1, 30),
      symbol('t', 'src/users.test.ts', 'helper', 1, 5),
    ],
    imports: [
      { from: 'src/users.ts', to: 'src/db.ts' },
      { from: 'src/orders.ts', to: 'src/db.ts' },
      { from: 'src/orders.ts', to: 'src/users.ts' },
      { from: 'src/users.ts', to: 'src/orders.ts' },
      { from: 'src/users.test.ts', to: 'src/users.ts' },
    ],
    calls: [
      { fromPath: 'src/users.ts', toSymbolId: 'q' },
      { fromPath: 'src/orders.ts', toSymbolId: 'q' },
      { fromPath: 'src/orders.ts', toSymbolId: 'u' },
      // Calls from tests don't make a function a hotspot.
      { fromPath: 'src/users.test.ts', toSymbolId: 'o' },
      { fromPath: 'src/users.test.ts', toSymbolId: 'o' },
    ],
  });

  it('matches the shared schema', () => {
    expect(insightsSchema.parse(insights)).toEqual(insights);
  });

  it('ranks hotspots from application code only', () => {
    expect(insights.mostCalled.map((s) => [s.label, s.calls])).toEqual([
      ['query', 2],
      ['createUser', 1],
    ]);
    expect(insights.longestFunctions.map((s) => [s.label, s.lines])).toEqual([
      ['createUser', 90],
      ['placeOrder', 30],
      ['query', 10],
    ]);
    expect(insights.largestFiles.map((f) => f.path)).toEqual([
      'src/users.ts',
      'src/orders.ts',
      'src/db.ts',
    ]);
  });

  it('measures which files tests reach and flags untested hubs', () => {
    expect(insights.testReach).toEqual({
      hasTests: true,
      sourceFiles: 3,
      testedFiles: 1,
      mostTested: [{ path: 'src/users.ts', tests: 1 }],
      untestedHubs: [
        { path: 'src/db.ts', importedBy: 2 },
        { path: 'src/orders.ts', importedBy: 1 },
      ],
    });
  });

  it('reports import cycles between application files', () => {
    expect(insights.cycles).toEqual([['src/orders.ts', 'src/users.ts']]);
  });
});
