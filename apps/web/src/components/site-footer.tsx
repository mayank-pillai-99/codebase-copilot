import Link from 'next/link';
import { LogoMark } from './logo';

const REPO_URL = 'https://github.com/mayank-pillai-99/codebase-copilot';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/#demos', label: 'Demo repositories' },
      { href: '/register', label: 'Analyze a repository' },
      { href: '/eval', label: 'Retrieval evaluation' },
    ],
  },
  {
    title: 'Project',
    links: [
      { href: REPO_URL, label: 'Source on GitHub' },
      { href: `${REPO_URL}/blob/main/docs/SPEC.md`, label: 'Specification' },
      { href: `${REPO_URL}/tree/main/docs/decisions`, label: 'Design decisions' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-zinc-200 bg-white/50 dark:border-zinc-800 dark:bg-zinc-900/30">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]">
        <div className="flex flex-col gap-3">
          <Link href="/" className="flex w-fit items-center gap-2 font-semibold tracking-tight">
            <LogoMark className="size-6" />
            Codebase<span className="-ml-2 text-brand-600 dark:text-brand-400">Copilot</span>
          </Link>
          <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-400">
            Answers about any TypeScript or JavaScript codebase, grounded in the code and checked
            against it.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title} className="flex flex-col gap-3">
            <h2 className="font-mono text-xs tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
              {column.title}
            </h2>
            <ul className="flex flex-col gap-2 text-sm">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-zinc-700 transition-colors hover:text-brand-700 dark:text-zinc-300 dark:hover:text-brand-400"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-zinc-200 dark:border-zinc-800">
        <p className="mx-auto max-w-6xl px-4 py-4 font-mono text-xs text-zinc-500 dark:text-zinc-500">
          Runs on free tiers: the first visit after a quiet spell can take a minute to wake up.
        </p>
      </div>
    </footer>
  );
}
