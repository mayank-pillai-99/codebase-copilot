import type { DependencyStatus } from '@codebase-copilot/shared';
import type { HealthResult } from '@/lib/api';

const LABELS = { database: 'PostgreSQL', pgvector: 'pgvector', redis: 'Redis' } as const;

export function SystemStatus({ result }: { result: HealthResult }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">System status</h2>
        <OverallBadge result={result} />
      </div>

      {result.reachable ? (
        <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
          {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => (
            <DependencyRow key={key} label={LABELS[key]} status={result.health.dependencies[key]} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          The API isn&apos;t reachable. If it&apos;s hosted on a free tier it may be waking up — try
          again in a minute.
        </p>
      )}
    </section>
  );
}

function OverallBadge({ result }: { result: HealthResult }) {
  const [label, tone] = !result.reachable
    ? ['Unreachable', 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300']
    : result.health.status === 'ok'
      ? ['Operational', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300']
      : ['Degraded', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{label}</span>;
}

function DependencyRow({ label, status }: { label: string; status: DependencyStatus }) {
  return (
    <li className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={`size-2 rounded-full ${status.ok ? 'bg-emerald-500' : 'bg-red-500'}`}
        />
        {label}
        <span className="sr-only">{status.ok ? 'healthy' : 'unhealthy'}</span>
      </span>
      <span className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
        {status.detail ?? `${status.latencyMs} ms`}
      </span>
    </li>
  );
}
