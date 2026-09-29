import Link from 'next/link';
import { LogoMark } from './logo';

const REPO_URL = 'https://github.com/mayank-pillai-99/codebase-copilot';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between dark:text-zinc-400">
        <div className="flex items-center gap-2">
          <LogoMark className="size-5" />
          <span>Codebase Copilot · answers grounded in the code, with citations.</span>
        </div>
        <div className="flex gap-4">
          <Link href="/eval" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Evaluation
          </Link>
          <a href={REPO_URL} className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Source on GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
