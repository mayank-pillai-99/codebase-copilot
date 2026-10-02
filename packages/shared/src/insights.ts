import { z } from 'zod';

const symbolLocation = z.object({
  label: z.string(),
  kind: z.string(),
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
});

/**
 * GET /api/snapshots/:id/insights: codebase health computed from the parsed graph,
 * with no AI. Rankings cover application code (not tests, examples or tooling).
 */
export const insightsSchema = z.object({
  /** Functions and methods with the most resolved calls from application code. */
  mostCalled: z.array(symbolLocation.extend({ calls: z.number().int() })),
  longestFunctions: z.array(symbolLocation.extend({ lines: z.number().int() })),
  largestFiles: z.array(z.object({ path: z.string(), lines: z.number().int() })),
  /** A file counts as tested when a test file imports it directly. */
  testReach: z.object({
    hasTests: z.boolean(),
    sourceFiles: z.number().int(),
    testedFiles: z.number().int(),
    mostTested: z.array(z.object({ path: z.string(), tests: z.number().int() })),
    /** Untested files that other application files depend on, most depended-on first. */
    untestedHubs: z.array(z.object({ path: z.string(), importedBy: z.number().int() })),
  }),
  /** Import cycles between application files, each as a loop of paths (largest first). */
  cycles: z.array(z.array(z.string())),
});

export const insightsResponseSchema = z.object({ insights: insightsSchema });

export type Insights = z.infer<typeof insightsSchema>;
