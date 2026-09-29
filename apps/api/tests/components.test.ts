import { describe, expect, it } from 'vitest';
import { classifyRole, groupComponents } from '../src/analysis/components';

const ids = (paths: string[], options = {}) =>
  groupComponents(paths, options).map((c) => [c.id, c.files.length]);

describe('classifyRole', () => {
  it.each([
    ['src/auth/login.ts', 'source'],
    ['src/auth/login.test.ts', 'test'],
    ['test/app.router.js', 'test'],
    ['src/__tests__/x.tsx', 'test'],
    ['examples/auth/index.js', 'example'],
    ['scripts/release.mjs', 'tooling'],
    ['vite.config.ts', 'tooling'],
    ['tailwind.config.js', 'tooling'],
    ['gulpfile.js', 'tooling'],
    ['.eslintrc.cjs', 'tooling'],
    ['lib/config.js', 'source'],
    ['next.config.mjs', 'tooling'],
  ])('%s is %s', (path, role) => {
    expect(classifyRole(path)).toBe(role);
  });
});

describe('groupComponents', () => {
  it('skips a wrapper directory and splits large directories', () => {
    // The RealWorld layout: everything under src/, most of it under src/app/routes.
    const paths = [
      'src/main.ts',
      'src/app/models/http-exception.model.ts',
      'src/app/routes/routes.ts',
      ...['a', 'b', 'c', 'd'].map((f) => `src/app/routes/article/${f}.ts`),
      ...['a', 'b', 'c', 'd', 'e'].map((f) => `src/app/routes/auth/${f}.ts`),
      ...['a', 'b', 'c'].map((f) => `src/app/routes/profile/${f}.ts`),
      'src/app/routes/tag/tag.service.ts',
      'src/prisma/prisma-client.ts',
      'src/prisma/seed.ts',
      'src/tests/services/auth.service.test.ts',
    ];
    expect(ids(paths, { splitMinFiles: 4 })).toEqual([
      ['src', 1],
      ['src/app/models', 1],
      ['src/app/routes', 1],
      ['src/app/routes/article', 4],
      ['src/app/routes/auth', 5],
      ['src/app/routes/profile', 3],
      ['src/app/routes/tag', 1],
      ['src/prisma', 2],
      ['(tests)', 1],
    ]);
  });

  it('keeps top-level files together and groups tests, examples and tooling', () => {
    expect(
      ids([
        'index.js',
        'lib/application.js',
        'lib/request.js',
        'test/app.js',
        'examples/auth/index.js',
        'examples/mvc/index.js',
        'rollup.config.js',
      ]),
    ).toEqual([
      ['.', 1],
      ['lib', 2],
      ['(tests)', 1],
      ['(examples)', 2],
      ['(toolings)', 1],
    ]);
  });

  it('stops splitting before exceeding the component limit', () => {
    const paths = Array.from({ length: 20 }, (_, i) => `app/feature${i}/index.ts`);
    expect(ids(paths, { maxComponents: 5 })).toEqual([['app', 20]]);
    expect(ids(paths, { maxComponents: 30 })).toHaveLength(20);
  });

  it('handles a single file and no files', () => {
    expect(ids(['index.ts'])).toEqual([['.', 1]]);
    expect(ids([])).toEqual([]);
  });
});
