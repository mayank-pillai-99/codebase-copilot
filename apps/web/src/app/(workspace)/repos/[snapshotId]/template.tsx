import type { ReactNode } from 'react';

/** Tab content rises in when switching tabs; the header and tabs stay put. */
export default function TabTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-fade-up">{children}</div>;
}
