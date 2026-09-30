import { classifyRole } from './components';

/**
 * Deterministic parts of the onboarding guide (SPEC §9.3) that aren't covered by the
 * architecture map: where to start reading, and which request flows to look at first.
 */

export interface StartFile {
  path: string;
  /** Why it's worth opening first, in plain words. */
  reasons: string[];
  score: number;
}

const ENTRY_NAME = /^(index|main|server|app|cli)\.[cm]?[jt]sx?$/;
const NEXT_ENTRY = /^(src\/)?(app\/(layout|page)\.[jt]sx?|pages\/_app\.[jt]sx?|middleware\.[jt]s)$/;

/**
 * Ranks application files a newcomer should read first: entry points (declared in
 * package.json, conventional server/index files, Next.js roots), files many others
 * import, and files that register routes. Tests, examples and tooling are left out.
 */
export function rankStartFiles(input: {
  paths: readonly string[];
  internalImports: readonly { from: string; to: string }[];
  routeFiles: readonly string[];
  /** Paths named by package.json main/module/bin, relative to the repo root. */
  declaredEntries: readonly string[];
  limit?: number;
}): StartFile[] {
  const { limit = 8 } = input;
  const source = new Set(input.paths.filter((p) => classifyRole(p) === 'source'));

  const importers = new Map<string, Set<string>>();
  for (const { from, to } of input.internalImports) {
    // Only application code counts: a file every test imports isn't where to start.
    if (from === to || !source.has(to) || !source.has(from)) continue;
    importers.set(to, (importers.get(to) ?? new Set()).add(from));
  }
  const routes = new Map<string, number>();
  for (const file of input.routeFiles) routes.set(file, (routes.get(file) ?? 0) + 1);
  const declared = new Set(input.declaredEntries.map(normalize));

  const ranked: StartFile[] = [];
  for (const path of source) {
    const reasons: string[] = [];
    let score = 0;
    const name = path.split('/').at(-1) ?? '';
    const depth = path.split('/').length;
    if (declared.has(path)) {
      reasons.push('entry point declared in package.json');
      score += 12;
    } else if (NEXT_ENTRY.test(path)) {
      reasons.push('Next.js entry point');
      score += 8;
    } else if (ENTRY_NAME.test(name) && depth <= 2) {
      reasons.push('entry point');
      score += 8;
    }
    const importedBy = importers.get(path)?.size ?? 0;
    if (importedBy >= 2) {
      reasons.push(`imported by ${importedBy} files`);
      score += Math.min(importedBy, 12);
    }
    const routeCount = routes.get(path) ?? 0;
    if (routeCount > 0) {
      reasons.push(`defines ${routeCount} ${routeCount === 1 ? 'route' : 'routes'}`);
      score += Math.min(2 + routeCount, 8);
    }
    if (score > 0) ranked.push({ path, reasons, score });
  }
  return ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

/** Entry files named by a package.json (main, module, bin), resolved against its directory. */
export function declaredEntries(packageJsonPath: string, content: string): string[] {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }
  const dir = packageJsonPath.includes('/') ? packageJsonPath.replace(/\/[^/]+$/, '/') : '';
  const values: unknown[] = [json.main, json.module];
  if (typeof json.bin === 'string') values.push(json.bin);
  else if (json.bin && typeof json.bin === 'object') values.push(...Object.values(json.bin));
  return values
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => normalize(`${dir}${v}`));
}

function normalize(path: string): string {
  return path.replace(/^\.\//, '').replace(/\/\.\//g, '/');
}

export interface RouteCandidate {
  id: string;
  method: string;
  path: string;
  file: string;
  /** Resolved calls made inside the handler: a rough measure of how much it does. */
  resolvedCalls: number;
}

/**
 * Picks up to `limit` routes that together show the application: one per resource
 * (the first path segment), busiest resources first, preferring handlers that do
 * the most (resolved calls), then writes over reads. Routes in tests and examples
 * are left out.
 */
export function pickKeyRoutes(routes: readonly RouteCandidate[], limit = 5): RouteCandidate[] {
  const app = routes.filter((r) => classifyRole(r.file) === 'source');
  const byResource = new Map<string, RouteCandidate[]>();
  for (const route of app) {
    const resource =
      route.path.split('/').find((s) => s && !s.startsWith(':') && !s.startsWith('[')) ?? '/';
    byResource.set(resource, [...(byResource.get(resource) ?? []), route]);
  }
  const weight = (r: RouteCandidate) =>
    r.resolvedCalls * 10 + (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) ? 1 : 0);
  return [...byResource.values()]
    .sort((a, b) => b.length - a.length)
    .map(
      (group) =>
        [...group].sort((a, b) => weight(b) - weight(a) || a.path.localeCompare(b.path))[0]!,
    )
    .slice(0, limit);
}
