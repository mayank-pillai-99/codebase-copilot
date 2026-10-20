import type { SnapshotDto } from '@codebase-copilot/shared';
import Link from 'next/link';
import { shortSha } from '@/lib/format';
import { CommandPalette } from '../command-palette';
import { LogoMark } from '../logo';
import { LogoutButton } from '../logout-button';
import { StatusBadge } from '../status-badge';
import { ThemeToggle } from '../theme-toggle';
import { ChatDockToggle } from './chat-dock';

/**
 * The workspace's one bar: where you are (repository and commit), search, chat, theme
 * and account. Replaces the marketing header on repository pages.
 */
export function WorkspaceTopBar({
  snapshot,
  email,
}: {
  snapshot: SnapshotDto | null;
  email: string | null;
}) {
  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white/90 px-3 backdrop-blur-lg md:static md:px-4 dark:border-zinc-800 dark:bg-zinc-950/90">
      <Link
        href={email ? '/repos' : '/'}
        className="group shrink-0"
        aria-label={email ? 'Your repositories' : 'Codebase Copilot home'}
        title={email ? 'Your repositories' : 'Codebase Copilot home'}
      >
        <LogoMark className="size-7 transition-transform duration-300 group-hover:-rotate-6" />
      </Link>
      <span aria-hidden className="h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-800" />

      {snapshot ? <Location snapshot={snapshot} /> : <div className="flex-1" />}

      <div className="flex shrink-0 items-center gap-1.5">
        {snapshot?.status === 'READY' && <CommandPalette snapshotId={snapshot.id} />}
        <ChatDockToggle />
        <ThemeToggle />
        {email ? (
          <div className="hidden items-center gap-3 pl-1 md:flex">
            <span
              className="flex size-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800 uppercase dark:bg-brand-900 dark:text-brand-200"
              title={email}
            >
              {email[0]}
            </span>
            <LogoutButton />
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span
              className="hidden rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800 xl:inline dark:border-brand-900 dark:bg-brand-950/50 dark:text-brand-200"
              title="You're exploring a demo repository. Sign up to analyze your own."
            >
              Demo
            </span>
            <Link
              href="/login"
              className="hidden rounded-md px-2.5 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 md:inline dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="btn-primary px-3 py-1.5"
              title="Sign up to analyze your own repository"
            >
              Sign up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

function Location({ snapshot }: { snapshot: SnapshotDto }) {
  const { owner, name } = snapshot.repository;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <h1 className="flex min-w-0 items-baseline gap-1 text-sm">
        <span className="hidden truncate font-mono text-zinc-500 xl:inline dark:text-zinc-400">
          {owner} /
        </span>
        <span className="truncate font-semibold tracking-tight">{name}</span>
      </h1>
      {/* In-progress status is shown live on the guide; here only settled states. */}
      {(snapshot.status === 'READY' || snapshot.status === 'FAILED') && (
        <span className="hidden shrink-0 sm:inline-flex">
          <StatusBadge status={snapshot.status} />
        </span>
      )}
      <a
        href={`https://github.com/${owner}/${name}/tree/${snapshot.commitSha}`}
        className="hidden shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-0.5 font-mono text-xs text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 xl:inline-flex dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        title="Open this commit on GitHub"
      >
        <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 fill-current">
          <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
        </svg>
        {snapshot.ref} @ {shortSha(snapshot.commitSha)}
      </a>
    </div>
  );
}
