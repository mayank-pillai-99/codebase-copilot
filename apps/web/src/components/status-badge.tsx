import type { SnapshotStatus } from '@codebase-copilot/shared';

const STYLES: Record<SnapshotStatus, [label: string, className: string]> = {
  QUEUED: ['Queued', 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'],
  FETCHING: ['Downloading', 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'],
  PARSING: ['Analyzing', 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'],
  READY: ['Ready', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'],
  FAILED: ['Failed', 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'],
};

export function StatusBadge({ status }: { status: SnapshotStatus }) {
  const [label, className] = STYLES[status];
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
