import { z } from 'zod';

const location = z.object({
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
});

/**
 * GET /api/snapshots/:id/guide: the deterministic onboarding guide (SPEC §9.3).
 * Every item is derived from the parsed code and points at a file.
 */
export const guideSchema = z.object({
  /** The root package.json "description", when there is one. */
  description: z.string().nullable(),
  stack: z.array(
    z.object({
      name: z.string(),
      category: z.enum([
        'language',
        'framework',
        'ui',
        'data',
        'api',
        'testing',
        'build',
        'quality',
        'deployment',
      ]),
      evidence: z.string(),
    }),
  ),
  startHere: z.array(z.object({ path: z.string(), reasons: z.array(z.string()) })),
  keyFlows: z.array(
    z.object({
      routeId: z.uuid(),
      method: z.string(),
      path: z.string(),
      file: z.string(),
      line: z.number().int(),
      handler: location.extend({ label: z.string() }).nullable(),
      resolvedCalls: z.number().int(),
    }),
  ),
  /** Application components (not tests or tooling), largest first. */
  components: z.array(
    z.object({
      id: z.string(),
      fileCount: z.number().int(),
      routeCount: z.number().int(),
      importsFrom: z.array(z.string()),
    }),
  ),
  integrations: z.array(z.object({ name: z.string(), kind: z.string() })),
  dataModels: z.array(
    z.object({ name: z.string(), source: z.string(), file: z.string(), line: z.number().int() }),
  ),
  envVars: z.array(z.object({ name: z.string(), file: z.string(), line: z.number().int() })),
});

export const guideResponseSchema = z.object({ guide: guideSchema });

/**
 * GET /api/snapshots/:id/guide/summary: the one AI-written part of the guide, a short
 * summary of what the project is. Generated once per snapshot and cached.
 */
export const guideSummaryResponseSchema = z.object({
  summary: z
    .object({ text: z.string(), model: z.string(), generatedAt: z.iso.datetime() })
    .nullable(),
  /** Why there is no summary (no AI configured, or the model was unavailable). */
  reason: z.string().optional(),
});

export type Guide = z.infer<typeof guideSchema>;
export type GuideSummaryResponse = z.infer<typeof guideSummaryResponseSchema>;
