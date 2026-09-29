import { snapshotResponseSchema } from '@codebase-copilot/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { RepoTabs } from '@/components/repo-tabs';
import { ServerWaking } from '@/components/server-waking';
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
        className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        {user ? '← Repositories' : '← Home'}
      </Link>
      {!user && result.ok && (
        <p className="rounded-lg bg-sky-50 px-4 py-2 text-sm text-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
          You&apos;re exploring a demo repository.{' '}
          <Link href="/register" className="font-medium underline underline-offset-4">
            Sign up
          </Link>{' '}
          to analyze your own.
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
  snapshot: { repository: { owner: string; name: string }; ref: string; commitSha: string };
}) {
  const { owner, name } = snapshot.repository;
  return (
    <header className="min-w-0">
      <h1 className="truncate text-2xl font-semibold tracking-tight">
        {owner}/{name}
      </h1>
      <p className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
        {snapshot.ref} @{' '}
        <a
          href={`https://github.com/${owner}/${name}/tree/${snapshot.commitSha}`}
          className="underline-offset-4 hover:underline"
        >
          {shortSha(snapshot.commitSha)}
        </a>
      </p>
    </header>
  );
}
