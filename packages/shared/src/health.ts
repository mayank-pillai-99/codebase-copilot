import { z } from 'zod';

export const dependencyStatusSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().nonnegative(),
  detail: z.string().optional(),
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  dependencies: z.object({
    database: dependencyStatusSchema,
    pgvector: dependencyStatusSchema,
    redis: dependencyStatusSchema,
  }),
});

export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
