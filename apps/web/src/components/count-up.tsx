'use client';

import { useEffect, useState } from 'react';

/**
 * Counts from 0 to `value` once, easing out. Renders the final number straight away
 * for people who prefer reduced motion (and on the server, so there's no layout shift).
 */
export function CountUp({
  value,
  suffix = '',
  durationMs = 900,
}: {
  value: number;
  suffix?: string;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || value === 0) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return (
    <>
      {shown.toLocaleString('en-US')}
      {suffix}
    </>
  );
}
