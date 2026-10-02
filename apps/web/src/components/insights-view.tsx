import type { Insights } from '@codebase-copilot/shared';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { codeHref } from '@/lib/format';

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/** Codebase health from the parsed graph: hotspots, test reach and import cycles. */
export function InsightsView({ snapshotId, insights }: { snapshotId: string; insights: Insights }) {
  const { testReach } = insights;
  const reach = testReach.sourceFiles ? testReach.testedFiles / testReach.sourceFiles : 0;
  const topCalled = insights.mostCalled[0];
  const longest = insights.longestFunctions[0];
  const file = (path: string, start?: number, end?: number, text?: ReactNode) => (
    <Link
      href={codeHref(snapshotId, path, start, end)}
      className="font-mono text-xs break-all text-brand-700 hover:underline dark:text-brand-400"
    >
      {text ?? path}
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A health check computed from the parsed code (no AI): where the code is concentrated, what
        the tests reach, and where files import each other in a loop. Rankings cover application
        code, not tests or examples.
      </p>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Files reached by tests" delay={0}>
          <span className="text-2xl font-semibold tabular-nums">
            {testReach.hasTests ? `${Math.round(reach * 100)}%` : '—'}
          </span>
          <Meter value={testReach.hasTests ? reach : 0} tone={reach >= 0.5 ? 'good' : 'warn'} />
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {testReach.hasTests
              ? `${testReach.testedFiles} of ${testReach.sourceFiles} files imported by a test`
              : 'No test files found'}
          </span>
        </Stat>
        <Stat label="Import cycles" delay={60}>
          <span className="text-2xl font-semibold tabular-nums">{insights.cycles.length}</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {insights.cycles.length
              ? 'files that import each other in a loop'
              : 'between application files'}
          </span>
        </Stat>
        <Stat label="Most-called function" delay={120}>
          {topCalled ? (
            <>
              <span className="truncate font-mono text-sm font-semibold" title={topCalled.label}>
                {topCalled.label}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                called from {topCalled.calls} {topCalled.calls === 1 ? 'place' : 'places'}
              </span>
            </>
          ) : (
            <span className="text-sm text-zinc-500">No resolved calls</span>
          )}
        </Stat>
        <Stat label="Longest function" delay={180}>
          {longest ? (
            <>
              <span className="truncate font-mono text-sm font-semibold" title={longest.label}>
                {longest.label}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {longest.lines} lines
              </span>
            </>
          ) : (
            <span className="text-sm text-zinc-500">No functions</span>
          )}
        </Stat>
      </dl>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section
          title="Most-called functions"
          hint="Resolved calls from application code"
          delay={240}
        >
          <Bars
            empty="No resolved calls between functions."
            items={insights.mostCalled.map((s) => ({
              key: `${s.path}:${s.startLine}`,
              value: s.calls,
              label: file(s.path, s.startLine, s.endLine, s.label),
              detail: `${s.calls} ${s.calls === 1 ? 'call' : 'calls'}`,
            }))}
          />
        </Section>
        <Section
          title="Longest functions"
          hint="Long functions are often worth reading first"
          delay={300}
        >
          <Bars
            empty="No functions found."
            items={insights.longestFunctions.map((s) => ({
              key: `${s.path}:${s.startLine}`,
              value: s.lines,
              label: file(s.path, s.startLine, s.endLine, s.label),
              detail: `${s.lines} lines`,
            }))}
          />
        </Section>
        <Section title="Largest files" hint="By line count" delay={360}>
          <Bars
            empty="No application files."
            items={insights.largestFiles.map((f) => ({
              key: f.path,
              value: f.lines,
              label: file(f.path, undefined, undefined, f.path.split('/').at(-1)),
              detail: `${f.lines} lines`,
              title: f.path,
            }))}
          />
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Important files without tests"
          hint="Not imported by any test, ranked by how many files depend on them"
          delay={420}
        >
          {!testReach.hasTests ? (
            <Empty>This repository has no test files.</Empty>
          ) : (
            <Bars
              tone="warn"
              empty="Every file that others depend on is imported by a test."
              items={testReach.untestedHubs.map((h) => ({
                key: h.path,
                value: h.importedBy,
                label: file(h.path),
                detail: `used by ${h.importedBy} ${h.importedBy === 1 ? 'file' : 'files'}`,
              }))}
            />
          )}
        </Section>
        <Section
          title="Most-tested files"
          hint="Imported directly by the most test files"
          delay={480}
        >
          {!testReach.hasTests ? (
            <Empty>This repository has no test files.</Empty>
          ) : (
            <Bars
              tone="good"
              empty="No test imports application files directly."
              items={testReach.mostTested.map((t) => ({
                key: t.path,
                value: t.tests,
                label: file(t.path),
                detail: `${t.tests} ${t.tests === 1 ? 'test file' : 'test files'}`,
              }))}
            />
          )}
        </Section>
      </div>

      <Section
        title="Import cycles"
        hint="Files that import each other in a loop; type-only imports count too, and are usually harmless"
        delay={540}
      >
        {insights.cycles.length === 0 ? (
          <Empty>No import cycles between application files.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {insights.cycles.map((cycle) => (
              <li
                key={cycle.join('>')}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/30"
              >
                {[...cycle, cycle[0]!].map((path, i) => (
                  <span key={`${path}:${i}`} className="flex items-center gap-2">
                    {i > 0 && (
                      <span aria-hidden className="text-amber-600 dark:text-amber-400">
                        →
                      </span>
                    )}
                    {file(
                      path,
                      undefined,
                      undefined,
                      i === cycle.length ? `${path.split('/').at(-1)} (again)` : path,
                    )}
                  </span>
                ))}
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
  delay: ms,
  children,
}: {
  label: string;
  delay: number;
  children: ReactNode;
}) {
  return (
    <div
      className="card card-hover flex min-w-0 animate-fade-up flex-col gap-1.5 p-4"
      style={delay(ms)}
    >
      <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1.5">{children}</dd>
    </div>
  );
}

function Meter({ value, tone }: { value: number; tone: 'good' | 'warn' }) {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
      role="meter"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full origin-left animate-grow rounded-full ${tone === 'good' ? 'bg-emerald-500' : 'bg-amber-500'}`}
        style={{ width: `${Math.max(value * 100, value > 0 ? 3 : 0)}%` }}
      />
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

/** A ranked list with bars scaled to the largest value. */
function Bars({
  items,
  empty,
  tone = 'brand',
}: {
  items: { key: string; value: number; label: ReactNode; detail: string; title?: string }[];
  empty: string;
  tone?: 'brand' | 'warn' | 'good';
}) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  const max = Math.max(...items.map((i) => i.value));
  const color =
    tone === 'warn'
      ? 'bg-amber-400/70 dark:bg-amber-500/50'
      : tone === 'good'
        ? 'bg-emerald-400/70 dark:bg-emerald-500/50'
        : 'bg-brand-400/60 dark:bg-brand-500/45';
  return (
    <ol className="flex flex-col gap-2.5">
      {items.map((item, i) => (
        <li key={item.key} className="flex min-w-0 flex-col gap-1" title={item.title}>
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="shrink-0 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
              {item.detail}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`h-full origin-left animate-grow rounded-full ${color}`}
              style={{ width: `${(item.value / max) * 100}%`, ...delay(120 + i * 50) }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-zinc-500 dark:text-zinc-400">{children}</p>;
}
