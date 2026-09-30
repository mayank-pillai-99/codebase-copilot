/**
 * Tech stack detection for the onboarding guide (SPEC §9.3): known dependencies in
 * package.json files, plus tooling recognized by file name. Deterministic; every
 * entry names the file that shows it.
 */

export type StackCategory =
  'language' | 'framework' | 'ui' | 'data' | 'api' | 'testing' | 'build' | 'quality' | 'deployment';

export interface StackItem {
  name: string;
  category: StackCategory;
  /** The file that shows it (a package.json, config file or directory). */
  evidence: string;
}

const PACKAGES: Record<string, { name: string; category: StackCategory }> = {};
function add(category: StackCategory, name: string, packages: string[]) {
  for (const p of packages) PACKAGES[p] = { name, category };
}
add('framework', 'Next.js', ['next']);
add('framework', 'Express', ['express']);
add('framework', 'Fastify', ['fastify']);
add('framework', 'Koa', ['koa']);
add('framework', 'Hono', ['hono']);
add('framework', 'NestJS', ['@nestjs/core']);
add('framework', 'Remix', ['@remix-run/node', '@remix-run/react']);
add('framework', 'Nuxt', ['nuxt']);
add('framework', 'SvelteKit', ['@sveltejs/kit']);
add('framework', 'Astro', ['astro']);
add('framework', 'Electron', ['electron']);
add('ui', 'React', ['react']);
add('ui', 'Vue', ['vue']);
add('ui', 'Svelte', ['svelte']);
add('ui', 'Angular', ['@angular/core']);
add('ui', 'Tailwind CSS', ['tailwindcss']);
add('ui', 'styled-components', ['styled-components']);
add('ui', 'Radix UI', [
  '@radix-ui/react-slot',
  '@radix-ui/react-dialog',
  '@radix-ui/react-dropdown-menu',
]);
add('data', 'Prisma', ['prisma', '@prisma/client']);
add('data', 'Drizzle ORM', ['drizzle-orm']);
add('data', 'TypeORM', ['typeorm']);
add('data', 'Sequelize', ['sequelize']);
add('data', 'Mongoose', ['mongoose']);
add('data', 'Knex', ['knex']);
add('data', 'Redis', ['redis', 'ioredis', '@upstash/redis']);
add('data', 'TanStack Query', ['@tanstack/react-query']);
add('api', 'tRPC', ['@trpc/server']);
add('api', 'GraphQL', ['graphql']);
add('api', 'Apollo', ['@apollo/server', '@apollo/client', 'apollo-server']);
add('api', 'zod', ['zod']);
add('api', 'Axios', ['axios']);
add('testing', 'Jest', ['jest']);
add('testing', 'Vitest', ['vitest']);
add('testing', 'Mocha', ['mocha']);
add('testing', 'Playwright', ['@playwright/test', 'playwright']);
add('testing', 'Cypress', ['cypress']);
add('testing', 'Supertest', ['supertest']);
add('build', 'Vite', ['vite']);
add('build', 'webpack', ['webpack']);
add('build', 'Rollup', ['rollup']);
add('build', 'esbuild', ['esbuild']);
add('build', 'tsup', ['tsup']);
add('build', 'Turborepo', ['turbo']);
add('build', 'Nx', ['nx']);
add('build', 'Babel', ['@babel/core']);
add('quality', 'ESLint', ['eslint']);
add('quality', 'Prettier', ['prettier']);
add('quality', 'Biome', ['@biomejs/biome']);
add('quality', 'Husky', ['husky']);

const FILES: { test: (path: string) => boolean; name: string; category: StackCategory }[] = [
  {
    test: (p) => /(^|\/)tsconfig(\.[\w-]+)?\.json$/.test(p),
    name: 'TypeScript',
    category: 'language',
  },
  { test: (p) => /(^|\/)Dockerfile(\.[\w-]+)?$/.test(p), name: 'Docker', category: 'deployment' },
  {
    test: (p) => /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(p),
    name: 'Docker Compose',
    category: 'deployment',
  },
  {
    test: (p) => p.startsWith('.github/workflows/'),
    name: 'GitHub Actions',
    category: 'deployment',
  },
  { test: (p) => /(^|\/)vercel\.json$/.test(p), name: 'Vercel', category: 'deployment' },
  { test: (p) => /(^|\/)netlify\.toml$/.test(p), name: 'Netlify', category: 'deployment' },
  { test: (p) => /(^|\/)render\.ya?ml$/.test(p), name: 'Render', category: 'deployment' },
  { test: (p) => /(^|\/)fly\.toml$/.test(p), name: 'Fly.io', category: 'deployment' },
];

const CATEGORY_ORDER: StackCategory[] = [
  'language',
  'framework',
  'ui',
  'data',
  'api',
  'testing',
  'build',
  'quality',
  'deployment',
];

export function detectStack(
  packageJsons: readonly { path: string; content: string }[],
  paths: readonly string[],
): StackItem[] {
  const found = new Map<string, StackItem>();
  const note = (item: StackItem) => {
    if (!found.has(item.name)) found.set(item.name, item);
  };

  // Root package.json first, so evidence points at the most visible file.
  const ordered = [...packageJsons].sort((a, b) => depth(a.path) - depth(b.path));
  for (const { path, content } of ordered) {
    for (const dependency of dependencies(content)) {
      const known = PACKAGES[dependency];
      if (known) note({ ...known, evidence: path });
      if (dependency === 'typescript')
        note({ name: 'TypeScript', category: 'language', evidence: path });
    }
  }
  for (const path of [...paths].sort((a, b) => depth(a) - depth(b))) {
    for (const file of FILES) {
      if (file.test(path)) note({ name: file.name, category: file.category, evidence: path });
    }
  }
  if (!found.has('TypeScript') && paths.some((p) => /\.[cm]?js$/.test(p))) {
    note({
      name: 'JavaScript',
      category: 'language',
      evidence: paths.find((p) => /\.[cm]?js$/.test(p))!,
    });
  }

  return [...found.values()].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.name.localeCompare(b.name),
  );
}

function dependencies(content: string): string[] {
  try {
    const json = JSON.parse(content) as Record<string, unknown>;
    return ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((field) => {
      const deps = json[field];
      return deps && typeof deps === 'object' ? Object.keys(deps) : [];
    });
  } catch {
    return [];
  }
}

function depth(path: string): number {
  return path.split('/').length;
}
