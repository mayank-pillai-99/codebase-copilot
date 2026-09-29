import { describe, expect, it } from 'vitest';
import { createModuleResolver, packageNameOf, parseJsonc } from '../src/indexing/modules';

const code = [
  'src/server.ts',
  'src/routes/index.ts',
  'src/routes/users.ts',
  'src/lib/db.ts',
  'src/components/Button.tsx',
  'src/legacy/util.js',
  'src/types.d.ts',
  'packages/shared/src/index.ts',
  'packages/shared/src/schemas/user.ts',
  'packages/ui/lib/main.js',
  'apps/web/src/app/page.tsx',
  'apps/web/src/lib/api.ts',
];

const configs = [
  {
    path: 'tsconfig.base.json',
    content: `{
      // Shared options
      "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/lib/*"], "~types": ["src/types.d.ts"], }, },
    }`,
  },
  { path: 'tsconfig.json', content: '{ "extends": "./tsconfig.base.json" }' },
  {
    path: 'apps/web/tsconfig.json',
    // Its own baseUrl: an inherited one would make paths relative to the repo root (as in tsc).
    content:
      '{ "extends": "../../tsconfig.base", "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }',
  },
  { path: 'package.json', content: '{ "name": "root" }' },
  {
    path: 'packages/shared/package.json',
    content:
      '{ "name": "@acme/shared", "exports": { ".": { "types": "./src/index.ts", "default": "./dist/index.js" } } }',
  },
  {
    path: 'packages/shared/tsconfig.json',
    content: '{ "compilerOptions": { "paths": { "#/*": ["./src/*"] } } }',
  },
  { path: 'packages/ui/package.json', content: '{ "name": "@acme/ui", "main": "lib/main.js" }' },
];

const resolver = createModuleResolver(code, configs);
const to = (from: string, specifier: string) => resolver.resolve(from, specifier);

describe('module resolution', () => {
  it('resolves relative imports with extension and index probing', () => {
    expect(to('src/server.ts', './routes').toPath).toBe('src/routes/index.ts');
    expect(to('src/server.ts', './routes/users').toPath).toBe('src/routes/users.ts');
    expect(to('src/routes/users.ts', '../lib/db').toPath).toBe('src/lib/db.ts');
    expect(to('src/server.ts', './components/Button').toPath).toBe('src/components/Button.tsx');
    expect(to('src/server.ts', './legacy/util.js').toPath).toBe('src/legacy/util.js');
  });

  it('maps ESM-style .js specifiers to TypeScript sources', () => {
    expect(to('src/server.ts', './lib/db.js').toPath).toBe('src/lib/db.ts');
  });

  it('leaves missing relative files unresolved but internal', () => {
    expect(to('src/server.ts', './nope')).toEqual({
      toPath: null,
      external: false,
      packageName: null,
    });
    expect(to('src/server.ts', '../../../outside')).toMatchObject({
      toPath: null,
      external: false,
    });
  });

  it('applies tsconfig paths and baseUrl through relative extends', () => {
    expect(to('src/server.ts', '@lib/db').toPath).toBe('src/lib/db.ts');
    expect(to('src/server.ts', '~types').toPath).toBe('src/types.d.ts');
    expect(to('src/server.ts', 'src/routes/users').toPath).toBe('src/routes/users.ts');
  });

  it('uses the nearest tsconfig, relative to its own directory', () => {
    expect(to('apps/web/src/app/page.tsx', '@/lib/api').toPath).toBe('apps/web/src/lib/api.ts');
  });

  it('resolves paths without a baseUrl relative to the tsconfig file', () => {
    expect(to('packages/shared/src/index.ts', '#/schemas/user').toPath).toBe(
      'packages/shared/src/schemas/user.ts',
    );
  });

  it('resolves workspace packages by name and subpath', () => {
    expect(to('apps/web/src/lib/api.ts', '@acme/shared').toPath).toBe(
      'packages/shared/src/index.ts',
    );
    expect(to('apps/web/src/lib/api.ts', '@acme/shared/schemas/user').toPath).toBe(
      'packages/shared/src/schemas/user.ts',
    );
    expect(to('apps/web/src/lib/api.ts', '@acme/ui').toPath).toBe('packages/ui/lib/main.js');
  });

  it('marks everything else as an external package', () => {
    expect(to('src/server.ts', 'express')).toEqual({
      toPath: null,
      external: true,
      packageName: 'express',
    });
    expect(to('src/server.ts', '@prisma/client/runtime')).toMatchObject({
      packageName: '@prisma/client',
    });
    expect(to('src/server.ts', 'node:fs/promises')).toMatchObject({
      packageName: 'node:fs/promises',
    });
  });
});

describe('helpers', () => {
  it('parses JSON with comments and trailing commas without touching strings', () => {
    expect(
      parseJsonc('{ "$schema": "https://json.schemastore.org/tsconfig", /* c */ "a": [1, 2,], }'),
    ).toEqual({ $schema: 'https://json.schemastore.org/tsconfig', a: [1, 2] });
    expect(parseJsonc('not json')).toBeNull();
  });

  it('derives package names', () => {
    expect(packageNameOf('lodash/fp')).toBe('lodash');
    expect(packageNameOf('@scope/pkg/deep/path')).toBe('@scope/pkg');
  });
});
