import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { LogoutButton } from './logout-button';

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Codebase Copilot
        </Link>
        {user ? (
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/eval" className="text-sm font-medium">
              Evaluation
            </Link>
            <Link href="/repos" className="text-sm font-medium">
              Repositories
            </Link>
            <span className="hidden truncate text-sm text-zinc-500 sm:inline dark:text-zinc-400">
              {user.email}
            </span>
            <LogoutButton />
          </div>
        ) : (
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/eval"
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Evaluation
            </Link>
            <Link
              href="/login"
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Sign up
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}
