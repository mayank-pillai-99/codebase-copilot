import type { ImpactResponse, Insights } from '@codebase-copilot/shared';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { codeHref, impactHref } from '@/lib/format';
import { MethodBadge } from './method-badge';

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

const away = (depth: number) =>
  depth === 0 ? 'handles it' : depth === 1 ? 'calls it directly' : `${depth} calls away`;

/** What may break when a function changes: dependents, routes and tests, from the call graph. */
export function ImpactView({ snapshotId, impact }: { snapshotId: string; impact: ImpactResponse }) {
  const symbol = impact.symbol!;
  const files = new Set(impact.dependents.map((d) => d.path)).size;
  const link = (path: string, start: number, end?: number, text?: ReactNode) => (
    <Link
      href={codeHref(snapshotId, path, start, end)}
      className="font-mono text-xs break-all text-brand-700 hover:underline dark:text-brand-400"
    >
      {text ?? `${path}:${start}`}
    </Link>
  );

  // Group dependents by file, keeping the nearest file first.
  const byFile = new Map<string, ImpactResponse['dependents']>();
  for (const d of impact.dependents) byFile.set(d.path, [...(byFile.get(d.path) ?? []), d]);

  const untested = impact.tests.length === 0;
  return (
    <div className="flex flex-col gap-6">
      <div className="card flex animate-fade-up flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-mono text-lg font-semibold break-all">{symbol.qualifiedName}</h2>
          {link(
            symbol.path,
            symbol.startLine,
            symbol.endLine,
            `${symbol.path}:${symbol.startLine}–${symbol.endLine}`,
          )}
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {summary(impact, files)}{' '}
          {untested && (impact.routes.length > 0 || impact.dependents.length > 0) && (
            <span className="font-medium text-amber-700 dark:text-amber-400">
              {impact.hasTests
                ? 'No test reaches it, so check these by hand.'
                : 'This repository has no tests, so check these by hand.'}
            </span>
          )}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Routes that reach it" value={impact.routes.length} delay={0} />
        <Stat label="Callers, direct and indirect" value={impact.dependents.length} delay={60} />
        <Stat label="Files affected" value={files} delay={120} />
        <Stat
          label="Test files that reach it"
          value={impact.tests.length}
          warn={untested && impact.dependents.length > 0}
          delay={180}
        />
      </dl>

      <Section
        title="Routes that reach it"
        hint="Each with one shortest call chain from the route handler, every call linked"
        delay={240}
      >
        {impact.routes.length === 0 ? (
          <Empty>
            No route handler reaches it through resolved calls. It may run at startup, from a
            script, or through calls the parser can&apos;t resolve.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {impact.routes.map((route, i) => (
              <li key={route.id}>
                <details
                  open={i === 0}
                  className="group rounded-lg border border-zinc-200 dark:border-zinc-800"
                >
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <MethodBadge method={route.method} />
                    <span className="font-mono text-sm break-all">{route.path}</span>
                    <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
                      {away(route.depth)}
                    </span>
                    <span
                      aria-hidden
                      className="text-zinc-400 transition-transform group-open:rotate-90"
                    >
                      ›
                    </span>
                  </summary>
                  <ol className="flex flex-col gap-0 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
                    {route.chain.map((step, j) => (
                      <li key={`${step.path}:${step.startLine}:${j}`} className="flex gap-3">
                        <span className="flex w-3 shrink-0 flex-col items-center pt-1.5">
                          <span
                            className={`size-2 rounded-full ${j === route.chain.length - 1 ? 'bg-amber-500' : 'bg-brand-500'}`}
                          />
                          {step.callLine !== null && (
                            <span className="w-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
                          )}
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5 pb-3">
                          <span className="font-mono text-sm font-medium break-all">
                            {step.label}
                          </span>
                          {link(step.path, step.startLine, step.endLine)}
                          {step.callLine !== null && (
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              calls the next step at{' '}
                              {link(step.path, step.callLine, undefined, `line ${step.callLine}`)}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section
          title="Code that depends on it"
          hint="Callers, their callers and so on, grouped by file, nearest first"
          delay={300}
        >
          {byFile.size === 0 ? (
            <Empty>
              Nothing calls it through resolved calls. It may be used by a framework, passed as a
              value, or called on a variable.
            </Empty>
          ) : (
            <ul className="flex flex-col gap-4">
              {[...byFile].map(([path, items]) => (
                <li key={path} className="flex min-w-0 flex-col gap-1.5">
                  <span className="font-mono text-xs break-all text-zinc-500 dark:text-zinc-400">
                    {path}
                  </span>
                  <ul className="flex flex-col gap-1 border-l border-zinc-200 pl-3 dark:border-zinc-800">
                    {items.map((d) => (
                      <li
                        key={`${d.startLine}:${d.label}`}
                        className="flex min-w-0 items-baseline justify-between gap-3"
                      >
                        {link(d.path, d.startLine, d.endLine, d.label)}
                        <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                          {away(d.depth)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section
          title="Tests that reach it"
          hint="Test files that call it or code that depends on it: run these after a change"
          delay={360}
        >
          {impact.tests.length === 0 ? (
            <Empty>
              {impact.hasTests
                ? 'No test file calls it or anything that depends on it.'
                : 'This repository has no test files.'}
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {impact.tests.map((t) => (
                <li key={t.path} className="flex min-w-0 flex-col gap-0.5">
                  {link(t.path, t.line, undefined, t.path)}
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    calls <span className="font-mono">{t.calls}</span>
                    {t.depth > 1 ? `, ${t.depth} calls away` : ' directly'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <p className="-mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        Found by following resolved calls backwards. Calls are matched by name through imports, so
        calls on local variables, callbacks and framework wiring can be missed; treat this as a
        starting point, not a guarantee.
        {impact.truncated && ' Long lists were cut at their limits.'}
      </p>
    </div>
  );
}

function summary(impact: ImpactResponse, files: number): string {
  const n = (count: number, one: string, many = `${one}s`) =>
    `${count} ${count === 1 ? one : many}`;
  if (impact.dependents.length === 0 && impact.routes.length === 0) {
    return 'Nothing else in the code calls it through resolved calls, so a change stays local as far as the call graph shows.';
  }
  const routes = impact.routes.length ? `reaches ${n(impact.routes.length, 'route')} and ` : '';
  return `Changing it ${routes}affects ${n(impact.dependents.length, 'caller')} in ${n(files, 'file')}.`;
}

/** Shown with no symbol selected: the most-called functions are good starting points. */
export function ImpactStart({
  snapshotId,
  mostCalled,
}: {
  snapshotId: string;
  mostCalled: Insights['mostCalled'];
}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Pick a function to see what may break if it changes: the code that calls it, the HTTP routes
        that reach it and the tests that exercise it, all from the call graph (no AI). In the code
        viewer, select a line and choose <span className="font-medium">What depends on this?</span>
      </p>
      <Section
        title="Start with a widely used function"
        hint="The most-called functions usually have the widest impact"
        delay={0}
      >
        {mostCalled.length === 0 ? (
          <Empty>No resolved calls between functions in this repository.</Empty>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {mostCalled.map((s) => (
              <li key={`${s.path}:${s.startLine}`}>
                <Link
                  href={impactHref(snapshotId, s.path, s.startLine)}
                  className="card card-hover flex min-w-0 flex-col gap-0.5 px-3 py-2"
                >
                  <span className="truncate font-mono text-sm font-medium">{s.label}</span>
                  <span className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {s.path} · called from {s.calls} {s.calls === 1 ? 'place' : 'places'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Stat({
  label,
  value,
  warn = false,
  delay: ms,
}: {
  label: string;
  value: number;
  warn?: boolean;
  delay: number;
}) {
  return (
    <div className="card flex min-w-0 animate-fade-up flex-col gap-1.5 p-4" style={delay(ms)}>
      <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd
        className={`text-2xl font-semibold tabular-nums ${warn ? 'text-amber-700 dark:text-amber-400' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Section({
  title,
  hint,
  delay: ms,
  children,
}: {
  title: string;
  hint: string;
  delay: number;
  children: ReactNode;
}) {
  return (
    <section className="card flex min-w-0 animate-fade-up flex-col gap-4 p-5" style={delay(ms)}>
      <div>
        <h2 className="font-semibold tracking-tight">{title}</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-zinc-500 dark:text-zinc-400">{children}</p>;
}
