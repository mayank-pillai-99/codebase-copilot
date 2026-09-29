'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Shown when the API doesn't answer. Free-tier hosts sleep when idle and take up
 * to a minute to wake, so this polls the health endpoint and refreshes the page
 * as soon as the API is back.
 */
export function ServerWaking() {
  const router = useRouter();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    let stopped = false;
    const tick = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    const poll = async () => {
      while (!stopped) {
        try {
          const res = await fetch('/api/health', { cache: 'no-store' });
          if (res.status < 500 || res.status === 503) {
            // Any answer (even "degraded") means the API process is up.
            router.refresh();
            return;
          }
        } catch {
          // Still asleep.
        }
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearInterval(tick);
    };
  }, [router]);

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900"
    >
      <span aria-hidden className="size-3 animate-ping rounded-full bg-sky-500" />
      <p className="font-medium">Waking up the server…</p>
      <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
        This demo runs on free hosting that sleeps when idle. It usually takes under a minute
        {seconds > 0 ? ` (${seconds}s so far)` : ''}. The page will refresh by itself.
      </p>
    </div>
  );
}
