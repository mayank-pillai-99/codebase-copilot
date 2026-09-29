'use client';

import {
  traceResponseSchema,
  type RouteSummary,
  type TraceNode,
  type TraceResponse,
} from '@codebase-copilot/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { codeHref, isSupportingPath } from '@/lib/format';
import { planTrace } from '@/lib/trace-tree';
import { MethodBadge } from './method-badge';

type TraceState =
  | { status: 'idle' }
  | { status: 'loading'; routeId: string }
  | { status: 'error'; routeId: string; message: string }
  | { status: 'ready'; routeId: string; trace: TraceResponse };

export function RouteTrace({
  snapshotId,
  routes,
  initialRouteId,
}: {
  snapshotId: string;
  routes: RouteSummary[];
  initialRouteId: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(
    initialRouteId && routes.some((r) => r.id === initialRouteId) ? initialRouteId : null,
  );
  const [state, setState] = useState<TraceState>({ status: 'idle' });

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setState({ status: 'loading', routeId: selected });
    fetch(`/api/snapshots/${snapshotId}/routes/${selected}/trace`, { cache: 'no-store' })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) throw new Error('Could not trace this route.');
        return traceResponseSchema.parse(body);
      })
      .then((trace) => !cancelled && setState({ status: 'ready', routeId: selected, trace }))
      .catch(
        (err: unknown) =>
          !cancelled &&
          setState({
            status: 'error',
            routeId: selected,
            message: err instanceof Error ? err.message : 'Could not trace this route.',
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [snapshotId, selected]);

  const select = (routeId: string) => {
    setSelected(routeId);
    // Linkable without a re-render (router.replace would remount this component).
    const url = new URL(window.location.href);
    url.searchParams.set('route', routeId);
    window.history.replaceState(window.history.state, '', url);
  };

  const app = routes.filter((r) => !isSupportingPath(r.file.path));
  const supporting = routes.filter((r) => isSupportingPath(r.file.path));

  if (routes.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No Express-style or Next.js routes were detected in this repository.
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <nav aria-label="Routes" className="flex min-w-0 flex-col gap-3">
        <RouteList routes={app} selected={selected} onSelect={select} />
        {supporting.length > 0 && (
          <details open={app.length === 0}>
            <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-400">
              {supporting.length} in tests and examples
            </summary>
            <div className="mt-2">
              <RouteList routes={supporting} selected={selected} onSelect={select} />
            </div>
          </details>
        )}
      </nav>

      <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {state.status === 'idle' ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Pick a route to trace what its handler calls, down to {4} levels.
          </p>
        ) : state.status === 'loading' ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Tracing…</p>
        ) : state.status === 'error' ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {state.message}
          </p>
        ) : (
          <TraceView snapshotId={snapshotId} trace={state.trace} />
        )}
      </section>
    </div>
  );
}

function RouteList({
  routes,
  selected,
  onSelect,
}: {
  routes: RouteSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {routes.map((route) => (
        <li key={route.id}>
          <button
            type="button"
            onClick={() => onSelect(route.id)}
            aria-current={route.id === selected ? 'true' : undefined}
            className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-xs transition-colors ${
              route.id === selected
                ? 'bg-brand-50 text-brand-950 ring-1 ring-brand-200 dark:bg-brand-950 dark:text-brand-100 dark:ring-brand-800'
                : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <MethodBadge method={route.method} />
            <span className="truncate">{route.path}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TraceView({ snapshotId, trace }: { snapshotId: string; trace: TraceResponse }) {
  const root = trace.nodes[0];
  if (!root) return null;
  const nodes = new Map(trace.nodes.map((n) => [n.id, n]));
  const plan = planTrace(trace);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-mono text-sm font-semibold">
          <span className="flex items-center gap-2">
            <MethodBadge method={trace.route.method} />
            {trace.route.path}
          </span>
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Registered in{' '}
          <Link
            href={codeHref(snapshotId, trace.route.file, trace.route.startLine)}
            className="font-mono text-brand-700 hover:underline dark:text-brand-400"
          >
            {trace.route.file}:{trace.route.startLine}
          </Link>
          . Calls are matched by name through imports, which is approximate: calls on local
          variables and library calls are listed but not followed.
          {trace.truncated && ' The trace was cut short at its size limit.'}
        </p>
      </div>
      <NodeView node={root} snapshotId={snapshotId} nodes={nodes} plan={plan} />
    </div>
  );
}

function NodeView({
  node,
  snapshotId,
  nodes,
  plan,
}: {
  node: TraceNode;
  snapshotId: string;
  nodes: Map<string, TraceNode>;
  /** Which calls draw their callee beneath them (see planTrace). */
  plan: Set<string>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-sm font-semibold">{node.label}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{node.kind}</span>
        <Link
          href={codeHref(snapshotId, node.path, node.startLine, node.endLine)}
          className="font-mono text-xs break-all text-brand-700 hover:underline dark:text-brand-400"
        >
          {node.path}:{node.startLine}–{node.endLine}
        </Link>
      </div>
      {node.calls.length === 0 ? (
        <p className="pl-4 text-xs text-zinc-500 dark:text-zinc-400">
          {node.kind === 'class'
            ? 'Created with new; the class has no constructor.'
            : 'No calls it makes could be traced.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 border-l border-zinc-200 pl-4 dark:border-zinc-700">
          {node.calls.map((call, index) => {
            const child = call.target ? nodes.get(call.target) : undefined;
            const expand = plan.has(`${node.id}:${index}`);
            return (
              <li
                key={`${call.line}:${call.callee}:${index}`}
                className="flex min-w-0 flex-col gap-2"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <Link
                    href={codeHref(snapshotId, node.path, call.line)}
                    className="w-12 shrink-0 font-mono text-zinc-400 hover:text-brand-700 dark:hover:text-brand-400"
                  >
                    L{call.line}
                  </Link>
                  <span
                    className={`font-mono break-all ${call.resolved ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-500'}`}
                  >
                    {call.callee}
                  </span>
                  {!call.resolved ? (
                    <span className="text-zinc-400 dark:text-zinc-500">not resolved</span>
                  ) : child && !expand ? (
                    <span className="text-zinc-500 dark:text-zinc-400">
                      ↺ {child.label} (shown above)
                    </span>
                  ) : !child ? (
                    <span className="text-zinc-500 dark:text-zinc-400">beyond the depth limit</span>
                  ) : null}
                </div>
                {expand && child && (
                  <NodeView node={child} snapshotId={snapshotId} nodes={nodes} plan={plan} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
