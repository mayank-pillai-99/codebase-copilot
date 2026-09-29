import { routeListResponseSchema, snapshotResponseSchema } from '@codebase-copilot/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SnapshotView } from '@/components/snapshot-view';
import { serverApi } from '@/lib/server-api';
import { requireUser } from '@/lib/session';

export async function generateMetadata(props: PageProps<'/repos/[snapshotId]'>): Promise<Metadata> {
  const { snapshotId } = await props.params;
  const result = await serverApi(`/api/snapshots/${snapshotId}`, snapshotResponseSchema);
  const name = result.ok
    ? `${result.data.snapshot.repository.owner}/${result.data.snapshot.repository.name}`
    : 'Repository';
  return { title: `${name} · Codebase Copilot` };
}

export default async function SnapshotPage(props: PageProps<'/repos/[snapshotId]'>) {
  const { snapshotId } = await props.params;
  await requireUser(`/repos/${snapshotId}`);
  const result = await serverApi(`/api/snapshots/${snapshotId}`, snapshotResponseSchema);
  if (!result.ok && result.status === 404) notFound();
  const routes =
    result.ok && result.data.snapshot.status === 'READY'
      ? await serverApi(`/api/snapshots/${snapshotId}/routes`, routeListResponseSchema)
      : null;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-12">
      <Link
        href="/repos"
        className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        ← Repositories
      </Link>
      {result.ok ? (
        <SnapshotView
          initial={result.data.snapshot}
          initialRoutes={routes?.ok ? routes.data.routes : null}
        />
      ) : (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {result.error}
        </p>
      )}
    </main>
  );
}
