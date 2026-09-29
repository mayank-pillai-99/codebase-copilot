import { z } from 'zod';

const evidenceSchema = z.object({ file: z.string(), line: z.number().int() });

/**
 * GET /api/snapshots/:id/architecture. Deterministic: derived from the parsed code
 * graph, with example import statements as evidence for every edge.
 */
export const architectureSchema = z.object({
  components: z.array(
    z.object({
      /** Directory path, "." for top-level files, or "(tests)" etc. for grouped roles. */
      id: z.string(),
      role: z.enum(['source', 'test', 'example', 'tooling']),
      files: z.array(z.string()),
      symbolCount: z.number().int(),
      routeCount: z.number().int(),
    }),
  ),
  /** Imports from one component to another, most-used first. */
  dependencies: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      count: z.number().int(),
      examples: z.array(evidenceSchema.extend({ specifier: z.string() })),
    }),
  ),
  integrations: z.array(
    z.object({
      name: z.string(),
      kind: z.enum([
        'database',
        'cache',
        'queue',
        'payments',
        'email',
        'auth',
        'ai',
        'storage',
        'search',
        'monitoring',
        'messaging',
        'cms',
      ]),
      packages: z.array(z.string()),
      /** package.json files that declare one of the packages. */
      declaredIn: z.array(z.string()),
      usedBy: z.array(
        z.object({
          component: z.string(),
          count: z.number().int(),
          examples: z.array(evidenceSchema.extend({ packageName: z.string() })),
        }),
      ),
    }),
  ),
  dataModels: z.array(
    evidenceSchema.extend({
      name: z.string(),
      source: z.enum(['prisma', 'mongoose', 'typeorm', 'drizzle', 'sequelize']),
    }),
  ),
  envVars: z.array(
    z.object({ name: z.string(), count: z.number().int(), usages: z.array(evidenceSchema) }),
  ),
});

export const architectureResponseSchema = z.object({ architecture: architectureSchema });

export type Architecture = z.infer<typeof architectureSchema>;
export type ArchitectureComponent = Architecture['components'][number];
export type ArchitectureDependency = Architecture['dependencies'][number];
export type ArchitectureIntegration = Architecture['integrations'][number];
