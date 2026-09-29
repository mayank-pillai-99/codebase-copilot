import { z } from 'zod';

/** Question categories in the retrieval dataset (SPEC §8.1). */
export const evalQuestionTypes = ['conceptual', 'locational', 'flow', 'vocabulary'] as const;

export const evalScoresSchema = z.object({
  questions: z.number().int().nonnegative(),
  recall5: z.number(),
  recall10: z.number(),
  mrr: z.number(),
  ndcg10: z.number(),
});

const latencySchema = z.object({ p50: z.number(), p95: z.number() });

export const evalRetrieverReportSchema = z.object({
  label: z.string(),
  overall: evalScoresSchema,
  byType: z.partialRecord(z.enum(evalQuestionTypes), evalScoresSchema),
  byRepo: z.record(z.string(), evalScoresSchema),
  latencyMs: latencySchema,
});

export const evalQuestionResultSchema = z.object({
  id: z.string(),
  repo: z.string(),
  type: z.enum(evalQuestionTypes),
  question: z.string(),
  gold: z.array(z.string()),
  results: z.record(
    z.string(),
    z.object({
      files: z.array(z.string()),
      scores: evalScoresSchema.omit({ questions: true }),
      latencyMs: z.number(),
    }),
  ),
});

/**
 * A retrieval evaluation run. The runner writes this shape to eval/results/*.json and
 * the eval_runs table; GET /api/eval/latest returns it.
 */
export const evalRunSchema = z.object({
  id: z.uuid(),
  kind: z.literal('retrieval'),
  createdAt: z.iso.datetime(),
  datasetVersion: z.string(),
  config: z.object({
    /** Chunks requested per question before collapsing to files. */
    k: z.number().int().positive(),
    embeddingModel: z.string(),
    repos: z.array(z.object({ repo: z.string(), sha: z.string(), description: z.string() })),
    questions: z.number().int().positive(),
    questionSources: z.object({ human: z.number().int(), llmDrafted: z.number().int() }),
    /** How a person checked the LLM-drafted questions (null on draft runs). */
    review: z
      .object({
        method: z.literal('random-sample'),
        seed: z.number().int(),
        sampled: z.number().int(),
        kept: z.number().int(),
        edited: z.number().int(),
        dropped: z.number().int(),
      })
      .nullable(),
    /** Git commit of the code that produced the run ("-dirty" if uncommitted changes). */
    codeVersion: z.string(),
  }),
  metrics: z.object({
    retrievers: z.array(evalRetrieverReportSchema),
    /** Query embedding time, measured separately from retrieval. */
    queryEmbeddingMs: latencySchema.extend({ calls: z.number().int() }),
  }),
  results: z.array(evalQuestionResultSchema),
});

export const evalLatestResponseSchema = z.object({ run: evalRunSchema.nullable() });

export type EvalScores = z.infer<typeof evalScoresSchema>;
export type EvalRetrieverReport = z.infer<typeof evalRetrieverReportSchema>;
export type EvalQuestionResult = z.infer<typeof evalQuestionResultSchema>;
export type EvalRun = z.infer<typeof evalRunSchema>;
export type EvalLatestResponse = z.infer<typeof evalLatestResponseSchema>;
