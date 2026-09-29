'use client';

import {
  addRepositoryResponseSchema,
  isSettled,
  routeListResponseSchema,
  snapshotResponseSchema,
  type RouteSummary,
  type SnapshotDto,
  type SnapshotStats,
} from '@codebase-copilot/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { describeSkipped, githubBlobUrl, isSupportingPath, percent, shortSha } from '@/lib/format';
import { StatusBadge } from './status-badge';

const POLL_MS = 1_500;

export function SnapshotView({
  initial,
  initialRoutes,
}: {
  initial: SnapshotDto;
  /** Server-rendered when the snapshot was already READY. */
  initialRoutes: RouteSummary[] | null;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const { owner, name } = snapshot.repository;
  const repo = { owner, name };

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
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {owner}/{name}
          </h1>
          <p className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {snapshot.ref} @{' '}
            <a
              href={`https://github.com/${owner}/${name}/tree/${snapshot.commitSha}`}
              className="underline-offset-4 hover:underline"
            >
              {shortSha(snapshot.commitSha)}
            </a>
          </p>
        </div>
        <StatusBadge status={snapshot.status} />
      </header>

      {snapshot.status === 'FAILED' ? (
        <FailurePanel snapshot={snapshot} />
      ) : snapshot.status === 'READY' && snapshot.stats ? (
        <>
          <StatsGrid stats={snapshot.stats} />
          <Routes snapshot={snapshot} repo={repo} initialRoutes={initialRoutes} />
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
  ['READY', 'Ready'],
] as const;

function ProgressPanel({ snapshot }: { snapshot: SnapshotDto }) {
  const current = STEPS.findIndex(([status]) => status === snapshot.status);
  const { progress } = snapshot;
  const fraction =
    progress?.stage === 'parsing' && progress.total
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
                    ? 'animate-pulse bg-sky-500'
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
              className="h-full bg-sky-500 transition-all"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {progress?.processed?.toLocaleString('en-US')} of{' '}
            {progress?.total?.toLocaleString('en-US')} files
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
  const items = [
    [
      'Source files',
      stats.files.code.toLocaleString('en-US'),
      `${stats.files.docs} docs, ${stats.files.config} config`,
    ],
    ['Symbols', stats.symbols.toLocaleString('en-US'), 'functions, classes, methods, types'],
    [
      'Imports',
      stats.imports.total.toLocaleString('en-US'),
      `${stats.imports.internal} within the repo, ${stats.imports.external} packages`,
    ],
    [
      'Calls linked',
      percent(stats.calls.resolved, stats.calls.total),
      `${stats.calls.resolved.toLocaleString('en-US')} of ${stats.calls.total.toLocaleString('en-US')} call sites`,
    ],
    ['Routes', stats.routes.toLocaleString('en-US'), 'HTTP endpoints detected'],
    [
      'Indexed in',
      `${(stats.durationMs / 1000).toFixed(1)} s`,
      stats.filesWithParseErrors
        ? `${stats.filesWithParseErrors} files had syntax errors`
        : 'no syntax errors',
    ],
  ] as const;
  const skipped = describeSkipped(stats.skipped);

  return (
    <section className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map(([label, value, detail]) => (
          <div
            key={label}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
            <dd className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{detail}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Calls are linked by name through imports, not by type checking, so calls on local variables
        and library calls stay unlinked. {skipped}
      </p>
    </section>
  );
}

function Routes({
  snapshot,
  repo,
  initialRoutes,
}: {
  snapshot: SnapshotDto;
  repo: { owner: string; name: string };
  initialRoutes: RouteSummary[] | null;
}) {
  const [routes, setRoutes] = useState<RouteSummary[] | null>(initialRoutes);
  const [failed, setFailed] = useState(false);

  // Only needed when indexing finished while the page was open.
  useEffect(() => {
    if (initialRoutes) return;
    let cancelled = false;
    fetch(`/api/snapshots/${snapshot.id}/routes`)
      .then((res) => res.json())
      .then((body: unknown) => {
        const parsed = routeListResponseSchema.safeParse(body);
        if (cancelled) return;
        if (parsed.success) setRoutes(parsed.data.routes);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [snapshot.id, initialRoutes]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">HTTP routes</h2>
      {failed ? (
        <p className="text-sm text-red-700 dark:text-red-400">Could not load routes.</p>
      ) : routes === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading routes…</p>
      ) : routes.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No Express-style or Next.js routes were detected in this repository.
        </p>
      ) : (
        <RouteGroups routes={routes} snapshot={snapshot} repo={repo} />
      )}
    </section>
  );
}

function RouteGroups({
  routes,
  snapshot,
  repo,
}: {
  routes: RouteSummary[];
  snapshot: SnapshotDto;
  repo: { owner: string; name: string };
}) {
  const app = routes.filter((r) => !isSupportingPath(r.file.path));
  const supporting = routes.filter((r) => isSupportingPath(r.file.path));
  return (
    <div className="flex flex-col gap-3">
      {app.length > 0 ? (
        <RouteTable routes={app} snapshot={snapshot} repo={repo} />
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          All detected routes are in tests or examples.
        </p>
      )}
      {supporting.length > 0 && (
        <details className="group" open={app.length === 0}>
          <summary className="cursor-pointer text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            {supporting.length.toLocaleString('en-US')}{' '}
            {supporting.length === 1 ? 'route' : 'routes'} in tests and examples
          </summary>
          <div className="mt-3">
            <RouteTable routes={supporting} snapshot={snapshot} repo={repo} />
          </div>
        </details>
      )}
    </div>
  );
}

function RouteTable({
  routes,
  snapshot,
  repo,
}: {
  routes: RouteSummary[];
  snapshot: SnapshotDto;
  repo: { owner: string; name: string };
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Method
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Path
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Handler
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Registered in
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
          {routes.map((route) => (
            <tr key={route.id}>
              <td className="px-3 py-2 font-mono text-xs font-semibold">{route.method}</td>
              <td className="px-3 py-2 font-mono text-xs">{route.path}</td>
              <td className="px-3 py-2 font-mono text-xs">
                {route.handler ? (
                  <a
                    className="underline-offset-4 hover:underline"
                    href={githubBlobUrl(
                      repo,
                      snapshot.commitSha,
                      route.handler.path,
                      route.handler.startLine,
                      route.handler.endLine,
                    )}
                  >
                    {route.handler.qualifiedName}
                  </a>
                ) : (
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {route.handlerName ?? 'inline function'}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                <a
                  className="text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
                  href={githubBlobUrl(
                    repo,
                    snapshot.commitSha,
                    route.file.path,
                    route.file.startLine,
                  )}
                >
                  {route.file.path}:{route.file.startLine}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
