import type { FileResponse } from '@codebase-copilot/shared';
import Link from 'next/link';
import { codeHref, githubBlobUrl } from '@/lib/format';
import type { HighlightedToken } from '@/lib/highlight';
import { ScrollToLine } from './scroll-to-line';

export function CodeView({
  snapshotId,
  repo,
  commitSha,
  file,
  symbols,
  lines,
  highlight,
}: {
  snapshotId: string;
  repo: { owner: string; name: string };
  commitSha: string;
  file: FileResponse['file'];
  symbols: FileResponse['symbols'];
  lines: HighlightedToken[][];
  highlight: { start: number; end: number } | null;
}) {
  const inRange = (n: number) => highlight !== null && n >= highlight.start && n <= highlight.end;

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="min-w-0 truncate font-mono text-xs font-medium">{file.path}</h2>
        <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span>{file.lineCount.toLocaleString('en-US')} lines</span>
          {symbols.length > 0 && (
            <details className="relative">
              <summary className="cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100">
                Outline ({symbols.length})
              </summary>
              <ul className="absolute right-0 z-10 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {symbols.map((s) => (
                  <li key={`${s.qualifiedName}:${s.startLine}`}>
                    <Link
                      href={codeHref(snapshotId, file.path, s.startLine, s.endLine)}
                      className="flex justify-between gap-2 rounded px-2 py-1 font-mono hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="truncate">{s.qualifiedName}</span>
                      <span className="shrink-0 text-zinc-400">{s.kind.toLowerCase()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <a
            href={githubBlobUrl(repo, commitSha, file.path, highlight?.start, highlight?.end)}
            className="hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            GitHub ↗
          </a>
        </div>
      </header>
      {file.hasErrors && (
        <p className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          This file has syntax the parser couldn&apos;t fully read, so its symbols may be
          incomplete.
        </p>
      )}
      <div className="overflow-x-auto bg-white dark:bg-zinc-950">
        <pre className="py-2 font-mono text-xs leading-5">
          {lines.map((tokens, i) => {
            const n = i + 1;
            return (
              <div
                key={n}
                id={`L${n}`}
                className={`flex scroll-mt-24 ${inRange(n) ? 'bg-amber-100/70 dark:bg-amber-500/15' : ''}`}
              >
                <Link
                  href={codeHref(snapshotId, file.path, n)}
                  aria-label={`Line ${n}`}
                  className="sticky left-0 w-12 shrink-0 select-none bg-inherit pr-3 text-right text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {n}
                </Link>
                <code className="pr-4 whitespace-pre">
                  {tokens.map((token, j) => (
                    <span key={j} className="shiki-token" style={token.style}>
                      {token.content}
                    </span>
                  ))}
                  {tokens.length === 0 && ' '}
                </code>
              </div>
            );
          })}
        </pre>
      </div>
      <ScrollToLine line={highlight?.start ?? null} />
    </section>
  );
}
