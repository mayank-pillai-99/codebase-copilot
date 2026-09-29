import { snapshotResponseSchema } from '@codebase-copilot/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { RepoTabs } from '@/components/repo-tabs';
import { shortSha } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import { requireUser } from '@/lib/session';

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
  await requireUser(`/repos/${snapshotId}`);
  const result = await serverApi(`/api/snapshots/${snapshotId}`, snapshotResponseSchema);
  if (!result.ok && result.status === 404) notFound();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <Link
        href="/repos"
        className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        ← Repositories
      </Link>
      {result.ok ? (
        <>
          <Header snapshot={result.data.snapshot} />
          <RepoTabs snapshotId={snapshotId} />
          {props.children as ReactNode}
        </>
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
