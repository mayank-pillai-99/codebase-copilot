import { z } from 'zod';

export const snapshotStatusSchema = z.enum([
  'QUEUED',
  'FETCHING',
  'PARSING',
  'EMBEDDING',
  'READY',
  'FAILED',
]);

export const snapshotProgressSchema = z.object({
  stage: z.enum(['fetching', 'parsing', 'saving', 'embedding', 'retrying']),
  processed: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional(),
});

export const snapshotStatsSchema = z.object({
  files: z.object({ total: z.number(), code: z.number(), docs: z.number(), config: z.number() }),
  filesWithParseErrors: z.number(),
  symbols: z.number(),
  imports: z.object({
    total: z.number(),
    internal: z.number(),
    external: z.number(),
    unresolved: z.number(),
  }),
  calls: z.object({ total: z.number(), resolved: z.number() }),
  routes: z.number(),
  skipped: z.record(z.string(), z.number()),
  durationMs: z.number(),
  // Added with search (Milestone 4); absent on snapshots indexed before it.
  chunks: z.number().optional(),
  embeddings: z
    .object({
      status: z.enum(['complete', 'disabled', 'failed']),
      model: z.string().nullable(),
      embedded: z.number(),
      reason: z.string().optional(),
    })
    .optional(),
});

export const snapshotSchema = z.object({
  id: z.uuid(),
  repository: z.object({ id: z.uuid(), owner: z.string(), name: z.string() }),
  commitSha: z.string(),
  ref: z.string(),
  status: snapshotStatusSchema,
  failureReason: z.string().nullable(),
  progress: snapshotProgressSchema.nullable(),
  stats: snapshotStatsSchema.nullable(),
  createdAt: z.iso.datetime(),
  readyAt: z.iso.datetime().nullable(),
});

export const repositorySummarySchema = z.object({
  id: z.uuid(),
  owner: z.string(),
  name: z.string(),
  defaultBranch: z.string(),
  latestSnapshot: snapshotSchema.nullable(),
});

export const routeSummarySchema = z.object({
  id: z.uuid(),
  method: z.string(),
  path: z.string(),
  framework: z.string(),
  handlerName: z.string().nullable(),
  /** Where the route is registered. */
  file: z.object({ path: z.string(), startLine: z.number(), endLine: z.number() }),
  /** Resolved handler definition, when the graph could pin it down. */
  handler: z
    .object({
      qualifiedName: z.string(),
      path: z.string(),
      startLine: z.number(),
      endLine: z.number(),
    })
    .nullable(),
});

export const addRepositoryResponseSchema = z.object({ snapshot: snapshotSchema });
export const repositoryListResponseSchema = z.object({
  repositories: z.array(repositorySummarySchema),
});
export const snapshotResponseSchema = z.object({ snapshot: snapshotSchema });
export const routeListResponseSchema = z.object({ routes: z.array(routeSummarySchema) });

export type SnapshotStatus = z.infer<typeof snapshotStatusSchema>;
export type SnapshotProgress = z.infer<typeof snapshotProgressSchema>;
export type SnapshotStats = z.infer<typeof snapshotStatsSchema>;
export type SnapshotDto = z.infer<typeof snapshotSchema>;
export type RepositorySummary = z.infer<typeof repositorySummarySchema>;
export type RouteSummary = z.infer<typeof routeSummarySchema>;

/** Statuses after which a snapshot no longer changes on its own. */
export function isSettled(status: SnapshotStatus): boolean {
  return status === 'READY' || status === 'FAILED';
}
