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

export const fileEntrySchema = z.object({
  path: z.string(),
  kind: z.enum(['CODE', 'DOC', 'CONFIG']),
  language: z.string(),
  lineCount: z.number().int(),
  sizeBytes: z.number().int(),
});

export const fileListResponseSchema = z.object({ files: z.array(fileEntrySchema) });

export const fileSymbolSchema = z.object({
  kind: z.string(),
  name: z.string(),
  qualifiedName: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  exported: z.boolean(),
});

export const fileResponseSchema = z.object({
  file: fileEntrySchema.extend({ content: z.string(), hasErrors: z.boolean() }),
  symbols: z.array(fileSymbolSchema),
});

const codeLocationSchema = z.object({
  label: z.string(),
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
});

/**
 * GET /api/snapshots/:id/references?path=&line=: the call graph around the innermost
 * function, method or class at a line. Calls are resolved by name (SPEC §5.3), so
 * unresolved ones are listed without a target.
 */
export const referencesResponseSchema = z.object({
  symbol: z
    .object({
      qualifiedName: z.string(),
      kind: z.string(),
      path: z.string(),
      startLine: z.number().int(),
      endLine: z.number().int(),
    })
    .nullable(),
  /** HTTP routes this symbol handles. */
  routes: z.array(z.object({ id: z.uuid(), method: z.string(), path: z.string() })),
  /** Resolved calls to this symbol, with the calling code. */
  callers: z.array(
    z.object({
      /** The enclosing function, or null for top-level code. */
      from: codeLocationSchema.nullable(),
      /** The inline route handler the call sits in, when there's no named function. */
      route: z.object({ id: z.uuid(), method: z.string(), path: z.string() }).nullable(),
      path: z.string(),
      line: z.number().int(),
    }),
  ),
  /** Calls made inside this symbol, in source order. */
  callees: z.array(
    z.object({
      callee: z.string(),
      line: z.number().int(),
      resolved: z.boolean(),
      target: codeLocationSchema.nullable(),
    }),
  ),
  /** True when a list was cut at its limit. */
  truncated: z.boolean(),
});

export type FileEntry = z.infer<typeof fileEntrySchema>;
export type ReferencesResponse = z.infer<typeof referencesResponseSchema>;
export type FileSymbol = z.infer<typeof fileSymbolSchema>;
export type FileResponse = z.infer<typeof fileResponseSchema>;
