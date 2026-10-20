'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { activeSection, repoSections, type RepoSectionId } from '@/lib/repo-sections';
import { useStoredValue, writeStored } from '@/lib/stored-value';

const COLLAPSED_KEY = 'workspace-sidebar-collapsed';

/** Section navigation down the left of the workspace (wider screens; phones get tabs). */
export function WorkspaceSidebar({ snapshotId }: { snapshotId: string }) {
  const pathname = usePathname();
  const current = activeSection(snapshotId, pathname);
  const collapsed = useStoredValue('local', COLLAPSED_KEY) === '1';
  // Chat isn't a section here: it opens beside whatever section is showing.
  const sections = repoSections(snapshotId).filter((s) => s.id !== 'chat');

  return (
    <nav
      aria-label="Repository sections"
      className={`hidden shrink-0 flex-col justify-between border-r border-zinc-200 bg-zinc-50/60 p-2 transition-[width] duration-200 md:flex dark:border-zinc-800 dark:bg-zinc-950 ${
        collapsed ? 'w-14' : 'w-48'
      }`}
    >
      <ul className="flex flex-col gap-0.5">
        {sections.map((section) => {
          const active = section.id === current;
          return (
            <li key={section.id}>
              <Link
                href={section.href}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? section.label : undefined}
                className={`relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-colors ${
                  active
                    ? 'bg-white font-medium text-zinc-900 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-y-2 -left-2 w-0.5 rounded-full bg-brand-500"
                  />
                )}
                <SectionIcon
                  id={section.id}
                  className={`size-[18px] shrink-0 ${active ? 'text-brand-600 dark:text-brand-400' : ''}`}
                />
                <span className={collapsed ? 'sr-only' : 'truncate'}>{section.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => writeStored('local', COLLAPSED_KEY, collapsed ? null : '1')}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
      >
        <svg {...iconProps} className={`size-[18px] shrink-0 ${collapsed ? 'rotate-180' : ''}`}>
          <path d="M4 5h16v14H4zM9 5v14" />
          <path d="m15 10-2 2 2 2" />
        </svg>
        {!collapsed && <span>Collapse</span>}
      </button>
    </nav>
  );
}

const iconProps = {
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

function SectionIcon({ id, className }: { id: RepoSectionId; className: string }) {
  return (
    <svg {...iconProps} className={className}>
      {ICONS[id]}
    </svg>
  );
}
