import { z } from 'zod';

/** One piece of code on a request's path: the route handler or a function it reaches. */
export const traceNodeSchema = z.object({
  /** Symbol id, or "handler" for an inline route handler. */
  id: z.string(),
  /** The node that first reached this one (breadth-first); null for the handler. */
  parentId: z.string().nullable(),
  depth: z.number().int(),
  label: z.string(),
  kind: z.string(),
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  /** Calls made inside this code, in source order. */
  calls: z.array(
    z.object({
      callee: z.string(),
      line: z.number().int(),
      /**
       * Resolved by name through imports (approximate, see SPEC §5.3). Unresolved calls,
       * such as methods on local variables or library calls, are shown but not followed.
       */
      resolved: z.boolean(),
      /** Node id of the resolved target, when it was followed. */
      target: z.string().nullable(),
    }),
  ),
});

/** GET /api/snapshots/:id/routes/:routeId/trace */
export const traceResponseSchema = z.object({
  route: z.object({
    id: z.uuid(),
    method: z.string(),
    path: z.string(),
    file: z.string(),
    startLine: z.number().int(),
  }),
  nodes: z.array(traceNodeSchema),
  maxDepth: z.number().int(),
  /** True when the node limit cut the trace short. */
  truncated: z.boolean(),
});

export type TraceNode = z.infer<typeof traceNodeSchema>;
export type TraceResponse = z.infer<typeof traceResponseSchema>;
