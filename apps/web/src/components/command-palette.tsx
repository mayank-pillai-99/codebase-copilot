'use client';

import {
  fileListResponseSchema,
  searchResponseSchema,
  type FileEntry,
  type SearchResult,
} from '@codebase-copilot/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { codeHref } from '@/lib/format';
import { matchFiles } from '@/lib/search';

type Item =
  { type: 'file'; key: string; path: string } | { type: 'code'; key: string; result: SearchResult };

const DEBOUNCE_MS = 220;

/**
 * ⌘K / Ctrl+K search for a repository: file names match instantly in the browser,
 * and code is searched with full-text search (no AI quota) as you type.
 */
export function CommandPalette({ snapshotId }: { snapshotId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [code, setCode] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [active, setActive] = useState(0);
  const [shortcut, setShortcut] = useState('⌘K');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const show = useCallback(() => {
    // Each opening starts a fresh search.
    setQuery('');
    setCode([]);
    setActive(0);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) setShortcut('Ctrl K');
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (openRef.current) close();
        else show();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, close]);

  // Load the file list once, the first time the palette opens.
  useEffect(() => {
    if (!open || files) return;
    fetch(`/api/snapshots/${snapshotId}/files`)
      .then(async (res) => fileListResponseSchema.parse(await res.json()).files)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [open, files, snapshotId]);

  // Keep the page behind still while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Full-text code search, debounced; stale requests are cancelled.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/snapshots/${snapshotId}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, retriever: 'fulltext', k: 12 }),
        signal: abort.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          return searchResponseSchema.parse(await res.json()).results;
        })
        .then((results) => {
          setCode(results);
          setSearchError(false);
          setSearching(false);
        })
        .catch(() => {
          if (abort.signal.aborted) return;
          setSearchError(true);
          setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, query, snapshotId]);

  const q = query.trim();
  const fileItems: Item[] = matchFiles(files ?? [], q, 6).map((f) => ({
    type: 'file',
    key: `file:${f.path}`,
    path: f.path,
  }));
  const codeItems: Item[] =
    q.length < 2 ? [] : code.map((r) => ({ type: 'code', key: `code:${r.chunkId}`, result: r }));
  const items = [...fileItems, ...codeItems];
  const current = Math.min(active, Math.max(items.length - 1, 0));

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  function go(item: Item | undefined) {
    if (!item) return;
    router.push(
      item.type === 'file'
        ? codeHref(snapshotId, item.path)
        : codeHref(snapshotId, item.result.path, item.result.startLine, item.result.endLine),
    );
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(items.length ? (current + 1) % items.length : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(items.length ? (current - 1 + items.length) % items.length : 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(items[current]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        className="group mb-1.5 flex shrink-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-500 shadow-sm transition hover:border-brand-300 hover:text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-brand-700 dark:hover:text-zinc-200"
      >
        <SearchIcon />
        <span className="hidden sm:inline">Search code</span>
        <kbd className="hidden rounded border border-zinc-200 px-1 font-mono text-[10px] text-zinc-400 sm:inline dark:border-zinc-700">
          {shortcut}
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex animate-fade-in justify-center bg-zinc-950/40 px-4 pt-[12vh] backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search this repository"
            className="card flex h-fit max-h-[70vh] w-full max-w-2xl animate-pop flex-col overflow-hidden shadow-2xl shadow-zinc-950/20"
          >
            <div className="flex items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
              <SearchIcon />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                  if (e.target.value.trim().length < 2) setCode([]);
                }}
                onKeyDown={onKeyDown}
                placeholder="Search files and code…"
                aria-label="Search files and code"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-results"
                aria-activedescendant={items[current] ? `palette-${current}` : undefined}
                className="min-w-0 flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-zinc-400"
              />
              {searching && (
                <span
                  aria-hidden
                  className="size-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"
                />
              )}
              <kbd className="rounded border border-zinc-200 px-1.5 font-mono text-[10px] text-zinc-400 dark:border-zinc-700">
                esc
              </kbd>
            </div>

            <ul id="palette-results" ref={listRef} role="listbox" className="overflow-y-auto p-2">
              {!q && (
                <li className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Type a file name, a function, or words from the code.
                </li>
              )}
              {fileItems.length > 0 && <GroupLabel>Files</GroupLabel>}
              {fileItems.map((item, i) => (
                <Row
                  key={item.key}
                  index={i}
                  active={i === current}
                  onHover={setActive}
                  onClick={() => go(item)}
                >
                  <FileIcon />
                  <span className="min-w-0 truncate font-mono text-xs">
                    {item.type === 'file' && <PathLabel path={item.path} />}
                  </span>
                </Row>
              ))}
              {q.length >= 2 && (codeItems.length > 0 || searching) && (
                <GroupLabel>Code</GroupLabel>
              )}
              {codeItems.map((item, j) => {
                const i = fileItems.length + j;
                if (item.type !== 'code') return null;
                const r = item.result;
                return (
                  <Row
                    key={item.key}
                    index={i}
                    active={i === current}
                    onHover={setActive}
                    onClick={() => go(item)}
                  >
                    <CodeIcon />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate font-mono text-xs font-semibold">
                          {r.label ?? r.path.split('/').at(-1)}
                        </span>
                        {r.kind !== 'symbol' && (
                          <span className="shrink-0 text-[11px] text-zinc-400">
                            {r.kind === 'doc' ? 'docs' : 'top-level code'}
                          </span>
                        )}
                        <span className="ml-auto truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                          {r.path}:{r.startLine}
                        </span>
                      </span>
                      {r.snippet && (
                        <pre className="overflow-hidden rounded-md bg-zinc-50 px-2 py-1 font-mono text-[11px] leading-4 whitespace-pre text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
                          {r.snippet.split('\n').slice(0, 3).join('\n')}
                        </pre>
                      )}
                    </span>
                  </Row>
                );
              })}
              {q.length >= 2 && searching && codeItems.length === 0 && (
                <li className="flex flex-col gap-2 px-3 py-2" aria-hidden>
                  <div className="skeleton h-3 w-2/3" />
                  <div className="skeleton h-3 w-1/2" />
                </li>
              )}
              {q && !searching && items.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  {searchError
                    ? 'Search is unavailable right now.'
                    : `No files or code match “${q}”.`}
                </li>
              )}
            </ul>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-200 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <span>
                <Key>↑</Key> <Key>↓</Key> to move
              </span>
              <span>
                <Key>↵</Key> to open
              </span>
              <span className="ml-auto">Keyword search · ask Chat for meaning</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({
  index,
  active,
  onHover,
  onClick,
  children,
}: {
  index: number;
  active: boolean;
  onHover: (i: number) => void;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <li
      id={`palette-${index}`}
      data-index={index}
      role="option"
      aria-selected={active}
      onMouseMove={() => !active && onHover(index)}
      onClick={onClick}
      className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 ${
        active ? 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-950/60 dark:ring-brand-900' : ''
      }`}
    >
      {children}
    </li>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <li
      role="presentation"
      className="px-3 pt-2 pb-1 font-mono text-[10px] tracking-wider text-zinc-400 uppercase"
    >
      {children}
    </li>
  );
}

/** The file name stands out; the folder is muted. */
function PathLabel({ path }: { path: string }) {
  const slash = path.lastIndexOf('/');
  return (
    <>
      <span className="text-zinc-400">{slash >= 0 ? path.slice(0, slash + 1) : ''}</span>
      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
        {path.slice(slash + 1)}
      </span>
    </>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-200 px-1 font-mono dark:border-zinc-700">
      {children}
    </kbd>
  );
}

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function SearchIcon() {
  return (
    <svg {...iconProps} className="size-4 shrink-0 text-zinc-400">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}
function FileIcon() {
  return (
    <svg {...iconProps} className="mt-0.5 size-4 shrink-0 text-zinc-400">
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
    </svg>
  );
}
function CodeIcon() {
  return (
    <svg {...iconProps} className="mt-0.5 size-4 shrink-0 text-brand-600 dark:text-brand-400">
      <path d="M8 8l-4 4 4 4M16 8l4 4-4 4" />
    </svg>
  );
}
