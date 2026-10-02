'use client';

import { useEffect } from 'react';

/**
 * Starts a page at the top when it mounts. Next.js only scrolls the changed segment
 * into view, so arriving at a repository from lower down another page could land
 * past its header. Links to a line (#L42) keep their own scroll position.
 */
export function ScrollToTop() {
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  return null;
}
