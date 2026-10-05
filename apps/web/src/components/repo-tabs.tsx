'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';

export function RepoTabs({ snapshotId }: { snapshotId: string }) {
  const pathname = usePathname();
  const base = `/repos/${snapshotId}`;
  const tabs = [
    { href: base, label: 'Guide' },
    { href: `${base}/architecture`, label: 'Architecture' },
    { href: `${base}/insights`, label: 'Insights' },
    { href: `${base}/impact`, label: 'Impact' },
    { href: `${base}/routes`, label: 'Routes' },
    { href: `${base}/code`, label: 'Code' },
    { href: `${base}/chat`, label: 'Chat' },
  ];
  const activeIndex = tabs.findIndex((tab) =>
    tab.href === base ? pathname === base : pathname.startsWith(tab.href),
  );

  // One underline that slides to the active tab.
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const nav = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[activeIndex];
      setIndicator(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeIndex]);

  // On narrow screens the row scrolls: keep the current tab in view, and fade whichever
  // edge has more tabs beyond it so the rest are discoverable.
  const [more, setMore] = useState({ left: false, right: false });
  useLayoutEffect(() => {
    const row = nav.current;
    const el = refs.current[activeIndex];
    if (!row) return;
    if (el) row.scrollLeft = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
    const update = () =>
      setMore({
        left: row.scrollLeft > 1,
        right: row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
      });
    update();
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      row.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [activeIndex]);
  const mask =
    more.left || more.right
      ? `linear-gradient(to right, ${more.left ? 'transparent 0, black 2rem' : 'black 0'}, ${
          more.right ? 'black calc(100% - 2rem), transparent 100%' : 'black 100%'
        })`
      : undefined;

  return (
    <nav
      ref={nav}
      aria-label="Repository sections"
      className="relative flex gap-1 overflow-x-auto [scrollbar-width:none]"
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {tabs.map((tab, index) => {
        const active = index === activeIndex;
        return (
          <Link
            key={tab.href}
            ref={(el) => {
              refs.current[index] = el;
            }}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 rounded-t-md px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? 'text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
      {indicator && (
        <span
          aria-hidden
          className="absolute bottom-0 h-0.5 rounded-full bg-brand-500 transition-all duration-300 ease-[var(--ease-out-soft)]"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
    </nav>
  );
}
