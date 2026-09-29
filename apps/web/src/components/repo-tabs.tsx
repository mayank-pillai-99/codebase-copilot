'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function RepoTabs({ snapshotId }: { snapshotId: string }) {
  const pathname = usePathname();
  const base = `/repos/${snapshotId}`;
  const tabs = [
    { href: base, label: 'Overview' },
    { href: `${base}/code`, label: 'Code' },
    { href: `${base}/chat`, label: 'Chat' },
  ];

  return (
    <nav
      aria-label="Repository sections"
      className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800"
    >
      {tabs.map((tab) => {
        const active = tab.href === base ? pathname === base : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
