import { repositoryListResponseSchema } from '@codebase-copilot/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AddRepositoryForm } from '@/components/add-repository-form';
import { StatusBadge } from '@/components/status-badge';
import { shortSha } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Repositories · Codebase Copilot' };

export default async function ReposPage() {
  await requireUser('/repos');
  const result = await serverApi('/api/repos', repositoryListResponseSchema);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-12">
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Repositories</h1>
        <AddRepositoryForm />
      </div>

      {!result.ok ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {result.error}
        </p>
      ) : result.data.repositories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
          <p className="font-medium">No repositories yet</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Paste a GitHub URL above to analyze your first codebase.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {result.data.repositories.map((repo) => {
            const snapshot = repo.latestSnapshot;
            const label = `${repo.owner}/${repo.name}`;
            return (
              <li key={repo.id}>
                {snapshot ? (
                  <Link
                    href={`/repos/${snapshot.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{label}</span>
                      <span className="block truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {snapshot.ref} @ {shortSha(snapshot.commitSha)}
                      </span>
                    </span>
                    <StatusBadge status={snapshot.status} />
                  </Link>
                ) : (
                  <span className="block px-4 py-3 font-medium">{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
