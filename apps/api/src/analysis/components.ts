/**
 * Groups source files into architecture components by directory (SPEC §9.1).
 *
 * Deterministic and explainable: a component is a directory. Grouping starts at the
 * top-level directories (below a wrapper like `src/` that holds everything) and splits
 * any directory holding a large share of the code into its subdirectories, until the
 * map has a readable number of components. Tests, examples and tooling are grouped
 * separately so the map shows the application first.
 */

export type ComponentRole = 'source' | 'test' | 'example' | 'tooling';

export interface Component {
  /** The directory path ("src/app/routes/auth"), "." for top-level files, or the role name. */
  id: string;
  role: ComponentRole;
  files: string[];
}

const TEST_DIRS = new Set([
  'test',
  'tests',
  '__tests__',
  '__mocks__',
  '__fixtures__',
  'fixtures',
  'e2e',
  'spec',
  'specs',
  'cypress',
  'playwright',
]);
const EXAMPLE_DIRS = new Set(['example', 'examples', 'sandbox', 'demo', 'demos', 'samples']);
const TOOLING_DIRS = new Set([
  'scripts',
  'benchmark',
  'benchmarks',
  '.github',
  '.husky',
  '.vitepress',
]);
// vite.config.ts, next.config.mjs, gulpfile.js, .eslintrc.cjs; not lib/config.js.
const TOOLING_FILE =
  /^[\w.-]+\.(config|conf)\.[cm]?[jt]s$|^(gulpfile|gruntfile|jakefile)\.[cm]?[jt]s$|^\.[\w-]+rc\.[cm]?[jt]s$/i;
const TEST_FILE = /\.(test|spec|e2e)\.[cm]?[jt]sx?$/i;

export function classifyRole(path: string): ComponentRole {
  const segments = path.split('/');
  const dirs = segments.slice(0, -1);
  const file = segments.at(-1) ?? '';
  if (TEST_FILE.test(file) || dirs.some((d) => TEST_DIRS.has(d))) return 'test';
  if (dirs.some((d) => EXAMPLE_DIRS.has(d))) return 'example';
  if (dirs.some((d) => TOOLING_DIRS.has(d)) || TOOLING_FILE.test(file)) return 'tooling';
  return 'source';
}

export interface GroupOptions {
  /** Upper bound on source components; splitting stops before exceeding it. */
  maxComponents?: number;
  /** A directory is split when it holds more than this share of the source files… */
  splitShare?: number;
  /** …and more than this many files. */
  splitMinFiles?: number;
}

export function groupComponents(paths: readonly string[], options: GroupOptions = {}): Component[] {
  const { maxComponents = 12, splitShare = 0.35, splitMinFiles = 8 } = options;
  const byRole = new Map<ComponentRole, string[]>();
  for (const path of [...paths].sort()) {
    const role = classifyRole(path);
    byRole.set(role, [...(byRole.get(role) ?? []), path]);
  }

  const source = byRole.get('source') ?? [];
  const components: Component[] = splitDirectories(source, {
    maxComponents,
    splitShare,
    splitMinFiles,
  }).map(([id, files]) => ({ id, role: 'source' as const, files }));

  for (const role of ['test', 'example', 'tooling'] as const) {
    const files = byRole.get(role);
    if (files?.length) components.push({ id: `(${role}s)`, role, files });
  }
  return components;
}

function splitDirectories(
  files: string[],
  { maxComponents, splitShare, splitMinFiles }: Required<GroupOptions>,
): [string, string[]][] {
  if (files.length === 0) return [];
  const dirOf = (path: string) => path.split('/').slice(0, -1);

  // Skip wrapper directories that contain every file (src/, packages/app/src/, …).
  let prefix: string[] = [];
  for (;;) {
    const next = dirOf(files[0]!)[prefix.length];
    if (next === undefined) break;
    const candidate = [...prefix, next];
    const allInside = files.every((f) => startsWith(dirOf(f), candidate));
    if (!allInside) break;
    prefix = candidate;
  }

  // Start one level below the prefix; files directly in the prefix form their own group.
  let groups = childGroups(files, prefix);
  // Too many sibling directories to show separately: keep the wrapper as one component.
  if (groups.size > maxComponents) return [[prefix.join('/') || '.', files]];
  for (;;) {
    const [key, members] = [...groups].sort((a, b) => b[1].length - a[1].length)[0]!;
    const depth = key === '' ? 0 : key.split('/').length;
    const canSplit = members.some((f) => dirOf(f).length > depth);
    const tooBig = members.length > Math.max(splitMinFiles, splitShare * files.length);
    if (!canSplit || !tooBig) break;
    const children = childGroups(members, key === '' ? [] : key.split('/'));
    if (children.size <= 1 && children.has(key)) break;
    if (groups.size - 1 + children.size > maxComponents) break;
    groups.delete(key);
    for (const [childKey, childFiles] of children) groups.set(childKey, childFiles);
    groups = new Map([...groups].sort(([a], [b]) => a.localeCompare(b)));
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, members]) => [key === '' ? '.' : key, members]);
}

/** Files grouped by the directory one level below `parent` (files directly in it stay in `parent`). */
function childGroups(files: string[], parent: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const dirs = file.split('/').slice(0, -1);
    const key = dirs.length > parent.length ? [...parent, dirs[parent.length]!] : parent;
    const id = key.join('/');
    groups.set(id, [...(groups.get(id) ?? []), file]);
  }
  return groups;
}

function startsWith(path: string[], prefix: string[]): boolean {
  return prefix.every((segment, i) => path[i] === segment);
}
