'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeSection, repoSections } from '@/lib/repo-sections';
import { useStoredValue, writeStored } from '@/lib/stored-value';
import { iconProps, SectionIcon } from '../section-icon';

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
