import { describe, expect, it } from 'vitest';
import { declaredEntries, pickKeyRoutes, rankStartFiles } from '../src/analysis/guide';
import { detectStack } from '../src/analysis/stack';

describe('detectStack', () => {
  it('reads known dependencies and tooling files, grouped by category', () => {
    const stack = detectStack(
      [
        {
          path: 'package.json',
          content: JSON.stringify({
            dependencies: { express: '4', '@prisma/client': '5', lodash: '4' },
            devDependencies: { typescript: '5', jest: '29', eslint: '8' },
          }),
        },
      ],
      ['src/main.ts', 'Dockerfile', '.github/workflows/ci.yml', 'tsconfig.json'],
    );
    expect(stack.map((s) => [s.name, s.category, s.evidence])).toEqual([
      ['TypeScript', 'language', 'package.json'],
      ['Express', 'framework', 'package.json'],
      ['Prisma', 'data', 'package.json'],
      ['Jest', 'testing', 'package.json'],
      ['ESLint', 'quality', 'package.json'],
      ['Docker', 'deployment', 'Dockerfile'],
      ['GitHub Actions', 'deployment', '.github/workflows/ci.yml'],
    ]);
  });

  it('prefers the root package.json as evidence and falls back to JavaScript', () => {
    const stack = detectStack(
      [
        {
          path: 'packages/web/package.json',
          content: JSON.stringify({ dependencies: { react: '18' } }),
        },
        { path: 'package.json', content: JSON.stringify({ dependencies: { react: '18' } }) },
        { path: 'broken/package.json', content: '{' },
      ],
      ['lib/index.js'],
    );
    expect(stack).toEqual([
      { name: 'JavaScript', category: 'language', evidence: 'lib/index.js' },
      { name: 'React', category: 'ui', evidence: 'package.json' },
    ]);
  });
});

describe('rankStartFiles', () => {
  it('ranks entry points, widely imported files and route files, skipping tests', () => {
    const files = rankStartFiles({
      paths: [
        'src/main.ts',
        'src/db.ts',
        'src/routes/users.ts',
        'src/services/users.ts',
        'src/util.ts',
        'src/db.test.ts',
      ],
      internalImports: [
        { from: 'src/routes/users.ts', to: 'src/db.ts' },
        { from: 'src/services/users.ts', to: 'src/db.ts' },
        { from: 'src/db.test.ts', to: 'src/db.ts' },
        { from: 'src/main.ts', to: 'src/routes/users.ts' },
      ],
      routeFiles: ['src/routes/users.ts', 'src/routes/users.ts'],
      declaredEntries: [],
    });
    expect(files.map((f) => [f.path, f.reasons])).toEqual([
      ['src/main.ts', ['entry point']],
      ['src/routes/users.ts', ['defines 2 routes']],
      ['src/db.ts', ['imported by 2 files']],
    ]);
  });

  it('puts entries declared in package.json first', () => {
    const files = rankStartFiles({
      paths: ['lib/express.js', 'index.js'],
      internalImports: [],
      routeFiles: [],
      declaredEntries: ['./lib/express.js'],
    });
    expect(files[0]).toMatchObject({
      path: 'lib/express.js',
      reasons: ['entry point declared in package.json'],
    });
  });
});

describe('declaredEntries', () => {
  it('resolves main, module and bin against the package directory', () => {
    expect(
      declaredEntries(
        'packages/cli/package.json',
        JSON.stringify({ main: './dist/index.js', bin: { tool: 'bin/tool.js' } }),
      ),
    ).toEqual(['packages/cli/dist/index.js', 'packages/cli/bin/tool.js']);
    expect(declaredEntries('package.json', JSON.stringify({ bin: 'cli.js' }))).toEqual(['cli.js']);
    expect(declaredEntries('package.json', 'nope')).toEqual([]);
  });
});

describe('pickKeyRoutes', () => {
  const route = (
    id: string,
    method: string,
    path: string,
    resolvedCalls = 0,
    file = 'src/routes.ts',
  ) => ({
    id,
    method,
    path,
    file,
    resolvedCalls,
  });

  it('picks one busy route per resource, busiest resources first', () => {
    const picked = pickKeyRoutes([
      route('a', 'GET', '/articles'),
      route('b', 'POST', '/articles', 3),
      route('c', 'DELETE', '/articles/:slug', 1),
      route('d', 'POST', '/users/login', 2),
      route('e', 'GET', '/users'),
      route('f', 'GET', '/tags'),
      route('g', 'POST', '/fixtures', 9, 'test/app.test.ts'),
    ]);
    expect(picked.map((r) => r.id)).toEqual(['b', 'd', 'f']);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 8 }, (_, i) => route(`r${i}`, 'GET', `/r${i}`));
    expect(pickKeyRoutes(many, 3)).toHaveLength(3);
  });
});
