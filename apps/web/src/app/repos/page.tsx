import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Repositories · Codebase Copilot' };

export default async function ReposPage() {
  await requireUser('/repos');

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Repositories</h1>
      <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
        <p className="font-medium">No repositories yet</p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Indexing a GitHub repository is the next thing being built.
        </p>
      </div>
    </main>
  );
}
