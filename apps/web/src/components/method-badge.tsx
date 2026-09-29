const TONES: Record<string, string> = {
  GET: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
  POST: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900',
  PUT: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  PATCH:
    'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-900',
  DELETE: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900',
};
const OTHER =
  'bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700';

/** HTTP method as a colored tag, so a route list can be scanned by verb. */
export function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={`inline-flex w-14 shrink-0 justify-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide ring-1 ring-inset ${TONES[method.toUpperCase()] ?? OTHER}`}
    >
      {method.toUpperCase()}
    </span>
  );
}
