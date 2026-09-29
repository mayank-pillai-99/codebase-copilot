import { describe, expect, it } from 'vitest';
import {
  detectDataModels,
  detectEnvVars,
  detectIntegrations,
  lookupIntegration,
} from '../src/analysis/integrations';

describe('detectIntegrations', () => {
  it('groups known packages into services with their import sites', () => {
    const found = detectIntegrations(
      [
        { file: 'lib/stripe.ts', line: 1, packageName: 'stripe' },
        { file: 'app/billing.tsx', line: 3, packageName: '@stripe/stripe-js' },
        { file: 'lib/db.ts', line: 1, packageName: '@prisma/client' },
        { file: 'lib/utils.ts', line: 1, packageName: 'clsx' },
      ],
      [],
    );
    expect(found.map((i) => [i.name, i.kind, i.packages, i.imports.length])).toEqual([
      ['Stripe', 'payments', ['stripe', '@stripe/stripe-js'], 2],
      ['Prisma', 'database', ['@prisma/client'], 1],
    ]);
  });

  it('includes known dependencies declared only in package.json', () => {
    const packageJson = JSON.stringify({
      dependencies: { contentlayer: '1', react: '18' },
      devDependencies: { prisma: '5' },
    });
    const found = detectIntegrations([], [{ path: 'package.json', content: packageJson }]);
    expect(found.map((i) => [i.name, i.imports.length, i.declaredIn])).toEqual([
      ['Contentlayer', 0, ['package.json']],
      ['Prisma', 0, ['package.json']],
    ]);
  });

  it('ignores unknown packages and unreadable package.json', () => {
    expect(detectIntegrations([], [{ path: 'package.json', content: '{oops' }])).toEqual([]);
    expect(lookupIntegration('lodash')).toBeNull();
  });
});

describe('detectEnvVars', () => {
  it('finds process.env and import.meta.env reads with their lines', () => {
    const content = [
      'const secret = process.env.JWT_SECRET || "x";',
      "const port = process.env['PORT'];",
      'const url = import.meta.env.VITE_API_URL;',
      'const again = process.env.JWT_SECRET;',
      'const lower = process.env.notAnEnvVar;',
    ].join('\n');
    const vars = detectEnvVars([{ path: 'src/config.ts', content }]);
    expect(vars.map((v) => [v.name, v.count, v.usages.map((u) => u.line)])).toEqual([
      ['JWT_SECRET', 2, [1, 4]],
      ['PORT', 1, [2]],
      ['VITE_API_URL', 1, [3]],
    ]);
  });
});

describe('detectDataModels', () => {
  it('reads Prisma schemas and common ORM declarations', () => {
    const models = detectDataModels([
      {
        path: 'prisma/schema.prisma',
        language: 'prisma',
        content: 'generator client {}\n\nmodel User {\n  id Int @id\n}\n\nmodel Post {\n}\n',
      },
      {
        path: 'src/models/cat.js',
        language: 'javascript',
        content: "const Cat = mongoose.model('Cat', schema);",
      },
      {
        path: 'src/entity/photo.ts',
        language: 'typescript',
        content: '@Entity()\nexport class Photo {}',
      },
      {
        path: 'src/db/schema.ts',
        language: 'typescript',
        content: "export const users = pgTable('users', {});",
      },
    ]);
    expect(models.map((m) => [m.name, m.source, m.line])).toEqual([
      ['User', 'prisma', 3],
      ['Post', 'prisma', 7],
      ['Cat', 'mongoose', 1],
      ['Photo', 'typeorm', 1],
      ['users', 'drizzle', 1],
    ]);
  });

  it('only reads sequelize.define in files that use Sequelize', () => {
    const define = "const User = db.define('User', {});";
    expect(detectDataModels([{ path: 'a.js', language: 'javascript', content: define }])).toEqual(
      [],
    );
    expect(
      detectDataModels([
        {
          path: 'b.js',
          language: 'javascript',
          content: `const { Sequelize } = require('sequelize');\n${define}`,
        },
      ]).map((m) => m.name),
    ).toEqual(['User']);
  });
});
