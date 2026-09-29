import { snapshotResponseSchema, type SnapshotDto } from '@codebase-copilot/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { RepoTabs } from '@/components/repo-tabs';
import { ServerWaking } from '@/components/server-waking';
import { StatusBadge } from '@/components/status-badge';
import { shortSha } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import { getCurrentUser } from '@/lib/session';

export async function generateMetadata(
  props: LayoutProps<'/repos/[snapshotId]'>,
): Promise<Metadata> {
  const { snapshotId } = await props.params;
  const result = await serverApi(`/api/snapshots/${snapshotId}`, snapshotResponseSchema);
  const name = result.ok
    ? `${result.data.snapshot.repository.owner}/${result.data.snapshot.repository.name}`
    : 'Repository';
  return { title: `${name} · Codebase Copilot` };
}

export default async function SnapshotLayout(props: LayoutProps<'/repos/[snapshotId]'>) {
  const { snapshotId } = await props.params;
  // Demo repositories are public, so a session is optional here; the API decides access.
  const [user, result] = await Promise.all([
    getCurrentUser(),
    serverApi(`/api/snapshots/${snapshotId}`, snapshotResponseSchema),
  ]);
  if (!result.ok && result.status === 404) {
    // Not visible anonymously: it may be the visitor's own repository once they log in.
    if (!user) redirect(`/login?next=${encodeURIComponent(`/repos/${snapshotId}`)}`);
    notFound();
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <Link
        href={user ? '/repos' : '/'}
        className="group inline-flex w-fit items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <span className="transition-transform group-hover:-translate-x-0.5">←</span>
        {user ? 'Repositories' : 'Home'}
      </Link>
      {!user && result.ok && (
        <p className="flex animate-fade-in items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-900 dark:border-brand-900 dark:bg-brand-950/50 dark:text-brand-200">
          <span className="size-1.5 shrink-0 rounded-full bg-brand-500" />
          <span>
            You&apos;re exploring a demo repository.{' '}
            <Link href="/register" className="font-medium underline underline-offset-4">
              Sign up
            </Link>{' '}
            to analyze your own.
          </span>
        </p>
      )}
      {result.ok ? (
        <>
          <Header snapshot={result.data.snapshot} />
          <RepoTabs snapshotId={snapshotId} />
          {props.children as ReactNode}
        </>
      ) : result.unreachable ? (
        <ServerWaking />
      ) : (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {result.error}
        </p>
      )}
    </main>
  );
}

function Header({
  snapshot,
}: {
  snapshot: {
    repository: { owner: string; name: string };
    ref: string;
    commitSha: string;
    status: SnapshotDto['status'];
  };
}) {
  const { owner, name } = snapshot.repository;
  return (
    <header className="flex min-w-0 animate-fade-up flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-mono text-sm text-zinc-500 dark:text-zinc-400">{owner} /</p>
        <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">{name}</h1>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
        {/* In-progress status is shown live on the overview; here only settled states. */}
        {(snapshot.status === 'READY' || snapshot.status === 'FAILED') && (
          <StatusBadge status={snapshot.status} />
        )}
        <a
          href={`https://github.com/${owner}/${name}/tree/${snapshot.commitSha}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-mono text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          title="Open this commit on GitHub"
        >
          <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 fill-current">
            <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
          </svg>
          {snapshot.ref} @ {shortSha(snapshot.commitSha)}
        </a>
      </div>
    </header>
  );
}
