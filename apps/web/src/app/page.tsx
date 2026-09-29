import { repositoryListResponseSchema } from '@codebase-copilot/shared';
import Link from 'next/link';
import { ServerWaking } from '@/components/server-waking';
import { SystemStatus } from '@/components/system-status';
import { fetchHealth } from '@/lib/api';
import { serverApi } from '@/lib/server-api';
import { getCurrentUser } from '@/lib/session';

// Health and the demo list must be checked per request, not at build time.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [health, user, demo] = await Promise.all([
    fetchHealth(),
    getCurrentUser(),
    serverApi('/api/demo', repositoryListResponseSchema),
  ]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-12 px-4 py-16 sm:py-24">
      <header className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Understand any codebase, grounded in the actual code.
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Paste a GitHub URL. Codebase Copilot parses the repository into a map of its symbols,
          imports, calls and HTTP routes, then answers questions with citations to the exact files
          and lines they came from.
        </p>
        <div>
          <Link
            href={user ? '/repos' : '/register'}
            className="inline-block rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {user ? 'Go to your repositories' : 'Analyze your own repository'}
          </Link>
        </div>
      </header>

      {!demo.ok && demo.unreachable ? (
        <ServerWaking />
      ) : demo.ok && demo.data.repositories.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Try it on a demo repository</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No account needed.</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {demo.data.repositories.map((repo) =>
              repo.latestSnapshot ? (
                <li key={repo.id}>
                  <Link
                    href={`/repos/${repo.latestSnapshot.id}`}
                    className="flex h-full flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
                  >
                    <span className="font-medium">
                      {repo.owner}/{repo.name}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {repo.latestSnapshot.stats
                        ? `${repo.latestSnapshot.stats.files.code.toLocaleString('en-US')} source files · ${repo.latestSnapshot.stats.routes} routes`
                        : 'Indexed'}
                    </span>
                    <span className="mt-2 text-sm font-medium text-sky-700 dark:text-sky-400">
                      Explore and chat →
                    </span>
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      ) : null}

      <SystemStatus result={health} />
    </main>
  );
}
