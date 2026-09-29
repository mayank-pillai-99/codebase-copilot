export type FileKind = 'CODE' | 'DOC' | 'CONFIG';

export interface FileClass {
  kind: FileKind;
  /** typescript | tsx | javascript | markdown | json | yaml | dockerfile | prisma | text */
  language: string;
}

export type SkipReason =
  | 'ignored-directory'
  | 'lockfile'
  | 'minified'
  | 'source-map'
  | 'unsupported-type'
  | 'too-large'
  | 'binary'
  | 'generated'
  | 'unsafe-path'
  | 'not-a-regular-file';

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'bower_components',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  '.vercel',
  '.turbo',
  '.cache',
  '.yarn',
  '.git',
  '__snapshots__',
]);

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
]);

const CODE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
};

/** Decides from the path alone whether a file is worth reading. */
export function classifyPath(path: string): FileClass | { skip: SkipReason } {
  const segments = path.split('/');
  const fileName = segments.at(-1) ?? '';
  const lower = fileName.toLowerCase();

  if (segments.slice(0, -1).some((dir) => IGNORED_DIRECTORIES.has(dir))) {
    return { skip: 'ignored-directory' };
  }
  if (LOCKFILES.has(lower)) return { skip: 'lockfile' };
  if (lower.endsWith('.map')) return { skip: 'source-map' };
  if (/\.min\.[cm]?js$|[.-]bundle\.[cm]?js$/.test(lower)) return { skip: 'minified' };

  const extension = lower.match(/(\.[a-z0-9]+)$/)?.[1] ?? '';
  const codeLanguage = CODE_EXTENSIONS[extension];
  if (codeLanguage) return { kind: 'CODE', language: codeLanguage };

  if (extension === '.md' || extension === '.mdx') return { kind: 'DOC', language: 'markdown' };
  if (lower === 'readme' || lower.startsWith('readme.')) return { kind: 'DOC', language: 'text' };
  if (segments[0] === 'docs' && (extension === '.txt' || extension === '.rst')) {
    return { kind: 'DOC', language: 'text' };
  }

  if (lower === 'package.json' || /^[tj]sconfig(\..+)?\.json$/.test(lower)) {
    return { kind: 'CONFIG', language: 'json' };
  }
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) {
    return { kind: 'CONFIG', language: 'dockerfile' };
  }
  if (/^(docker-)?compose(\..+)?\.ya?ml$/.test(lower)) return { kind: 'CONFIG', language: 'yaml' };
  if (extension === '.prisma') return { kind: 'CONFIG', language: 'prisma' };
  if (lower === '.env.example' || lower === '.env.sample')
    return { kind: 'CONFIG', language: 'text' };

  return { skip: 'unsupported-type' };
}

/** Checks that need the file's content: binary data, generated code, minified code. */
export function inspectContent(bytes: Uint8Array, text: string, cls: FileClass): SkipReason | null {
  if (bytes.includes(0)) return 'binary';

  const head = text.slice(0, 1_000).split('\n', 5).join('\n');
  if (/@generated|do not edit|auto-?generated/i.test(head)) return 'generated';

  if (cls.kind === 'CODE' && text.length > 2_000) {
    const lines = text.split('\n');
    const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
    if (longest > 5_000 || text.length / lines.length > 200) return 'minified';
  }
  return null;
}

/**
 * Normalizes a path from the archive (after the top-level folder is removed).
 * Returns null for anything that could escape the repository root or confuse later
 * path handling. We never write to disk, but these paths still end up in the database.
 */
export function safeRelativePath(path: string): string | null {
  if (!path || path.includes('\0') || path.includes('\\')) return null;
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return null;
  const segments = path.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.length === 0 || segments.some((s) => s === '..')) return null;
  return segments.join('/');
}
