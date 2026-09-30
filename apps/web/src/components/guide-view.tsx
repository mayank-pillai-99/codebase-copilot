'use client';

import {
  guideResponseSchema,
  guideSummaryResponseSchema,
  type Guide,
  type GuideSummaryResponse,
} from '@codebase-copilot/shared';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { codeHref } from '@/lib/format';
import { MethodBadge } from './method-badge';

const CATEGORY_LABELS: Record<Guide['stack'][number]['category'], string> = {
  language: 'Language',
  framework: 'Framework',
  ui: 'UI',
  data: 'Data',
  api: 'API',
  testing: 'Testing',
  build: 'Build',
  quality: 'Code quality',
  deployment: 'Deployment',
};

/**
 * The onboarding guide (SPEC §9.3): where a newcomer should start. Everything is
 * derived from the parsed code except the summary at the top, which is labelled as
 * AI-written.
 */
export function GuideView({ snapshotId, initial }: { snapshotId: string; initial: Guide | null }) {
  const [guide, setGuide] = useState<Guide | null>(initial);
  const [failed, setFailed] = useState(false);

  // Server-rendered when the snapshot was READY on load; fetched when indexing just finished.
  useEffect(() => {
    if (guide) return;
    let cancelled = false;
    fetch(`/api/snapshots/${snapshotId}/guide`, { cache: 'no-store' })
      .then(async (res) => guideResponseSchema.parse(await res.json()).guide)
      .then((g) => !cancelled && setGuide(g))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [guide, snapshotId]);

  if (failed) {
    return <p className="text-sm text-red-700 dark:text-red-400">Could not load the guide.</p>;
  }
  if (!guide) return <GuideSkeleton />;

  const file = (path: string, start?: number, end?: number, text?: ReactNode) => (
    <Link
      href={codeHref(snapshotId, path, start, end)}
      className="font-mono text-xs break-all text-brand-700 hover:underline dark:text-brand-400"
    >
      {text ?? (start ? `${path}:${start}` : path)}
    </Link>
  );

  const stackGroups = Object.entries(
    guide.stack.reduce<Record<string, Guide['stack']>>((groups, item) => {
      (groups[item.category] ??= []).push(item);
      return groups;
    }, {}),
  ) as [Guide['stack'][number]['category'], Guide['stack']][];

  return (
    <div className="flex flex-col gap-6">
      <Summary snapshotId={snapshotId} description={guide.description} />

      {stackGroups.length > 0 && (
        <Section title="Tech stack" hint="From package.json and config files" delay={60}>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {stackGroups.map(([category, items]) => (
              <div key={category} className="flex flex-col gap-1.5">
                <dt className="font-mono text-[11px] tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
                  {CATEGORY_LABELS[category]}
                </dt>
                <dd className="flex flex-wrap gap-1.5">
                  {items.map((item) => (
                    <Link
                      key={item.name}
                      href={codeHref(snapshotId, item.evidence)}
                      title={`Found in ${item.evidence}`}
                      className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium transition hover:border-brand-400 hover:text-brand-800 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-brand-600 dark:hover:text-brand-300"
                    >
                      {item.name}
                    </Link>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Start reading here"
          hint="Entry points, the most-imported files, and where routes live"
          delay={120}
        >
          {guide.startHere.length === 0 ? (
            <Empty>No clear entry points were found.</Empty>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {guide.startHere.map((f, i) => (
                <li key={f.path} className="flex gap-3">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 font-mono text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    {file(f.path)}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {f.reasons.join(' · ')}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section
          title="Key request flows"
          hint="One route per resource; open a trace to follow it"
          delay={180}
        >
          {guide.keyFlows.length === 0 ? (
            <Empty>No HTTP routes in the application code.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {guide.keyFlows.map((flow) => (
                <li
                  key={flow.routeId}
                  className="group flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 transition hover:border-brand-300 dark:border-zinc-800 dark:hover:border-brand-700"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <MethodBadge method={flow.method} />
                      <span className="truncate font-mono text-sm">{flow.path}</span>
                    </span>
                    <span className="truncate pl-16 text-xs text-zinc-500 dark:text-zinc-400">
                      {flow.handler
                        ? file(
                            flow.handler.path,
                            flow.handler.startLine,
                            flow.handler.endLine,
                            flow.handler.label,
                          )
                        : file(
                            flow.file,
                            flow.line,
                            undefined,
                            `inline handler · ${flow.file}:${flow.line}`,
                          )}
                    </span>
                  </span>
                  <Link
                    href={`/repos/${snapshotId}/routes?route=${flow.routeId}`}
                    className="shrink-0 text-xs font-medium text-brand-700 dark:text-brand-400"
                  >
                    Trace{' '}
                    <span className="inline-block transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title="Architecture at a glance"
        hint="The largest folders and what they import"
        action={
          <Link
            href={`/repos/${snapshotId}/architecture`}
            className="text-xs font-medium text-brand-700 dark:text-brand-400"
          >
            Open the map →
          </Link>
        }
        delay={240}
      >
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {guide.components.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-1 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50"
            >
              <span className="font-mono text-xs font-semibold break-all">
                {c.id === '.' ? '(top-level files)' : c.id}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {c.fileCount} {c.fileCount === 1 ? 'file' : 'files'}
                {c.routeCount > 0 &&
                  ` · ${c.routeCount} ${c.routeCount === 1 ? 'route' : 'routes'}`}
              </span>
              {c.importsFrom.length > 0 && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  imports {c.importsFrom.map((d) => d.split('/').at(-1)).join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-6 md:grid-cols-3">
        <Section title="Data model" delay={300}>
          {guide.dataModels.length === 0 ? (
            <Empty>No schema or ORM models found.</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {guide.dataModels.map((m) => (
                <li
                  key={`${m.file}:${m.name}`}
                  className="flex items-baseline justify-between gap-2"
                >
                  {file(m.file, m.line, undefined, m.name)}
                  <span className="text-[11px] text-zinc-500">{m.source}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="External services" delay={340}>
          {guide.integrations.length === 0 ? (
            <Empty>None detected from imports.</Empty>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {guide.integrations.map((i) => (
                <li
                  key={i.name}
                  className="rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800 ring-1 ring-violet-200 ring-inset dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900"
                >
                  {i.name} <span className="font-normal opacity-70">· {i.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Configuration" delay={380}>
          {guide.envVars.length === 0 ? (
            <Empty>No environment variables read.</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {guide.envVars.map((e) => (
                <li key={e.name}>{file(e.file, e.line, undefined, e.name)}</li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Summary({ snapshotId, description }: { snapshotId: string; description: string | null }) {
  const [state, setState] = useState<GuideSummaryResponse | 'loading'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/snapshots/${snapshotId}/guide/summary`, { cache: 'no-store' })
      .then(async (res) => guideSummaryResponseSchema.parse(await res.json()))
      .then((s) => !cancelled && setState(s))
      .catch(
        () =>
          !cancelled &&
          setState({ summary: null, reason: 'The AI summary is unavailable right now.' }),
      );
    return () => {
      cancelled = true;
    };
  }, [snapshotId]);

  return (
    <section className="card animate-fade-up relative overflow-hidden p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-brand-400 to-violet-400"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">About this codebase</h2>
        <span
          className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800 ring-1 ring-violet-200 ring-inset dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900"
          title="Written by an AI model from the README and the facts below"
        >
          <svg viewBox="0 0 16 16" aria-hidden className="size-3 fill-current">
            <path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" />
          </svg>
          AI-written
        </span>
      </div>
      <div className="mt-3 min-h-12">
        {state === 'loading' ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Writing summary">
            <div className="skeleton h-3.5 w-full" />
            <div className="skeleton h-3.5 w-11/12" />
            <div className="skeleton h-3.5 w-2/3" />
          </div>
        ) : state.summary ? (
          <p className="animate-fade-in max-w-3xl leading-relaxed text-zinc-700 dark:text-zinc-300">
            {state.summary.text}
          </p>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{state.reason}</p>
        )}
      </div>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        {state !== 'loading' && state.summary
          ? `Written by ${modelFamily(state.summary.model)} from the README and the facts below. Everything else on this page comes from the parsed code.`
          : 'Everything below this summary comes from the parsed code.'}
        {description && (
          <>
            {' '}
            package.json says: <span className="italic">“{description}”</span>
          </>
        )}
      </p>
    </section>
  );
}

/** "gemini-flash-latest → gemini-flash-lite-latest" → "Gemini" (the answering model isn't recorded). */
function modelFamily(model: string): string {
  const first = model.split(/[\s→-]/)[0] ?? model;
  return first ? first[0]!.toUpperCase() + first.slice(1) : 'an AI model';
}

function Section({
  title,
  hint,
  action,
  delay = 0,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  delay?: number;
  children: ReactNode;
}) {
  return (
    <section
      className="card animate-fade-up flex min-w-0 flex-col gap-4 p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold tracking-tight">{title}</h2>
          {hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-zinc-500 dark:text-zinc-400">{children}</p>;
}

function GuideSkeleton() {
  return (
    <div role="status" aria-label="Loading the guide" className="flex flex-col gap-6">
      {[3, 2, 4].map((lines, i) => (
        <div key={i} className="card flex flex-col gap-2.5 p-5">
          <div className="skeleton h-4 w-40" />
          {Array.from({ length: lines }, (_, j) => (
            <div key={j} className="skeleton h-3" style={{ width: `${90 - j * 12}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
