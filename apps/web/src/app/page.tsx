import { repositoryListResponseSchema } from '@codebase-copilot/shared';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { HeroVisual } from '@/components/hero-visual';
import { ServerWaking } from '@/components/server-waking';
import { SystemStatus } from '@/components/system-status';
import { fetchHealth } from '@/lib/api';
import { serverApi } from '@/lib/server-api';
import { getCurrentUser } from '@/lib/session';

// Health and the demo list must be checked per request, not at build time.
export const dynamic = 'force-dynamic';

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

export default async function HomePage() {
  const [health, user, demo] = await Promise.all([
    fetchHealth(),
    getCurrentUser(),
    serverApi('/api/demo', repositoryListResponseSchema),
  ]);
  const demos = demo.ok ? demo.data.repositories.filter((r) => r.latestSnapshot) : [];
  const firstDemo = demos[0]?.latestSnapshot?.id;
  const tab = (path: string) => (firstDemo ? `/repos/${firstDemo}${path}` : '#demos');

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-24 px-4 pt-12 pb-8 sm:pt-20">
      {/* A soft glow behind the hero: full-width radial gradients that fade out on their own. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[46rem] bg-[radial-gradient(38rem_24rem_at_78%_38%,color-mix(in_oklab,var(--color-brand-300)_30%,transparent),transparent_70%),radial-gradient(22rem_16rem_at_52%_62%,color-mix(in_oklab,var(--color-violet-300)_16%,transparent),transparent_70%)] dark:bg-[radial-gradient(38rem_24rem_at_78%_38%,color-mix(in_oklab,var(--color-brand-600)_16%,transparent),transparent_70%),radial-gradient(22rem_16rem_at_52%_62%,color-mix(in_oklab,var(--color-violet-600)_10%,transparent),transparent_70%)]"
      />
      <section className="grid items-center gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12">
        <div className="flex flex-col gap-6">
          <p
            className="animate-fade-up inline-flex w-fit items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
            style={delay(0)}
          >
            <span className="size-1.5 rounded-full bg-brand-500" />
            For TypeScript and JavaScript repositories on GitHub
          </p>
          <h1
            className="animate-fade-up text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
            style={delay(80)}
          >
            Understand any codebase, grounded in{' '}
            <span className="relative whitespace-nowrap text-brand-700 dark:text-brand-400">
              the actual code
              <svg
                aria-hidden
                viewBox="0 0 200 8"
                preserveAspectRatio="none"
                className="absolute -bottom-1.5 left-0 h-2 w-full"
              >
                <path
                  d="M2 6 C 50 1, 150 1, 198 5"
                  pathLength={1}
                  strokeDasharray="1"
                  fill="none"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  className="animate-draw stroke-brand-400/70"
                  style={delay(700)}
                />
              </svg>
            </span>
            .
          </h1>
          <p
            className="animate-fade-up max-w-xl text-lg text-zinc-600 dark:text-zinc-400"
            style={delay(160)}
          >
            Paste a GitHub URL. Codebase Copilot parses the repository into a map of its symbols,
            imports, calls and HTTP routes, then answers questions with citations to the exact files
            and lines they came from.
          </p>
          <div className="animate-fade-up flex flex-wrap gap-3" style={delay(240)}>
            <Link
              href={firstDemo ? `/repos/${firstDemo}` : '#demos'}
              className="btn-primary px-5 py-2.5"
            >
              Try a demo, no account
              <Arrow />
            </Link>
            <Link href={user ? '/repos' : '/register'} className="btn-secondary px-5 py-2.5">
              {user ? 'Your repositories' : 'Analyze your repository'}
            </Link>
          </div>
          <p
            className="animate-fade-up font-mono text-xs text-zinc-500 dark:text-zinc-500"
            style={delay(320)}
          >
            tree-sitter parsing · hybrid search · citations checked on the server
          </p>
        </div>
        <div className="animate-fade-up pb-10 lg:pb-0" style={delay(200)}>
          <HeroVisual />
        </div>
      </section>

      <section className="flex flex-col gap-8">
        <SectionTitle eyebrow="How it works" title="From a URL to answers you can check" />
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            [
              'Parse',
              'The repository is downloaded at one commit and parsed with tree-sitter: symbols, imports, calls and routes. Nothing from it is ever run.',
            ],
            [
              'Map',
              'Imports become an architecture map, calls become traceable request flows, and every function becomes a searchable, embedded chunk.',
            ],
            [
              'Ask',
              'Questions are answered from retrieved code only. Every [n] citation is checked on the server and opens the exact lines.',
            ],
          ].map(([title, body], i) => (
            <li key={title} className="card flex flex-col gap-3 p-5">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand-50 font-mono text-sm font-semibold text-brand-700 ring-1 ring-brand-200 dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-800">
                {i + 1}
              </span>
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-8">
        <SectionTitle eyebrow="What you get" title="Four ways into an unfamiliar codebase" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Feature
            href={tab('/architecture')}
            title="Architecture map"
            body="Folders, the imports between them and the services they use, with the import lines behind every arrow."
            icon={<IconMap />}
          />
          <Feature
            href={tab('/routes')}
            title="Request tracing"
            body="Pick a route and follow its handler into the functions it calls, line by line."
            icon={<IconTrace />}
          />
          <Feature
            href={tab('/chat')}
            title="Answers with citations"
            body="Streamed answers grounded in retrieved code. Each citation links to the lines it came from."
            icon={<IconChat />}
          />
          <Feature
            href="/eval"
            title="Measured retrieval"
            body="A public benchmark compares vector, full-text and hybrid search on pinned open-source repositories."
            icon={<IconChart />}
          />
        </div>
      </section>

      {!demo.ok && demo.unreachable ? (
        <ServerWaking />
      ) : demos.length > 0 ? (
        <section id="demos" className="flex scroll-mt-20 flex-col gap-8">
          <SectionTitle eyebrow="No account needed" title="Try it on a demo repository" />
          <ul className="grid gap-4 sm:grid-cols-2">
            {demos.map((repo) => (
              <li key={repo.id}>
                <Link
                  href={`/repos/${repo.latestSnapshot!.id}`}
                  className="card card-hover group flex h-full flex-col gap-2 p-5"
                >
                  <span className="font-mono text-sm font-semibold break-all">
                    {repo.owner}/
                    <span className="text-brand-700 dark:text-brand-400">{repo.name}</span>
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {repo.latestSnapshot!.stats
                      ? `${repo.latestSnapshot!.stats.files.code.toLocaleString('en-US')} source files · ${repo.latestSnapshot!.stats.routes} routes · ${repo.latestSnapshot!.stats.symbols} symbols`
                      : 'Indexed'}
                  </span>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-400">
                    Explore the map and chat
                    <Arrow className="transition-transform duration-200 group-hover:translate-x-1" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SystemStatus result={health} />
    </main>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs tracking-wider text-brand-700 uppercase dark:text-brand-400">
        {eyebrow}
      </p>
      <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h2>
    </div>
  );
}

function Feature({
  href,
  title,
  body,
  icon,
}: {
  href: string;
  title: string;
  body: string;
  icon: ReactNode;
}) {
  return (
    <Link href={href} className="card card-hover group flex gap-4 p-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 transition-colors duration-200 group-hover:bg-brand-50 group-hover:text-brand-700 dark:bg-zinc-800 dark:text-zinc-300 dark:group-hover:bg-brand-950 dark:group-hover:text-brand-300">
        {icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="font-semibold">{title}</span>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{body}</span>
      </span>
    </Link>
  );
}

function Arrow({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={`size-4 ${className}`}>
      <path
        d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'size-5',
  'aria-hidden': true,
};

function IconMap() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="8.5" y="16" width="7" height="5" rx="1.5" />
      <path d="M6.5 8v3.5h11V8M12 11.5V16" />
    </svg>
  );
}
function IconTrace() {
  return (
    <svg {...iconProps}>
      <path d="M4 5h6M7 5v14M7 12h6M13 12v7M13 19h7" />
      <circle cx="4" cy="5" r="1" />
      <circle cx="20" cy="19" r="1" />
    </svg>
  );
}
function IconChat() {
  return (
    <svg {...iconProps}>
      <path d="M4 5h16v10H9l-5 4z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg {...iconProps}>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </svg>
  );
}
