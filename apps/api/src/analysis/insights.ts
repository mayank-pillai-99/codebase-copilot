import type { Insights } from '@codebase-copilot/shared';
import { classifyRole } from './components';

/**
 * Codebase health from the stored graph (no AI): hotspots, which files tests reach,
 * and import cycles. Only application code is ranked; tests, examples and tooling
 * are counted where they matter (test coverage) and left out elsewhere.
 */

export interface InsightsInput {
  files: readonly { path: string; kind: string; lineCount: number }[];
  symbols: readonly {
    id: string;
    path: string;
    qualifiedName: string;
    kind: string;
    startLine: number;
    endLine: number;
  }[];
  /** Resolved imports between files in the snapshot. */
  imports: readonly { from: string; to: string }[];
  /** Resolved calls: the calling file and the called symbol. */
  calls: readonly { fromPath: string; toSymbolId: string }[];
}

const TOP = 8;
const MAX_CYCLES = 12;

export function computeInsights(input: InsightsInput): Insights {
  const source = new Set(
    input.files
      .filter((f) => f.kind === 'CODE' && classifyRole(f.path) === 'source')
      .map((f) => f.path),
  );
  const isTest = (path: string) => classifyRole(path) === 'test';

  // Most-called functions: resolved calls from application code.
  const callCounts = new Map<string, number>();
  for (const call of input.calls) {
    if (!source.has(call.fromPath)) continue;
    callCounts.set(call.toSymbolId, (callCounts.get(call.toSymbolId) ?? 0) + 1);
  }
  const callable = input.symbols.filter(
    (s) => source.has(s.path) && ['FUNCTION', 'METHOD', 'CLASS'].includes(s.kind),
  );
  const mostCalled = callable
    .map((s) => ({ symbol: s, calls: callCounts.get(s.id) ?? 0 }))
    .filter((x) => x.calls > 0)
    .sort(
      (a, b) => b.calls - a.calls || a.symbol.qualifiedName.localeCompare(b.symbol.qualifiedName),
    )
    .slice(0, TOP)
    .map(({ symbol, calls }) => ({ ...location(symbol), calls }));

  const longestFunctions = callable
    .filter((s) => s.kind !== 'CLASS')
    .map((s) => ({ symbol: s, lines: s.endLine - s.startLine + 1 }))
    .sort(
      (a, b) => b.lines - a.lines || a.symbol.qualifiedName.localeCompare(b.symbol.qualifiedName),
    )
    .slice(0, TOP)
    .map(({ symbol, lines }) => ({ ...location(symbol), lines }));

  const largestFiles = input.files
    .filter((f) => source.has(f.path))
    .sort((a, b) => b.lineCount - a.lineCount || a.path.localeCompare(b.path))
    .slice(0, TOP)
    .map((f) => ({ path: f.path, lines: f.lineCount }));

  // Test reach: a file counts as tested when a test file imports it directly.
  const testedBy = new Map<string, Set<string>>();
  const importedBy = new Map<string, Set<string>>();
  for (const { from, to } of input.imports) {
    if (!source.has(to) || from === to) continue;
    if (isTest(from)) testedBy.set(to, (testedBy.get(to) ?? new Set()).add(from));
    else if (source.has(from)) importedBy.set(to, (importedBy.get(to) ?? new Set()).add(from));
  }
  const hasTests = input.files.some((f) => f.kind === 'CODE' && isTest(f.path));
  const untested = [...source]
    .filter((path) => !testedBy.has(path))
    .map((path) => ({ path, importedBy: importedBy.get(path)?.size ?? 0 }))
    .sort((a, b) => b.importedBy - a.importedBy || a.path.localeCompare(b.path));

  return {
    mostCalled,
    longestFunctions,
    largestFiles,
    testReach: {
      hasTests,
      sourceFiles: source.size,
      testedFiles: [...source].filter((p) => testedBy.has(p)).length,
      mostTested: [...testedBy]
        .map(([path, tests]) => ({ path, tests: tests.size }))
        .sort((a, b) => b.tests - a.tests || a.path.localeCompare(b.path))
        .slice(0, TOP),
      untestedHubs: untested.filter((u) => u.importedBy > 0).slice(0, TOP),
    },
    cycles: findImportCycles(
      input.imports.filter((i) => source.has(i.from) && source.has(i.to)),
    ).slice(0, MAX_CYCLES),
  };
}

function location(s: InsightsInput['symbols'][number]) {
  return {
    label: s.qualifiedName,
    kind: s.kind.toLowerCase(),
    path: s.path,
    startLine: s.startLine,
    endLine: s.endLine,
  };
}

/**
 * Import cycles: strongly connected components of the file import graph with more
 * than one file (Tarjan's algorithm, iterative so deep graphs can't overflow the
 * stack), each reported as one concrete loop through its files. Largest first.
 */
export function findImportCycles(edges: readonly { from: string; to: string }[]): string[][] {
  const graph = new Map<string, string[]>();
  for (const { from, to } of edges) {
    if (from === to) continue;
    graph.set(from, [...new Set([...(graph.get(from) ?? []), to])].sort());
    if (!graph.has(to)) graph.set(to, []);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of [...graph.keys()].sort()) {
    if (index.has(root)) continue;
    const work: { node: string; next: number }[] = [{ node: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);

    while (work.length) {
      const frame = work.at(-1)!;
      const neighbors = graph.get(frame.node)!;
      if (frame.next < neighbors.length) {
        const next = neighbors[frame.next++]!;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter++);
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, next: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
        }
        continue;
      }
      work.pop();
      const parent = work.at(-1);
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        if (component.length > 1) components.push(component);
      }
    }
  }

  return components
    .map((component) => loopThrough(component, graph))
    .sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
}

/** A shortest loop from the component's first file back to itself, as file paths. */
function loopThrough(component: string[], graph: Map<string, string[]>): string[] {
  const members = new Set(component);
  const start = [...component].sort()[0]!;
  // Breadth-first from start's neighbors back to start, staying inside the component.
  const previous = new Map<string, string>();
  const queue = (graph.get(start) ?? []).filter((n) => members.has(n));
  for (const n of queue) previous.set(n, start);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!;
    for (const next of graph.get(node) ?? []) {
      if (next === start) {
        const loop = [node];
        for (let at = node; previous.get(at) !== start;) {
          at = previous.get(at)!;
          loop.unshift(at);
        }
        return [start, ...loop];
      }
      if (members.has(next) && !previous.has(next)) {
        previous.set(next, node);
        queue.push(next);
      }
    }
  }
  return [...component].sort();
}
