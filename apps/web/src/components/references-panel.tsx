'use client';

import { referencesResponseSchema, type ReferencesResponse } from '@codebase-copilot/shared';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { codeHref } from '@/lib/format';
import { MethodBadge } from './method-badge';

type State =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: ReferencesResponse };

/**
 * Callers and callees of the function at the selected line, from the call graph.
 * Clicking a line number or an outline entry in the code viewer selects a line.
 */
export function ReferencesPanel({
  snapshotId,
  path,
  line,
}: {
  snapshotId: string;
  path: string;
  line: number | null;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (line === null) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/snapshots/${snapshotId}/references?path=${encodeURIComponent(path)}&line=${line}`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return referencesResponseSchema.parse(await res.json());
      })
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch(() => !cancelled && setState({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [snapshotId, path, line]);

  return (
    <aside className="card flex min-w-0 flex-col gap-4 p-4 text-sm xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
      <div>
        <h2 className="font-semibold tracking-tight">References</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Calls are matched by name through imports, so some can&apos;t be resolved.
        </p>
      </div>
      {line === null ? (
        <Hint>
          Click a line number or a symbol in the outline to see what calls it and what it calls.
        </Hint>
      ) : state.status === 'loading' ? (
        <div className="flex flex-col gap-2.5" role="status" aria-label="Loading references">
          <div className="skeleton h-4 w-2/3" />
          <div className="skeleton h-3 w-1/2" />
          <div className="skeleton h-3 w-3/4" />
          <div className="skeleton h-3 w-2/3" />
        </div>
      ) : state.status === 'error' ? (
        <Hint>References are unavailable right now.</Hint>
      ) : !state.data.symbol ? (
        <Hint>Line {line} isn&apos;t inside a function, method or class.</Hint>
      ) : (
        <References snapshotId={snapshotId} data={state.data} />
      )}
    </aside>
  );
}

function References({ snapshotId, data }: { snapshotId: string; data: ReferencesResponse }) {
  const symbol = data.symbol!;
  const link = (path: string, start: number, end?: number, text?: ReactNode) => (
    <Link
      href={codeHref(snapshotId, path, start, end)}
      className="font-mono text-xs break-all text-brand-700 hover:underline dark:text-brand-400"
    >
      {text ?? `${path}:${start}`}
    </Link>
  );

  return (
    <div className="flex animate-fade-in flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
        <span className="font-mono text-sm font-semibold break-all">{symbol.qualifiedName}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {symbol.kind} · lines {symbol.startLine}–{symbol.endLine}
        </span>
        {data.routes.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1.5">
            {data.routes.map((route) => (
              <Link
                key={route.id}
                href={`/repos/${snapshotId}/routes?route=${route.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[11px] hover:border-brand-400 dark:border-zinc-700 dark:bg-zinc-900"
                title="Trace this route"
              >
                <MethodBadge method={route.method} />
                {route.path}
              </Link>
            ))}
          </span>
        )}
      </div>

      <Group title="Called by" count={data.callers.length}>
        {data.callers.length === 0 ? (
          <Hint>
            No resolved calls to it. It may be used by a framework, passed as a value, or called on
            a variable.
          </Hint>
        ) : (
          data.callers.map((caller, i) => (
            <li key={`${caller.path}:${caller.line}:${i}`} className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">
                {caller.from ? (
                  caller.from.label
                ) : caller.route ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MethodBadge method={caller.route.method} /> {caller.route.path} handler
                  </span>
                ) : (
                  'top-level code'
                )}
              </span>
              {link(caller.path, caller.line)}
            </li>
          ))
        )}
      </Group>

      <Group title="Calls" count={data.callees.length}>
        {data.callees.length === 0 ? (
          <Hint>
            {symbol.kind === 'class'
              ? 'Its methods are listed separately in the outline.'
              : 'No calls.'}
          </Hint>
        ) : (
          data.callees.map((call, i) => (
            <li
              key={`${call.line}:${call.callee}:${i}`}
              className="flex min-w-0 items-baseline gap-2 text-xs"
            >
              <Link
                href={codeHref(snapshotId, symbol.path, call.line)}
                className="w-9 shrink-0 font-mono text-zinc-400 hover:text-brand-700 dark:hover:text-brand-400"
              >
                L{call.line}
              </Link>
              {call.target ? (
                link(call.target.path, call.target.startLine, call.target.endLine, call.callee)
              ) : (
                <span
                  className="font-mono break-all text-zinc-400 dark:text-zinc-500"
                  title="Not resolved: a library call or a method on a local variable"
                >
                  {call.callee}
                </span>
              )}
            </li>
          ))
        )}
      </Group>
      {data.truncated && <Hint>Only the first 50 of each are shown.</Hint>}
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-mono text-[11px] tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
        {title} ({count})
      </h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-zinc-500 dark:text-zinc-400">{children}</p>;
}
