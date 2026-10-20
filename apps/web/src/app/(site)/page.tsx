import { repositoryListResponseSchema } from '@codebase-copilot/shared';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { HeroVisual } from '@/components/hero-visual';
import { iconProps, SectionIcon } from '@/components/section-icon';
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
            Paste a GitHub URL and start from an onboarding guide built from the parsed code. Then
            map the architecture, trace requests, see what a change could break, and ask questions
            with citations to the exact files and lines.
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
            tree-sitter parsing · call graphs · citations checked on the server
          </p>
        </div>
        <div className="animate-fade-up pb-10 lg:pb-0" style={delay(200)}>
          <HeroVisual />
        </div>
      </section>

      <section id="how-it-works" className="flex scroll-mt-24 flex-col gap-8">
        <SectionTitle
          eyebrow="How it works"
          title="From a URL to a codebase you can find your way around"
        />
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            [
              'Parse',
              'The repository is downloaded at one commit and parsed with tree-sitter into symbols, imports, calls and HTTP routes. Nothing from it is installed or run.',
            ],
            [
              'Analyze',
              "Resolved imports and calls form a graph. The guide's facts, the architecture map, request traces, insights and change impact are all computed from it, without AI.",
            ],
            [
              'Ask',
              'Every function is embedded and indexed for full-text search. Answers use retrieved code only, and every [n] citation is checked on the server before it links to the lines.',
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

      <section id="features" className="flex scroll-mt-24 flex-col gap-8">
        <SectionTitle
          eyebrow="What you get"
          title="Start with a guide, then go as deep as you need"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Feature
            href={tab('')}
            title="Onboarding guide"
            body="Every repository opens on a guide: facts from the code, each linked to the file that shows it, under a short summary that is the one AI-written part."
            tags={[CODE_FACTS, AI_SUMMARY]}
            icon={<SectionIcon id="guide" className="size-5" />}
            wide
          >
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {[
                'Tech stack',
                'Start reading here',
                'Key request flows',
                'Architecture at a glance',
                'Data model',
                'External services',
                'Configuration',
              ].map((part) => (
                <li
                  key={part}
                  className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                >
                  {part}
                </li>
              ))}
            </ul>
          </Feature>
          <Feature
            href={tab('/chat')}
            title="Answers with citations"
            body="Streamed answers built only from retrieved code. Each citation is checked on the server, and chat docks beside every section, so a citation opens the code next to the answer."
            tags={[AI_WRITTEN]}
            icon={<SectionIcon id="chat" className="size-5" />}
          />
          <Feature
            href={tab('/code')}
            title="Search and navigate like an IDE"
            body="Press ⌘K to search file names and code as you type. Files open at the indexed commit beside a References panel: who calls a function and what it calls."
            tags={[NO_AI]}
            icon={<IconSearch />}
          />
          <Feature
            href={tab('/architecture')}
            title="Architecture map"
            body="Folders, the imports between them and the external services they use, with the import lines behind every arrow."
            tags={[NO_AI]}
            icon={<SectionIcon id="architecture" className="size-5" />}
          />
          <Feature
            href={tab('/routes')}
            title="Request tracing"
            body="Pick a route and follow its handler into the functions it calls, line by line. Calls that can't be resolved are shown as unresolved, not guessed."
            tags={[NO_AI]}
            icon={<SectionIcon id="routes" className="size-5" />}
          />
          <Feature
            href={tab('/insights')}
            title="Insights"
            body="A health check from the code graph: the most-called and longest functions, the riskiest files to change, which tests to read, and import cycles."
            tags={[NO_AI]}
            icon={<SectionIcon id="insights" className="size-5" />}
          />
          <Feature
            href={tab('/impact')}
            title="Change impact"
            body="Pick a function and see what could break: every caller, the HTTP routes that reach it, each with its shortest call chain, and the tests that exercise it."
            tags={[NO_AI]}
            icon={<SectionIcon id="impact" className="size-5" />}
          />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Only chat answers and the guide&apos;s one-paragraph summary are written by AI, and both
          are labelled. Everything else is computed from the parsed code.
        </p>
      </section>

      {!demo.ok && demo.unreachable ? (
        <ServerWaking />
      ) : demos.length > 0 ? (
        <section id="demos" className="flex scroll-mt-24 flex-col gap-8">
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
                    Open the onboarding guide
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

interface FeatureTag {
  label: string;
  ai?: boolean;
}

const NO_AI: FeatureTag = { label: 'No AI' };
const CODE_FACTS: FeatureTag = { label: 'Facts from the code' };
const AI_SUMMARY: FeatureTag = { label: 'AI-written summary', ai: true };
const AI_WRITTEN: FeatureTag = { label: 'AI-written', ai: true };

function Feature({
  href,
  title,
  body,
  tags,
  icon,
  wide = false,
  children,
}: {
  href: string;
  title: string;
  body: string;
  tags: FeatureTag[];
  icon: ReactNode;
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`card card-hover group flex gap-4 p-5 ${wide ? 'sm:col-span-2' : ''}`}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 transition-colors duration-200 group-hover:bg-brand-50 group-hover:text-brand-700 dark:bg-zinc-800 dark:text-zinc-300 dark:group-hover:bg-brand-950 dark:group-hover:text-brand-300">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold">{title}</span>
          {tags.map((tag) => (
            <Tag key={tag.label} {...tag} />
          ))}
        </span>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{body}</span>
        {children}
      </div>
    </Link>
  );
}

/** Says where a feature's content comes from; AI-written parts match the guide's label. */
function Tag({ label, ai = false }: FeatureTag) {
  return ai ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800 ring-1 ring-violet-200 ring-inset dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900">
      <svg viewBox="0 0 16 16" aria-hidden className="size-3 fill-current">
        <path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" />
      </svg>
      {label}
    </span>
  ) : (
    <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-zinc-600 ring-1 ring-zinc-200 ring-inset dark:text-zinc-400 dark:ring-zinc-700">
      {label}
    </span>
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

function IconSearch() {
  return (
    <svg {...iconProps} className="size-5">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}
