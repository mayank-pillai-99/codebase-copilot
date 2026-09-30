'use client';

import {
  addRepositoryResponseSchema,
  isSettled,
  snapshotResponseSchema,
  type Guide,
  type SnapshotDto,
  type SnapshotStats,
} from '@codebase-copilot/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { describeSkipped } from '@/lib/format';
import { CountUp } from './count-up';
import { GuideView } from './guide-view';
import { StatusBadge } from './status-badge';

const POLL_MS = 1_500;

export function SnapshotView({
  initial,
  initialGuide,
}: {
  initial: SnapshotDto;
  /** Server-rendered when the snapshot was already READY. */
  initialGuide: Guide | null;
}) {
  const [snapshot, setSnapshot] = useState(initial);

  // Poll until the snapshot settles; indexing usually takes seconds.
  useEffect(() => {
    if (isSettled(snapshot.status)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/snapshots/${snapshot.id}`, { cache: 'no-store' });
        const parsed = snapshotResponseSchema.safeParse(await res.json());
        if (!cancelled && parsed.success) setSnapshot(parsed.data.snapshot);
      } catch {
        // Transient network error: the next tick retries.
        if (!cancelled) setSnapshot((s) => ({ ...s }));
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [snapshot]);

  return (
    <div className="flex flex-col gap-8">
      {/* The page header shows a settled status; this live row is for indexing in progress. */}
      {!isSettled(initial.status) && (
        <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Status <StatusBadge status={snapshot.status} />
        </div>
      )}

      {snapshot.status === 'FAILED' ? (
        <FailurePanel snapshot={snapshot} />
      ) : snapshot.status === 'READY' && snapshot.stats ? (
        <>
          <GuideView snapshotId={snapshot.id} initial={initialGuide} />
          <StatsGrid stats={snapshot.stats} />
        </>
      ) : (
        <ProgressPanel snapshot={snapshot} />
      )}
    </div>
  );
}

const STEPS = [
  ['QUEUED', 'Queued'],
  ['FETCHING', 'Downloading the repository'],
  ['PARSING', 'Parsing and linking code'],
  ['EMBEDDING', 'Embedding code for search'],
  ['READY', 'Ready'],
] as const;

function ProgressPanel({ snapshot }: { snapshot: SnapshotDto }) {
  const current = STEPS.findIndex(([status]) => status === snapshot.status);
  const { progress } = snapshot;
  const fraction =
    (progress?.stage === 'parsing' || progress?.stage === 'embedding') && progress.total
      ? (progress.processed ?? 0) / progress.total
      : null;

  return (
    <section
      aria-live="polite"
      className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <ol className="flex flex-col gap-3">
        {STEPS.map(([status, label], i) => (
          <li key={status} className="flex items-center gap-3 text-sm">
            <span
              aria-hidden
              className={`size-2.5 rounded-full ${
                i < current
                  ? 'bg-emerald-500'
                  : i === current
                    ? 'animate-pulse bg-brand-500'
                    : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            />
            <span className={i > current ? 'text-zinc-400 dark:text-zinc-500' : ''}>
              {label}
              {i === current && progress?.stage === 'saving' && ' — saving results'}
              {i === current && progress?.stage === 'retrying' && ' — retrying after an error'}
            </span>
          </li>
        ))}
      </ol>
      {fraction !== null && (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full bg-brand-500 transition-all"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {progress?.processed?.toLocaleString('en-US')} of{' '}
            {progress?.total?.toLocaleString('en-US')}{' '}
            {progress?.stage === 'embedding' ? 'chunks' : 'files'}
          </p>
        </div>
      )}
    </section>
  );
}

function FailurePanel({ snapshot }: { snapshot: SnapshotDto }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setPending(true);
    setError(null);
    const { owner, name } = snapshot.repository;
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: `https://github.com/${owner}/${name}/tree/${snapshot.ref}` }),
      });
      const parsed = addRepositoryResponseSchema.safeParse(await res.json());
      if (parsed.success) {
        router.push(`/repos/${parsed.data.snapshot.id}`);
        router.refresh();
        return;
      }
      setError('Could not restart indexing. Please try again later.');
    } catch {
      setError('Could not reach the server.');
    }
    setPending(false);
  }

  return (
    <section className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/40">
      <h2 className="font-medium text-red-900 dark:text-red-200">Indexing failed</h2>
      <p className="mt-1 text-sm text-red-800 dark:text-red-300">{snapshot.failureReason}</p>
      <button
        type="button"
        onClick={retry}
        disabled={pending}
        className="mt-4 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-60 dark:border-red-800 dark:bg-transparent dark:text-red-200 dark:hover:bg-red-900/40"
      >
        {pending ? 'Retrying…' : 'Try again'}
      </button>
      {error && <p className="mt-2 text-sm text-red-800 dark:text-red-300">{error}</p>}
    </section>
  );
}

function StatsGrid({ stats }: { stats: SnapshotStats }) {
  const items: [label: string, value: number | null, suffix: string, detail: string][] = [
    [
      'Source files',
      stats.files.code,
      '',
      `${stats.files.docs} docs, ${stats.files.config} config`,
    ],
    ['Symbols', stats.symbols, '', 'functions, classes, methods, types'],
    [
      'Imports',
      stats.imports.total,
      '',
      `${stats.imports.internal} within the repo, ${stats.imports.external} packages`,
    ],
    [
      'Calls linked',
      stats.calls.total ? Math.round((stats.calls.resolved / stats.calls.total) * 100) : null,
      '%',
      `${stats.calls.resolved.toLocaleString('en-US')} of ${stats.calls.total.toLocaleString('en-US')} call sites`,
    ],
    ['Routes', stats.routes, '', 'HTTP endpoints detected'],
    ['Search index', stats.chunks ?? null, '', searchIndexDetail(stats)],
  ];
  const skipped = describeSkipped(stats.skipped);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold tracking-tight">What was indexed</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map(([label, value, suffix, detail], index) => (
          <div
            key={label}
            className="card card-hover animate-fade-up p-4"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {value === null ? '—' : <CountUp value={value} suffix={suffix} />}
            </dd>
            <dd className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{detail}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Indexed in {(stats.durationMs / 1000).toFixed(1)} s
        {stats.filesWithParseErrors
          ? ` (${stats.filesWithParseErrors} files had syntax errors)`
          : ''}
        . Calls are linked by name through imports, not by type checking, so calls on local
        variables and library calls stay unlinked. {skipped}
      </p>
    </section>
  );
}

function searchIndexDetail(stats: SnapshotStats): string {
  const e = stats.embeddings;
  if (!e) return 'indexed before search existed';
  if (e.status === 'complete') return `chunks embedded with ${e.model}`;
  if (e.status === 'disabled') return 'full-text search only (no AI key configured)';
  return `full-text search only: ${e.reason ?? 'embedding failed'}`;
}
