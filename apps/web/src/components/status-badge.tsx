import type { SnapshotStatus } from '@codebase-copilot/shared';

const STYLES: Record<SnapshotStatus, [label: string, className: string, dot: string]> = {
  QUEUED: [
    'Queued',
    'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    'bg-zinc-400',
  ],
  FETCHING: [
    'Downloading',
    'bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-300',
    'bg-brand-500',
  ],
  PARSING: [
    'Analyzing',
    'bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-300',
    'bg-brand-500',
  ],
  EMBEDDING: [
    'Embedding',
    'bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-300',
    'bg-brand-500',
  ],
  READY: [
    'Ready',
    'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    'bg-emerald-500',
  ],
  FAILED: ['Failed', 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300', 'bg-red-500'],
};

const IN_PROGRESS = new Set<SnapshotStatus>(['QUEUED', 'FETCHING', 'PARSING', 'EMBEDDING']);

export function StatusBadge({ status }: { status: SnapshotStatus }) {
  const [label, className, dot] = STYLES[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      <span aria-hidden className="relative flex size-1.5">
        {IN_PROGRESS.has(status) && (
          <span
            className={`absolute inline-flex size-full animate-ping-slow rounded-full ${dot}`}
          />
        )}
        <span className={`relative inline-flex size-1.5 rounded-full ${dot}`} />
      </span>
      {label}
    </span>
  );
}
