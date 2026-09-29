import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { LogoMark } from './logo';
import { LogoutButton } from './logout-button';
import { NavLink } from './nav-link';

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-zinc-50/80 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/75">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          className="group flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <LogoMark className="size-6 transition-transform duration-300 group-hover:rotate-[8deg]" />
          <span className="hidden min-[380px]:inline">Codebase Copilot</span>
        </Link>
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <span className="hidden sm:contents">
            <NavLink href="/eval">Evaluation</NavLink>
          </span>
          {user ? (
            <>
              <NavLink href="/repos">Repositories</NavLink>
              <span className="hidden max-w-48 truncate text-sm text-zinc-500 md:inline dark:text-zinc-400">
                {user.email}
              </span>
              <LogoutButton />
            </>
          ) : (
            <>
              <NavLink href="/login">Log in</NavLink>
              <Link href="/register" className="btn-primary px-3 py-1.5 whitespace-nowrap">
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
