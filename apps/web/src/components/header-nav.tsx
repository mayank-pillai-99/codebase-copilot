'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LogoMark } from './logo';
import { LogoutButton } from './logout-button';

const REPO_URL = 'https://github.com/mayank-pillai-99/codebase-copilot';

interface NavItem {
  href: string;
  label: string;
}

/**
 * The site header: wordmark, a pill of section links with a highlight that slides to
 * the current page, and account actions. It gains a shadow and an accent hairline once
 * the page scrolls; on small screens the links move into a menu.
 */
export function HeaderNav({ email }: { email: string | null }) {
  const pathname = usePathname();
  const items: NavItem[] = [
    { href: '/#features', label: 'Features' },
    { href: '/#how-it-works', label: 'How it works' },
    { href: '/#demos', label: 'Demos' },
    ...(email ? [{ href: '/repos', label: 'Repositories' }] : []),
  ];
  const isActive = (href: string) =>
    !href.includes('#') && (pathname === href || pathname.startsWith(`${href}/`));
  const activeIndex = items.findIndex((item) => isActive(item.href));

  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[activeIndex];
      setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeIndex, items.length]);

  return (
    <header
      className={`sticky top-0 z-40 transition-[background-color,box-shadow,border-color] duration-300 ${
        scrolled || menuOpen
          ? 'border-b border-zinc-200/80 bg-white/80 shadow-sm shadow-zinc-900/5 backdrop-blur-lg dark:border-zinc-800/80 dark:bg-zinc-950/80 dark:shadow-black/30'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      {/* Accent hairline, visible once scrolled. */}
      <div
        aria-hidden
        className={`absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand-500/60 to-transparent transition-opacity duration-300 ${
          scrolled ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <LogoMark className="size-7 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105" />
          <span className="text-[15px] font-semibold tracking-tight">
            Codebase<span className="text-brand-600 dark:text-brand-400">Copilot</span>
          </span>
          <span className="hidden rounded-full border border-zinc-200 px-1.5 py-px font-mono text-[10px] text-zinc-500 lg:inline dark:border-zinc-800 dark:text-zinc-400">
            TS · JS
          </span>
        </Link>

        <div className="relative hidden items-center rounded-full border border-zinc-200 bg-white/70 p-1 shadow-sm shadow-zinc-900/5 md:flex dark:border-zinc-800 dark:bg-zinc-900/70">
          {pill && (
            <span
              aria-hidden
              className="absolute top-1 bottom-1 rounded-full bg-zinc-900 transition-all duration-300 ease-[var(--ease-out-soft)] dark:bg-zinc-100"
              style={{ left: pill.left, width: pill.width }}
            />
          )}
          {items.map((item, index) => {
            const active = index === activeIndex;
            return (
              <Link
                key={item.label}
                ref={(el) => {
                  refs.current[index] = el;
                }}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`relative z-10 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors duration-200 ${
                  active
                    ? 'font-medium text-white dark:text-zinc-900'
                    : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <a
            href={REPO_URL}
            className="hidden size-9 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 sm:flex dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Source code on GitHub"
            title="Source code on GitHub"
          >
            <GitHubIcon className="size-[18px]" />
          </a>
          {email ? (
            <div className="hidden items-center gap-3 md:flex">
              <span
                className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800 uppercase ring-2 ring-white dark:bg-brand-900 dark:text-brand-200 dark:ring-zinc-950"
                title={email}
              >
                {email[0]}
              </span>
              <LogoutButton />
            </div>
          ) : (
            <div className="hidden items-center gap-1 md:flex">
              <Link
                href="/login"
                className="rounded-full px-3.5 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                Log in
              </Link>
              <Link href="/register" className="btn-primary rounded-full px-4 py-1.5">
                Get started
              </Link>
            </div>
          )}
          <button
            type="button"
            className="flex size-9 items-center justify-center rounded-full text-zinc-700 transition hover:bg-zinc-100 md:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
            >
              <path
                d={menuOpen ? 'M6 6l12 12' : 'M4 7h16'}
                className="transition-all duration-200"
              />
              <path
                d={menuOpen ? 'M18 6L6 18' : 'M4 12h16'}
                className="transition-all duration-200"
              />
              {!menuOpen && <path d="M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div
          id="mobile-menu"
          className="animate-fade-up border-t border-zinc-200 px-4 pt-2 pb-4 md:hidden dark:border-zinc-800"
        >
          <ul className="flex flex-col">
            {items.map((item, i) => (
              <li
                key={item.label}
                className="animate-fade-up"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <Link
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm ${
                    isActive(item.href)
                      ? 'bg-brand-50 font-medium text-brand-900 dark:bg-brand-950 dark:text-brand-200'
                      : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  {item.label}
                  <span aria-hidden className="text-zinc-400">
                    →
                  </span>
                </Link>
              </li>
            ))}
            <li>
              <a
                href={REPO_URL}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <GitHubIcon className="size-4" /> Source on GitHub
              </a>
            </li>
          </ul>
          <div className="mt-3 flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            {email ? (
              <div className="flex w-full items-center justify-between px-3 text-sm text-zinc-600 dark:text-zinc-400">
                <span className="truncate">{email}</span>
                <LogoutButton />
              </div>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="btn-secondary flex-1"
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMenuOpen(false)}
                  className="btn-primary flex-1"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function GitHubIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={`fill-current ${className}`}>
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  );
}
