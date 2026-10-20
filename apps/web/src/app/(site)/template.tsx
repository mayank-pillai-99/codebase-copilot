import type { ReactNode } from 'react';

/** Remounts on navigation between top-level pages, so each one fades in. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="animate-fade-in">{children}</div>;
}
