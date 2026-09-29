'use client';

import { useEffect } from 'react';

/** Brings the highlighted range into view after navigation (the #L anchor alone isn't enough across client routing). */
export function ScrollToLine({ line }: { line: number | null }) {
  useEffect(() => {
    if (line === null) return;
    document.getElementById(`L${line}`)?.scrollIntoView({ block: 'center' });
  }, [line]);
  return null;
}
