import { describe, expect, it } from 'vitest';
import {
  aggregate,
  ndcgAt,
  percentile,
  rankFiles,
  recallAt,
  reciprocalRank,
  scoreQuestion,
} from '../src/eval/metrics';

const gold = (...paths: string[]) => new Set(paths);

describe('retrieval metrics', () => {
  it('collapses chunks into files ranked by their best chunk', () => {
    expect(rankFiles(['a.ts', 'b.ts', 'a.ts', 'c.ts', 'b.ts'])).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('computes recall at a cutoff', () => {
    const ranked = ['x', 'a', 'y', 'z', 'w', 'b'];
    expect(recallAt(ranked, gold('a', 'b'), 5)).toBe(0.5);
    expect(recallAt(ranked, gold('a', 'b'), 10)).toBe(1);
    expect(recallAt(ranked, gold(), 5)).toBe(0);
  });

  it('computes the reciprocal rank of the first relevant file', () => {
    expect(reciprocalRank(['x', 'y', 'a'], gold('a', 'y'))).toBe(0.5);
    expect(reciprocalRank(['x'], gold('a'))).toBe(0);
  });

  it('computes nDCG against an ideal ordering', () => {
    expect(ndcgAt(['a', 'b'], gold('a', 'b'), 10)).toBe(1);
    // One relevant file at rank 2 of a single-file gold set: (1/log2 3) / 1.
    expect(ndcgAt(['x', 'a'], gold('a'), 10)).toBeCloseTo(1 / Math.log2(3));
    // More gold files than the cutoff: the ideal is capped at k.
    expect(ndcgAt(['a'], gold('a', 'b', 'c'), 1)).toBe(1);
    expect(ndcgAt(['x', 'y'], gold('a'), 10)).toBe(0);
  });

  it('scores and averages questions', () => {
    const perfect = scoreQuestion(['a'], ['a']);
    const miss = scoreQuestion(['x'], ['a']);
    expect(perfect).toEqual({ recall5: 1, recall10: 1, mrr: 1, ndcg10: 1 });
    expect(aggregate([perfect, miss])).toEqual({
      questions: 2,
      recall5: 0.5,
      recall10: 0.5,
      mrr: 0.5,
      ndcg10: 0.5,
    });
  });

  it('uses nearest-rank percentiles', () => {
    const latencies = [50, 10, 40, 20, 30, 60, 70, 80, 90, 100];
    expect(percentile(latencies, 50)).toBe(50);
    expect(percentile(latencies, 95)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });
});
