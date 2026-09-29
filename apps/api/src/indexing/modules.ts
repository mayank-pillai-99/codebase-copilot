import { posix } from 'node:path';

export interface ModuleResolution {
  /** Repository path of the imported file, when it's part of the snapshot. */
  toPath: string | null;
  /** A package (npm, workspace-external, or node builtin) rather than a repo file. */
  external: boolean;
  packageName: string | null;
}

export interface ConfigFile {
  path: string;
  content: string;
}

const EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

interface PathsConfig {
  /** Directory that `paths` targets are relative to. */
  baseDir: string;
  baseUrl: string | null;
  paths: Record<string, string[]>;
}

interface WorkspacePackage {
  dir: string;
  entries: string[];
}

/**
 * Resolves import specifiers to files in the snapshot, the way TypeScript and
 * bundlers mostly do: relative paths with extension/index probing (including
 * `./x.js` → `x.ts`), tsconfig `paths`/`baseUrl` (following relative `extends`),
 * and workspace packages declared by package.json files inside the repo.
 */
export function createModuleResolver(codePaths: Iterable<string>, configs: ConfigFile[]) {
  const files = new Set(codePaths);
  const configsByPath = new Map(configs.map((c) => [c.path, c.content]));
  const tsconfigs = new Map<string, PathsConfig | null>(); // dir → effective config
  const packages = loadWorkspacePackages(configs);

  function probe(base: string): string | null {
    const normalized = posix.normalize(base);
    if (normalized.startsWith('..')) return null;
    const ext = posix.extname(normalized);
    if (ext && files.has(normalized)) return normalized;
    for (const replacement of JS_TO_TS[ext] ?? []) {
      const swapped = normalized.slice(0, -ext.length) + replacement;
      if (files.has(swapped)) return swapped;
    }
    for (const candidate of EXTENSIONS) {
      if (files.has(normalized + candidate)) return normalized + candidate;
    }
    for (const candidate of EXTENSIONS) {
      const index = posix.join(normalized, `index${candidate}`);
      if (files.has(index)) return index;
    }
    return null;
  }

  function pathsConfigFor(fromPath: string): PathsConfig | null {
    let dir = posix.dirname(fromPath);
    for (;;) {
      const key = dir === '.' ? '' : dir;
      if (!tsconfigs.has(key)) {
        const configPath = key ? `${key}/tsconfig.json` : 'tsconfig.json';
        tsconfigs.set(
          key,
          configsByPath.has(configPath) ? loadTsconfig(configPath, configsByPath) : null,
        );
      }
      const found = tsconfigs.get(key);
      if (found) return found;
      if (!key) return null;
      dir = posix.dirname(dir);
    }
  }

  function resolveWithPaths(fromPath: string, specifier: string): string | null {
    const config = pathsConfigFor(fromPath);
    if (!config) return null;
    for (const [pattern, targets] of Object.entries(config.paths)) {
      const star = pattern.indexOf('*');
      let captured: string | null = null;
      if (star === -1) {
        if (pattern === specifier) captured = '';
      } else {
        const prefix = pattern.slice(0, star);
        const suffix = pattern.slice(star + 1);
        if (
          specifier.startsWith(prefix) &&
          specifier.endsWith(suffix) &&
          specifier.length >= prefix.length + suffix.length
        ) {
          captured = specifier.slice(prefix.length, specifier.length - suffix.length);
        }
      }
      if (captured === null) continue;
      for (const target of targets) {
        const hit = probe(posix.join(config.baseDir, target.replace('*', captured)));
        if (hit) return hit;
      }
    }
    return config.baseUrl ? probe(posix.join(config.baseUrl, specifier)) : null;
  }

  function resolveWorkspacePackage(specifier: string): string | null | undefined {
    for (const [name, pkg] of packages) {
      if (specifier === name) {
        for (const entry of pkg.entries) {
          const hit = probe(posix.join(pkg.dir, entry));
          if (hit) return hit;
        }
        return null;
      }
      if (specifier.startsWith(`${name}/`)) {
        const subpath = specifier.slice(name.length + 1);
        return probe(posix.join(pkg.dir, subpath)) ?? probe(posix.join(pkg.dir, 'src', subpath));
      }
    }
    return undefined; // not a workspace package
  }

  return {
    resolve(fromPath: string, specifier: string): ModuleResolution {
      if (specifier.startsWith('.')) {
        return {
          toPath: probe(posix.join(posix.dirname(fromPath), specifier)),
          external: false,
          packageName: null,
        };
      }
      if (specifier.startsWith('/')) return { toPath: null, external: false, packageName: null };

      const workspaceHit = resolveWorkspacePackage(specifier);
      if (workspaceHit !== undefined)
        return { toPath: workspaceHit, external: false, packageName: null };

      const aliased = resolveWithPaths(fromPath, specifier);
      if (aliased) return { toPath: aliased, external: false, packageName: null };

      return { toPath: null, external: true, packageName: packageNameOf(specifier) };
    },
  };
}

export function packageNameOf(specifier: string): string {
  if (specifier.startsWith('node:')) return specifier;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

function loadTsconfig(path: string, configs: Map<string, string>, depth = 0): PathsConfig | null {
  const json = parseJsonc(configs.get(path) ?? '');
  if (!json || depth > 5) return null;
  const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path);
  const options = (json.compilerOptions ?? {}) as {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };

  let inherited: PathsConfig | null = null;
  const parents = Array.isArray(json.extends) ? json.extends : json.extends ? [json.extends] : [];
  for (const parent of parents) {
    // Only relative extends can point at a file in the repo (packages aren't indexed).
    if (typeof parent !== 'string' || !parent.startsWith('.')) continue;
    const parentPath = posix.normalize(
      posix.join(dir, parent.endsWith('.json') ? parent : `${parent}.json`),
    );
    inherited = loadTsconfig(parentPath, configs, depth + 1) ?? inherited;
  }

  const baseUrl =
    options.baseUrl !== undefined ? posix.join(dir, options.baseUrl) : (inherited?.baseUrl ?? null);
  if (options.paths) {
    return { baseDir: baseUrl ?? dir, baseUrl, paths: options.paths };
  }
  if (inherited) return { ...inherited, baseUrl, baseDir: inherited.baseDir };
  return baseUrl ? { baseDir: baseUrl, baseUrl, paths: {} } : null;
}

function loadWorkspacePackages(configs: ConfigFile[]): Map<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>();
  for (const config of configs) {
    if (posix.basename(config.path) !== 'package.json') continue;
    const json = parseJsonc(config.content);
    if (!json || typeof json.name !== 'string') continue;
    const dir = posix.dirname(config.path) === '.' ? '' : posix.dirname(config.path);
    if (!dir) continue; // the root package isn't imported by name
    const exportsField = json.exports as unknown;
    const rootExport =
      typeof exportsField === 'string'
        ? exportsField
        : typeof exportsField === 'object' && exportsField !== null
          ? pickExport((exportsField as Record<string, unknown>)['.'] ?? exportsField)
          : null;
    const entries = [
      rootExport,
      json.source,
      json.module,
      json.main,
      json.types,
      'src/index',
      'index',
    ].filter((e): e is string => typeof e === 'string');
    packages.set(json.name, { dir, entries });
  }
  return packages;
}

function pickExport(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['source', 'types', 'import', 'default', 'require']) {
    const picked = pickExport(record[key]);
    if (picked) return picked;
  }
  return null;
}

/** JSON with comments and trailing commas, as used by tsconfig.json. */
export function parseJsonc(text: string): Record<string, unknown> | null {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') out += text[++i] ?? '';
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += char;
    }
  }
  try {
    const parsed: unknown = JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
