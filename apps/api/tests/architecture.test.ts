import { architectureSchema } from '@codebase-copilot/shared';
import { describe, expect, it } from 'vitest';
import { buildArchitecture } from '../src/analysis/architecture';
import { detectIntegrations } from '../src/analysis/integrations';

describe('buildArchitecture', () => {
  const codeFiles = [
    'src/routes/users.ts',
    'src/routes/posts.ts',
    'src/services/users.ts',
    'src/services/posts.ts',
    'src/db/client.ts',
    'src/routes/users.test.ts',
  ];

  const architecture = buildArchitecture({
    codeFiles,
    symbolsPerFile: new Map([
      ['src/routes/users.ts', 2],
      ['src/services/users.ts', 3],
    ]),
    routeFiles: ['src/routes/users.ts', 'src/routes/users.ts', 'src/routes/posts.ts'],
    internalImports: [
      {
        from: 'src/routes/users.ts',
        to: 'src/services/users.ts',
        specifier: '../services/users',
        line: 1,
      },
      {
        from: 'src/routes/posts.ts',
        to: 'src/services/posts.ts',
        specifier: '../services/posts',
        line: 2,
      },
      { from: 'src/services/users.ts', to: 'src/db/client.ts', specifier: '../db/client', line: 1 },
      { from: 'src/services/users.ts', to: 'src/services/posts.ts', specifier: './posts', line: 4 },
      {
        from: 'src/routes/users.test.ts',
        to: 'src/routes/users.ts',
        specifier: './users',
        line: 1,
      },
    ],
    integrations: detectIntegrations(
      [
        { file: 'src/db/client.ts', line: 1, packageName: '@prisma/client' },
        { file: 'src/routes/users.test.ts', line: 2, packageName: '@prisma/client' },
      ],
      [],
    ),
    dataModels: [{ name: 'User', source: 'prisma', file: 'prisma/schema.prisma', line: 3 }],
    envVars: [{ name: 'DATABASE_URL', count: 1, usages: [{ file: 'src/db/client.ts', line: 3 }] }],
  });

  it('matches the shared response schema', () => {
    expect(architectureSchema.parse(architecture)).toEqual(architecture);
  });

  it('groups files into components with symbol and route counts', () => {
    expect(
      architecture.components.map((c) => [
        c.id,
        c.role,
        c.files.length,
        c.symbolCount,
        c.routeCount,
      ]),
    ).toEqual([
      ['src/db', 'source', 1, 0, 0],
      ['src/routes', 'source', 2, 2, 3],
      ['src/services', 'source', 2, 3, 0],
      ['(tests)', 'test', 1, 0, 0],
    ]);
  });

  it('aggregates imports between components, ignoring imports inside one', () => {
    expect(architecture.dependencies.map((d) => [d.from, d.to, d.count])).toEqual([
      ['src/routes', 'src/services', 2],
      ['src/services', 'src/db', 1],
      ['(tests)', 'src/routes', 1],
    ]);
    expect(architecture.dependencies[0]!.examples[0]).toEqual({
      file: 'src/routes/users.ts',
      line: 1,
      specifier: '../services/users',
    });
  });

  it('records which components use each integration', () => {
    expect(architecture.integrations).toHaveLength(1);
    expect(architecture.integrations[0]!.usedBy.map((u) => [u.component, u.count])).toEqual([
      ['src/db', 1],
      ['(tests)', 1],
    ]);
  });
});
