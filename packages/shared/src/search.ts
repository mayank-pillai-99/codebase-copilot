import { z } from 'zod';

/** Retrievers that can be queried directly; hybrid is what chat uses. */
export const searchRetrievers = ['hybrid', 'vector', 'fulltext'] as const;

export const searchRequestSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, 'Enter something to search for')
    .max(500, 'Searches are limited to 500 characters'),
  retriever: z.enum(searchRetrievers).default('hybrid'),
  k: z.number().int().min(1).max(30).default(10),
});

export const searchResultSchema = z.object({
  chunkId: z.uuid(),
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  kind: z.string(),
  label: z.string().nullable(),
  /** Comparable only within one response. */
  score: z.number(),
  sources: z.array(z.enum(['vector', 'fulltext', 'graph'])),
});

export const searchResponseSchema = z.object({
  retriever: z.enum(searchRetrievers),
  results: z.array(searchResultSchema),
});

export type SearchRequest = z.input<typeof searchRequestSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
