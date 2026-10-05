import { z } from 'zod';

/** One function on a call chain, with the line where it calls the next step. */
export const impactStepSchema = z.object({
  label: z.string(),
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  /** Line in this step that calls the next one; null for the last step. */
  callLine: z.number().int().nullable(),
});

/**
 * GET /api/snapshots/:id/impact?path=&line=: what may be affected by changing the
 * innermost function, method or class at a line, found by walking resolved calls
 * backwards (no AI). Depth 1 means a direct caller.
 */
export const impactResponseSchema = z.object({
  symbol: z
    .object({
      qualifiedName: z.string(),
      kind: z.string(),
      path: z.string(),
      startLine: z.number().int(),
      endLine: z.number().int(),
    })
    .nullable(),
  /** HTTP routes whose handlers reach the symbol, nearest first, with one shortest chain each. */
  routes: z.array(
    z.object({
      id: z.uuid(),
      method: z.string(),
      path: z.string(),
      depth: z.number().int(),
      /** From the route handler to the symbol. */
      chain: z.array(impactStepSchema),
    }),
  ),
  /** Application code that calls the symbol directly or through other calls. */
  dependents: z.array(
    z.object({
      /** A function or method name, or "top-level code". */
      label: z.string(),
      kind: z.string(),
      path: z.string(),
      startLine: z.number().int(),
      endLine: z.number().int(),
      depth: z.number().int(),
    }),
  ),
  /** Test files that call the symbol or one of its dependents. */
  tests: z.array(
    z.object({
      path: z.string(),
      depth: z.number().int(),
      /** The first call into the affected code, e.g. "createArticle" at a line. */
      calls: z.string(),
      line: z.number().int(),
    }),
  ),
  hasTests: z.boolean(),
  /** True when the dependents or routes lists were cut at their limits. */
  truncated: z.boolean(),
});

export type ImpactStep = z.infer<typeof impactStepSchema>;
export type ImpactResponse = z.infer<typeof impactResponseSchema>;
