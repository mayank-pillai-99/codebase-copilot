'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Header link that marks the section you're in. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`relative rounded-md px-2 py-1 text-sm whitespace-nowrap transition-colors ${
        active
          ? 'font-medium text-zinc-900 dark:text-zinc-100'
          : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
      }`}
    >
      {children}
      {active && (
        <span className="absolute inset-x-2 -bottom-[13px] h-0.5 animate-fade-in rounded-full bg-brand-500" />
      )}
    </Link>
  );
}
