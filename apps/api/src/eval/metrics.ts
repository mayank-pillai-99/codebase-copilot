/**
 * File-level retrieval metrics (SPEC §8.2). Retrievers return chunks; a question's
 * gold labels are files, so chunks are first collapsed into a ranked list of distinct
 * files (a file ranks where its best chunk ranks). Relevance is binary.
 */

/** Distinct paths in order of first appearance. */
export function rankFiles(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

/** Share of gold files found in the top k. */
export function recallAt(ranked: readonly string[], gold: ReadonlySet<string>, k: number): number {
  if (gold.size === 0) return 0;
  return ranked.slice(0, k).filter((p) => gold.has(p)).length / gold.size;
}

/** 1 / rank of the first gold file; 0 when none was retrieved. */
export function reciprocalRank(ranked: readonly string[], gold: ReadonlySet<string>): number {
  const index = ranked.findIndex((p) => gold.has(p));
  return index === -1 ? 0 : 1 / (index + 1);
}

/** Normalized discounted cumulative gain with binary relevance. */
export function ndcgAt(ranked: readonly string[], gold: ReadonlySet<string>, k: number): number {
  const dcg = ranked
    .slice(0, k)
    .reduce((sum, p, i) => sum + (gold.has(p) ? 1 / Math.log2(i + 2) : 0), 0);
  let ideal = 0;
  for (let i = 0; i < Math.min(k, gold.size); i++) ideal += 1 / Math.log2(i + 2);
  return ideal === 0 ? 0 : dcg / ideal;
}

export interface QuestionScores {
  recall5: number;
  recall10: number;
  mrr: number;
  ndcg10: number;
}

export function scoreQuestion(ranked: readonly string[], gold: readonly string[]): QuestionScores {
  const set = new Set(gold);
  return {
    recall5: recallAt(ranked, set, 5),
    recall10: recallAt(ranked, set, 10),
    mrr: reciprocalRank(ranked, set),
    ndcg10: ndcgAt(ranked, set, 10),
  };
}

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Nearest-rank percentile (p in 0–100) of unsorted values. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export interface AggregateScores extends QuestionScores {
  questions: number;
}

export function aggregate(scores: readonly QuestionScores[]): AggregateScores {
  return {
    questions: scores.length,
    recall5: mean(scores.map((s) => s.recall5)),
    recall10: mean(scores.map((s) => s.recall10)),
    mrr: mean(scores.map((s) => s.mrr)),
    ndcg10: mean(scores.map((s) => s.ndcg10)),
  };
}
