import type { CSSProperties } from 'react';

const NODES = [
  { id: 'routes', label: 'routes/auth.ts', x: 24, y: 24, delay: 150 },
  { id: 'service', label: 'auth.service.ts', x: 172, y: 110, delay: 300 },
  { id: 'token', label: 'token.utils.ts', x: 326, y: 24, delay: 450 },
  { id: 'jwt', label: 'jsonwebtoken', x: 326, y: 110, delay: 600, external: true },
  { id: 'db', label: 'prisma-client.ts', x: 24, y: 196, delay: 750 },
] as const;

const W = 132;
const H = 38;

// Imports: routes → service → token → jsonwebtoken, and service → the database client.
const EDGES = [
  { id: 'e1', d: 'M 90 62 C 90 100, 120 129, 170 129' },
  { id: 'e2', d: 'M 238 108 C 238 60, 280 43, 324 43' },
  { id: 'e3', d: 'M 392 62 C 392 80, 392 90, 392 108' },
  { id: 'e4', d: 'M 200 148 C 180 180, 150 215, 158 215' },
];

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/**
 * The landing page's illustration: a small code graph drawing itself, then a question
 * answered with citations. Decorative, so hidden from assistive tech; all motion stops
 * under prefers-reduced-motion.
 */
export function HeroVisual() {
  return (
    <div aria-hidden className="relative">
      <div className="card dot-grid relative overflow-hidden p-3 shadow-xl shadow-zinc-900/5 dark:shadow-black/30">
        <div className="mb-2 flex items-center gap-1.5 px-1">
          <span className="size-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          <span className="size-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          <span className="size-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          <span className="ml-2 font-mono text-[11px] text-zinc-500">
            architecture · realworld-api
          </span>
        </div>
        <svg viewBox="0 0 484 250" className="w-full">
          <defs>
            <marker
              id="hero-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L8 4 L0 8 z" className="fill-zinc-400 dark:fill-zinc-500" />
            </marker>
          </defs>
          {EDGES.map((edge, i) => (
            <path
              key={edge.id}
              id={`hero-${edge.id}`}
              d={edge.d}
              pathLength={1}
              fill="none"
              strokeWidth={1.4}
              strokeDasharray="1"
              markerEnd="url(#hero-arrow)"
              className="animate-draw stroke-zinc-400 dark:stroke-zinc-500"
              style={delay(700 + i * 180)}
            />
          ))}
          {/* Signals travelling along the edges (SMIL; hidden when motion is reduced). */}
          <g className="motion-reduce:hidden">
            {EDGES.map((edge, i) => (
              <circle key={edge.id} r={3} className="fill-brand-500" opacity={0}>
                <animate
                  attributeName="opacity"
                  values="0;1;1;0"
                  dur="2.6s"
                  begin={`${1.6 + i * 0.5}s`}
                  repeatCount="indefinite"
                />
                <animateMotion dur="2.6s" begin={`${1.6 + i * 0.5}s`} repeatCount="indefinite">
                  <mpath href={`#hero-${edge.id}`} />
                </animateMotion>
              </circle>
            ))}
          </g>
          {NODES.map((node) => (
            <g
              key={node.id}
              className="animate-pop"
              style={{
                ...delay(node.delay),
                transformOrigin: `${node.x + W / 2}px ${node.y + H / 2}px`,
              }}
            >
              <rect
                x={node.x}
                y={node.y}
                width={W}
                height={H}
                rx={8}
                strokeWidth={1}
                className={
                  'external' in node
                    ? 'fill-violet-50 stroke-violet-300 dark:fill-violet-950 dark:stroke-violet-800'
                    : node.id === 'service'
                      ? 'fill-brand-50 stroke-brand-400 dark:fill-brand-950 dark:stroke-brand-700'
                      : 'fill-white stroke-zinc-300 dark:fill-zinc-900 dark:stroke-zinc-700'
                }
              />
              <text
                x={node.x + 12}
                y={node.y + H / 2 + 4}
                className="fill-zinc-800 font-mono text-[11px] dark:fill-zinc-200"
              >
                {node.label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* The answer, citing the files above. */}
      <div
        className="card animate-fade-up relative mt-3 flex flex-col gap-2 p-3 text-xs shadow-xl shadow-zinc-900/10 sm:absolute sm:right-3 sm:-bottom-12 sm:mt-0 sm:w-72 dark:shadow-black/40"
        style={delay(1500)}
      >
        <p className="self-end rounded-xl bg-zinc-900 px-3 py-1.5 text-white dark:bg-zinc-100 dark:text-zinc-900">
          How does login work?
        </p>
        <p
          className="animate-fade-in leading-relaxed text-zinc-700 dark:text-zinc-300"
          style={delay(2100)}
        >
          It checks the password with bcrypt <Cite n={1} /> and signs a 60-day JWT <Cite n={2} />
          <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-caret bg-brand-500" />
        </p>
        <div className="flex flex-wrap gap-1.5 animate-fade-in" style={delay(2500)}>
          <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            [1] auth.service.ts:84
          </span>
          <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            [2] token.utils.ts:3
          </span>
        </div>
      </div>
    </div>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <span className="rounded bg-brand-100 px-1 font-mono text-[10px] font-semibold text-brand-800 dark:bg-brand-900 dark:text-brand-200">
      {n}
    </span>
  );
}
