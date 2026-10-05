import type { ImpactResponse, ImpactStep } from '@codebase-copilot/shared';
import { isTestFile } from './insights';

/**
 * Change impact (no AI): walks resolved calls backwards from a symbol to find the
 * code that depends on it, the HTTP routes that reach it and the tests that exercise
 * it. Breadth-first, so every depth and chain is a shortest one.
 */

export interface ImpactSymbol {
  id: string;
  path: string;
  qualifiedName: string;
  kind: string;
  startLine: number;
  endLine: number;
}

export interface ImpactInput {
  symbols: readonly ImpactSymbol[];
  /** Resolved calls; fromSymbolId is null at module scope or in an inline callback. */
  calls: readonly { fromSymbolId: string | null; toSymbolId: string; path: string; line: number }[];
  routes: readonly {
    id: string;
    method: string;
    path: string;
    filePath: string;
    handlerSymbolId: string | null;
    startLine: number;
    endLine: number;
  }[];
  /** The symbol being changed, plus its methods when it's a class. */
  targets: readonly string[];
  hasTests: boolean;
}

type ImpactResult = Omit<ImpactResponse, 'symbol'>;

export const MAX_DEPENDENTS = 200;
export const MAX_ROUTES = 100;

export function computeImpact(input: ImpactInput): ImpactResult {
  const byId = new Map(input.symbols.map((s) => [s.id, s]));
  const callsTo = new Map<string, ImpactInput['calls'][number][]>();
  for (const call of input.calls) {
    const list = callsTo.get(call.toSymbolId) ?? [];
    list.push(call);
    callsTo.set(call.toSymbolId, list);
  }
  for (const list of callsTo.values()) {
    list.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  }

  // For each reached symbol, the call it makes one step closer to the target.
  const next = new Map<string, { to: string; line: number }>();
  const depth = new Map<string, number>(input.targets.map((id) => [id, 0]));
  const topLevel = new Map<string, ImpactResult['dependents'][number]>();
  const inlineRoutes = new Map<string, { depth: number; to: string; line: number }>();
  const tests = new Map<string, ImpactResult['tests'][number]>();

  const inlineRouteAt = (path: string, line: number) =>
    input.routes.find(
      (r) => !r.handlerSymbolId && r.filePath === path && line >= r.startLine && line <= r.endLine,
    );

  let frontier = input.targets.filter((id) => byId.has(id));
  for (let d = 1; frontier.length > 0; d++) {
    const following: string[] = [];
    for (const id of frontier) {
      const callee = byId.get(id)!;
      for (const call of callsTo.get(id) ?? []) {
        // Tests show the code is exercised; they aren't followed further.
        if (isTestFile(call.path)) {
          if (!tests.has(call.path)) {
            tests.set(call.path, {
              path: call.path,
              depth: d,
              calls: callee.qualifiedName,
              line: call.line,
            });
          }
          continue;
        }
        if (call.fromSymbolId) {
          if (depth.has(call.fromSymbolId) || !byId.has(call.fromSymbolId)) continue;
          depth.set(call.fromSymbolId, d);
          next.set(call.fromSymbolId, { to: id, line: call.line });
          following.push(call.fromSymbolId);
          continue;
        }
        const route = inlineRouteAt(call.path, call.line);
        if (route) {
          if (!inlineRoutes.has(route.id)) {
            inlineRoutes.set(route.id, { depth: d, to: id, line: call.line });
          }
        } else if (!topLevel.has(call.path)) {
          topLevel.set(call.path, {
            label: 'top-level code',
            kind: 'module',
            path: call.path,
            startLine: call.line,
            endLine: call.line,
            depth: d,
          });
        }
      }
    }
    frontier = following;
  }

  const step = (id: string): ImpactStep[] => {
    const steps: ImpactStep[] = [];
    for (let at: string | undefined = id; at !== undefined; at = next.get(at)?.to) {
      const s = byId.get(at)!;
      steps.push({
        label: s.qualifiedName,
        path: s.path,
        startLine: s.startLine,
        endLine: s.endLine,
        callLine: next.get(at)?.line ?? null,
      });
    }
    return steps;
  };

  const routes: ImpactResult['routes'] = [];
  for (const route of input.routes) {
    const found = route.handlerSymbolId === null ? undefined : depth.get(route.handlerSymbolId);
    const inline = inlineRoutes.get(route.id);
    if (found !== undefined) {
      routes.push({ ...routeFields(route), depth: found, chain: step(route.handlerSymbolId!) });
    } else if (inline) {
      routes.push({
        ...routeFields(route),
        depth: inline.depth,
        chain: [
          {
            label: `${route.method} ${route.path} handler`,
            path: route.filePath,
            startLine: route.startLine,
            endLine: route.endLine,
            callLine: inline.line,
          },
          ...step(inline.to),
        ],
      });
    }
  }
  routes.sort(
    (a, b) => a.depth - b.depth || a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );

  const dependents = [
    ...[...depth]
      .filter(([, d]) => d > 0)
      .map(([id, d]) => {
        const s = byId.get(id)!;
        return {
          label: s.qualifiedName,
          kind: s.kind.toLowerCase(),
          path: s.path,
          startLine: s.startLine,
          endLine: s.endLine,
          depth: d,
        };
      }),
    ...topLevel.values(),
  ].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path) || a.startLine - b.startLine);

  return {
    routes: routes.slice(0, MAX_ROUTES),
    dependents: dependents.slice(0, MAX_DEPENDENTS),
    tests: [...tests.values()].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)),
    hasTests: input.hasTests,
    truncated: routes.length > MAX_ROUTES || dependents.length > MAX_DEPENDENTS,
  };
}

function routeFields(route: ImpactInput['routes'][number]) {
  return { id: route.id, method: route.method, path: route.path };
}
