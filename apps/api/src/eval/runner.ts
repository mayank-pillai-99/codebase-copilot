import type { QueryEmbedder, Retriever } from '../retrieval/types';
import type { EvalQuestion, QuestionType } from './dataset';
import {
  aggregate,
  percentile,
  rankFiles,
  scoreQuestion,
  type AggregateScores,
  type QuestionScores,
} from './metrics';

/** A retriever under test, labelled as it appears in reports ("hybrid (no graph)"). */
export interface EvalTarget {
  label: string;
  retriever: Retriever;
}

export interface LatencySummary {
  p50: number;
  p95: number;
}

export interface RetrieverReport {
  label: string;
  overall: AggregateScores;
  byType: Partial<Record<QuestionType, AggregateScores>>;
  byRepo: Record<string, AggregateScores>;
  /** Retrieval time per question, excluding the query embedding (reported separately). */
  latencyMs: LatencySummary;
}

export interface QuestionResult {
  id: string;
  repo: string;
  type: QuestionType;
  question: string;
  gold: string[];
  /** Per retriever label: the top 10 files and the scores. */
  results: Record<string, { files: string[]; scores: QuestionScores; latencyMs: number }>;
}

export interface EvalReport {
  retrievers: RetrieverReport[];
  questions: QuestionResult[];
}

export interface RunEvalInput {
  questions: EvalQuestion[];
  /** Snapshot id per `owner/name`, each at the commit pinned in the dataset. */
  snapshots: ReadonlyMap<string, string>;
  targets: EvalTarget[];
  /** Chunks requested per question; enough to fill ten distinct files in practice. */
  k: number;
  onProgress?: (done: number, total: number) => void;
  now?: () => number;
}

/**
 * Runs every target on every question, sequentially so latencies aren't distorted by
 * contention. A retriever error aborts the run: a failed query silently scored as a
 * miss would understate that retriever.
 */
export async function runEval(input: RunEvalInput): Promise<EvalReport> {
  const { questions, snapshots, targets, k } = input;
  const now = input.now ?? performance.now.bind(performance);
  const results: QuestionResult[] = [];

  for (const [index, question] of questions.entries()) {
    const snapshotId = snapshots.get(question.repo);
    if (!snapshotId) throw new Error(`No snapshot for ${question.repo}`);
    const entry: QuestionResult = {
      id: question.id,
      repo: question.repo,
      type: question.type,
      question: question.question,
      gold: question.gold,
      results: {},
    };
    for (const { label, retriever } of targets) {
      const started = now();
      const chunks = await retriever.retrieve({ snapshotId, query: question.question, k });
      const latencyMs = now() - started;
      const files = rankFiles(chunks.map((c) => c.path));
      entry.results[label] = {
        files: files.slice(0, 10),
        scores: scoreQuestion(files, question.gold),
        latencyMs: Math.round(latencyMs * 10) / 10,
      };
    }
    results.push(entry);
    input.onProgress?.(index + 1, questions.length);
  }

  return { retrievers: targets.map(({ label }) => summarize(label, results)), questions: results };
}

function summarize(label: string, results: QuestionResult[]): RetrieverReport {
  const scoresWhere = (keep: (r: QuestionResult) => boolean) =>
    aggregate(results.filter(keep).map((r) => r.results[label]!.scores));
  const byType: RetrieverReport['byType'] = {};
  for (const type of new Set(results.map((r) => r.type))) {
    byType[type] = scoresWhere((r) => r.type === type);
  }
  const byRepo: RetrieverReport['byRepo'] = {};
  for (const repo of new Set(results.map((r) => r.repo))) {
    byRepo[repo] = scoresWhere((r) => r.repo === repo);
  }
  const latencies = results.map((r) => r.results[label]!.latencyMs);
  return {
    label,
    overall: scoresWhere(() => true),
    byType,
    byRepo,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
  };
}

/** Gold paths that don't exist in the indexed snapshot: typos, or files the indexer skipped. */
export function findMissingGold(
  questions: readonly EvalQuestion[],
  pathsByRepo: ReadonlyMap<string, ReadonlySet<string>>,
): { id: string; path: string }[] {
  return questions.flatMap((q) =>
    q.gold
      .filter((path) => !pathsByRepo.get(q.repo)?.has(path))
      .map((path) => ({ id: q.id, path })),
  );
}

/**
 * Embeds each query once, up front, and serves later lookups from memory. Vector and
 * hybrid retrieval then measure database time only, both see identical vectors, and
 * the embedding latency is recorded on its own.
 */
export function createPrimedEmbedder(inner: QueryEmbedder, now = () => performance.now()) {
  const vectors = new Map<string, number[]>();
  const latencies: number[] = [];
  return {
    model: inner.model,
    async prime(queries: readonly string[]) {
      for (const query of queries) {
        if (vectors.has(query)) continue;
        const started = now();
        vectors.set(query, await inner.embedQuery(query));
        latencies.push(now() - started);
      }
    },
    async embedQuery(query: string) {
      const vector = vectors.get(query);
      if (!vector) throw new Error('Query was not primed before retrieval');
      return vector;
    },
    latency(): LatencySummary & { calls: number } {
      return {
        calls: latencies.length,
        p50: Math.round(percentile(latencies, 50)),
        p95: Math.round(percentile(latencies, 95)),
      };
    },
  };
}
