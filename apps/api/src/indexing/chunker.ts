import type { CodeGraph, SourceFile } from './graph';
import type { ParsedSymbol } from './parser';

export type ChunkKind = 'symbol' | 'module' | 'doc';

export interface ChunkDraft {
  path: string;
  kind: ChunkKind;
  /** Index into the file's parsed symbols, for symbol chunks. */
  symbolIndex: number | null;
  label: string | null;
  startLine: number;
  endLine: number;
  /** Context prepended to the code for embedding: file, symbol, imports used. */
  header: string;
  content: string;
  /** Content plus identifiers split into words, for full-text search. */
  searchText: string;
}

export interface ChunkOptions {
  /** Longer symbols and sections are split into parts of at most this many lines. */
  maxLines: number;
}

const DEFAULTS: ChunkOptions = { maxLines: 150 };

/**
 * Splits code into retrievable chunks along semantic boundaries (SPEC §5.5):
 * one per symbol, with large classes split into their methods, plus runs of
 * module-level code that no symbol covers (route registrations, app setup).
 * Markdown is split by heading. Config files aren't chunked.
 */
export function buildChunks(
  files: SourceFile[],
  graph: CodeGraph,
  options: Partial<ChunkOptions> = {},
): ChunkDraft[] {
  const { maxLines } = { ...DEFAULTS, ...options };
  const importsByFile = new Map<string, { specifier: string; names: string[] }[]>();
  for (const imp of graph.imports) {
    const list = importsByFile.get(imp.fromPath) ?? [];
    list.push({ specifier: imp.specifier, names: imp.localNames });
    importsByFile.set(imp.fromPath, list);
  }

  const chunks: ChunkDraft[] = [];
  for (const file of files) {
    const lines = file.content.split('\n');
    if (file.kind === 'CODE') {
      const parsed = graph.files.get(file.path);
      if (!parsed) continue;
      chunks.push(
        ...codeChunks(
          file.path,
          lines,
          parsed.symbols,
          importsByFile.get(file.path) ?? [],
          maxLines,
        ),
      );
    } else if (file.kind === 'DOC') {
      chunks.push(...docChunks(file.path, lines, maxLines));
    }
  }
  return chunks;
}

interface Span {
  kind: ChunkKind;
  symbol: ParsedSymbol | null;
  label: string | null;
  startLine: number;
  endLine: number;
}

function codeChunks(
  path: string,
  lines: string[],
  symbols: ParsedSymbol[],
  imports: { specifier: string; names: string[] }[],
  maxLines: number,
): ChunkDraft[] {
  const spans: Span[] = [];
  const topLevel = symbols.filter((s) => s.parentIndex === null);

  for (const symbol of topLevel) {
    const length = symbol.endLine - symbol.startLine + 1;
    const methods = symbols.filter((s) => s.parentIndex === symbol.index);
    if (symbol.kind === 'CLASS' && length > maxLines && methods.length > 0) {
      // Large class: its header (declaration, fields, constructor-less preamble) and each method.
      const firstMethod = Math.min(...methods.map((m) => m.startLine));
      if (firstMethod > symbol.startLine) {
        spans.push({
          kind: 'symbol',
          symbol,
          label: symbol.qualifiedName,
          startLine: symbol.startLine,
          endLine: firstMethod - 1,
        });
      }
      for (const method of methods) {
        spans.push({
          kind: 'symbol',
          symbol: method,
          label: method.qualifiedName,
          startLine: method.startLine,
          endLine: method.endLine,
        });
      }
    } else {
      spans.push({
        kind: 'symbol',
        symbol,
        label: symbol.qualifiedName,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
      });
    }
  }

  spans.push(...moduleScopeSpans(lines, topLevel));
  spans.sort((a, b) => a.startLine - b.startLine);

  return spans.flatMap((span) =>
    splitSpan(span, maxLines).map((part) => {
      const content = lines.slice(part.startLine - 1, part.endLine).join('\n');
      const used = imports.filter((i) =>
        i.names.some((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`).test(content)),
      );
      const what = part.symbol
        ? `${part.label} (${part.symbol.kind.toLowerCase()}${part.symbol.exported ? ', exported' : ''})`
        : `module scope, lines ${part.startLine}–${part.endLine}`;
      const header = [
        `// file: ${path}`,
        `// symbol: ${what}${part.partLabel ?? ''}`,
        ...(used.length ? [`// imports used: ${used.map((u) => u.specifier).join(', ')}`] : []),
      ].join('\n');
      return {
        path,
        kind: part.kind,
        symbolIndex: part.symbol?.index ?? null,
        label: part.label,
        startLine: part.startLine,
        endLine: part.endLine,
        header,
        content,
        searchText: buildSearchText(path, part.label, content),
      };
    }),
  );
}

/** Lines no symbol covers, grouped into runs, keeping runs with real code in them. */
function moduleScopeSpans(lines: string[], symbols: ParsedSymbol[]): Span[] {
  const covered = new Array<boolean>(lines.length + 1).fill(false);
  for (const s of symbols) for (let l = s.startLine; l <= s.endLine; l++) covered[l] = true;

  const spans: Span[] = [];
  let start: number | null = null;
  const flush = (end: number) => {
    if (start === null) return;
    let [from, to] = [start, end];
    while (from <= to && isBoring(lines[from - 1])) from++;
    while (to >= from && isBoring(lines[to - 1])) to--;
    const meaningful = lines.slice(from - 1, to).filter((l) => !isBoring(l)).length;
    if (meaningful >= 2)
      spans.push({ kind: 'module', symbol: null, label: null, startLine: from, endLine: to });
    start = null;
  };
  for (let line = 1; line <= lines.length; line++) {
    if (covered[line]) flush(line - 1);
    else start ??= line;
  }
  flush(lines.length);
  return spans;
}

/** Blank lines, comments, imports and lone braces don't make a chunk worth retrieving. */
function isBoring(line: string | undefined): boolean {
  const t = (line ?? '').trim();
  return (
    t === '' ||
    /^(\/\/|\/\*|\*|\*\/)/.test(t) ||
    /^import\b/.test(t) ||
    /^export\s+(\*|\{[^}]*\})\s+from\b/.test(t) ||
    /^[})\];,]*$/.test(t) ||
    /^(['"]use (strict|client|server)['"];?)$/.test(t)
  );
}

function docChunks(path: string, lines: string[], maxLines: number): ChunkDraft[] {
  const sections: Span[] = [];
  let current: Span = { kind: 'doc', symbol: null, label: null, startLine: 1, endLine: 0 };
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = !inFence ? line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/) : null;
    if (heading && i > 0) {
      sections.push(current);
      current = {
        kind: 'doc',
        symbol: null,
        label: heading[1] ?? null,
        startLine: i + 1,
        endLine: i + 1,
      };
    } else {
      if (heading) current.label = heading[1] ?? null;
      current.endLine = i + 1;
    }
  });
  sections.push(current);

  return sections
    .filter((s) =>
      lines.slice(s.startLine - 1, s.endLine).some((l) => l.trim() && !/^#{1,6}\s/.test(l)),
    )
    .flatMap((section) =>
      splitSpan(section, maxLines).map((part) => {
        const content = lines.slice(part.startLine - 1, part.endLine).join('\n');
        return {
          path,
          kind: 'doc' as const,
          symbolIndex: null,
          label: part.label,
          startLine: part.startLine,
          endLine: part.endLine,
          header: `<!-- file: ${path}${part.label ? ` · section: ${part.label}` : ''}${part.partLabel ?? ''} -->`,
          content,
          searchText: buildSearchText(path, part.label, content),
        };
      }),
    );
}

function splitSpan(span: Span, maxLines: number): (Span & { partLabel?: string })[] {
  const length = span.endLine - span.startLine + 1;
  if (length <= maxLines) return [span];
  const parts = Math.ceil(length / maxLines);
  return Array.from({ length: parts }, (_, i) => ({
    ...span,
    startLine: span.startLine + i * maxLines,
    endLine: Math.min(span.endLine, span.startLine + (i + 1) * maxLines - 1),
    partLabel: ` [part ${i + 1}/${parts}]`,
  }));
}

/**
 * Postgres' `simple` parser keeps `getUserById` as one token, so a search for
 * "user id" wouldn't match it. Appending the identifiers split into words fixes that.
 */
export function buildSearchText(path: string, label: string | null, content: string): string {
  const words = new Set<string>();
  for (const source of [path, label ?? '', content]) {
    for (const identifier of source.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      const parts = splitIdentifier(identifier);
      if (parts.length > 1) for (const p of parts) words.add(p);
    }
  }
  return [path, label ?? '', content, [...words].join(' ')].join('\n');
}

/** getUserByID → [get, user, by, id]; MAX_FILE_KB → [max, file, kb]. */
export function splitIdentifier(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_$-]+/)
    .filter((p) => p.length > 1)
    .map((p) => p.toLowerCase());
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
