'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { activeSection } from '@/lib/repo-sections';

/**
 * The section's own area. Reading sections keep a comfortable line length; the map and
 * the code viewer use all the width the sidebar and chat panel leave.
 */
export function WorkspaceContent({
  snapshotId,
  children,
}: {
  snapshotId: string;
  children: ReactNode;
}) {
  const section = activeSection(snapshotId, usePathname());
  const wide = section === 'architecture' || section === 'code';
  return (
    <div className={`px-4 py-6 md:px-6 ${wide ? '' : 'mx-auto w-full max-w-6xl'}`}>{children}</div>
  );
}
