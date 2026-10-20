import type { ReactNode } from 'react';
import type { RepoSectionId } from '@/lib/repo-sections';

export const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const ICONS: Record<RepoSectionId, ReactNode> = {
  // An open book.
  guide: (
    <path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13" />
  ),
  // Three linked boxes.
  architecture: (
    <>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v4M6 16v-2h12v2" />
    </>
  ),
  // Bars.
  insights: <path d="M5 20V11M10 20V5M15 20v-6M20 20V8" />,
  // A ripple from a point.
  impact: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
    </>
  ),
  // A branching path.
  routes: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M8 6h5a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3h-2a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3h5" />
    </>
  ),
  code: <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  chat: <path d="M4 5h16v10H9l-5 4zM8 9h8M8 12h5" />,
};

/** A repository section's icon, shared by the workspace sidebar and the landing page. */
export function SectionIcon({ id, className }: { id: RepoSectionId; className: string }) {
  return (
    <svg {...iconProps} className={className}>
      {ICONS[id]}
    </svg>
  );
}
