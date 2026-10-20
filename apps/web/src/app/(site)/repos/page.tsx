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
    <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12">
      <div className="card animate-fade-up flex flex-col gap-5 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Repositories</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Add a public GitHub repository. Indexing usually takes seconds.
          </p>
        </div>
        <AddRepositoryForm />
      </div>

      {!result.ok ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {result.error}
        </p>
      ) : result.data.repositories.length === 0 ? (
        <div className="dot-grid rounded-xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
          <p className="font-medium">No repositories yet</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Paste a GitHub URL above to analyze your first codebase.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {result.data.repositories.map((repo, index) => {
            const snapshot = repo.latestSnapshot;
            const label = `${repo.owner}/${repo.name}`;
            return (
              <li
                key={repo.id}
                className="animate-fade-up"
                style={{ animationDelay: `${80 + index * 50}ms` }}
              >
                {snapshot ? (
                  <Link
                    href={`/repos/${snapshot.id}`}
                    className="card card-hover flex items-center justify-between gap-4 px-4 py-3"
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
                  <span className="card block px-4 py-3 font-medium">{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
