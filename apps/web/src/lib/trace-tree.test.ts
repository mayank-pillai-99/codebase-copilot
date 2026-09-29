import type { TraceNode, TraceResponse } from '@codebase-copilot/shared';
import { describe, expect, it } from 'vitest';
import { planTrace } from './trace-tree';

const node = (
  id: string,
  parentId: string | null,
  calls: [callee: string, target: string | null][],
): TraceNode => ({
  id,
  parentId,
  depth: 0,
  label: id,
  kind: 'function',
  path: 'a.ts',
  startLine: 1,
  endLine: 2,
  calls: calls.map(([callee, target], i) => ({
    callee,
    line: i + 1,
    resolved: target !== null,
    target,
  })),
});

const trace = (nodes: TraceNode[]): TraceResponse => ({
  route: {
    id: '00000000-0000-4000-8000-000000000000',
    method: 'GET',
    path: '/',
    file: 'a.ts',
    startLine: 1,
  },
  nodes,
  maxDepth: 4,
  truncated: false,
});

describe('planTrace', () => {
  it('expands each callee once, under its first call', () => {
    const plan = planTrace(
      trace([
        node('handler', null, [
          ['createArticle', 'create'],
          ['res.json', null],
        ]),
        node('create', 'handler', [
          ['HttpException', 'error'],
          ['HttpException', 'error'],
          ['mapper', 'mapper'],
        ]),
        node('error', 'create', []),
        node('mapper', 'create', [['HttpException', 'error']]),
      ]),
    );
    expect([...plan].sort()).toEqual(['create:0', 'create:2', 'handler:0']);
  });

  it('never expands a call back to an ancestor', () => {
    const plan = planTrace(trace([node('a', null, [['b', 'b']]), node('b', 'a', [['a', 'a']])]));
    expect([...plan]).toEqual(['a:0']);
  });

  it('handles an empty trace', () => {
    expect(planTrace(trace([])).size).toBe(0);
  });
});
