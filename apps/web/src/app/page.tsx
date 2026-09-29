import { SystemStatus } from '@/components/system-status';
import { fetchHealth } from '@/lib/api';

// Health must be checked per request, not at build time.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const result = await fetchHealth();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-10 px-4 py-16 sm:py-24">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Codebase Copilot</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Understand any codebase, grounded in the actual code.
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Paste a GitHub URL and get an onboarding guide, an architecture map, and answers that cite
          the exact files and lines they came from.
        </p>
      </header>

      <SystemStatus result={result} />

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        Early development — repository indexing arrives in a later milestone.
      </p>
    </main>
  );
}
