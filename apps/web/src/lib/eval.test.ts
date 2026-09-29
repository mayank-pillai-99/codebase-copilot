import type { EvalRetrieverReport } from '@codebase-copilot/shared';
import { describe, expect, it } from 'vitest';
import { bestLabels, formatMetric, formatMs } from './eval';

const report = (label: string, recall5: number): EvalRetrieverReport => ({
  label,
  overall: { questions: 10, recall5, recall10: recall5, mrr: 0.5, ndcg10: 0.5 },
  byType: {},
  byRepo: {},
  latencyMs: { p50: 1, p95: 2 },
});

describe('eval formatting', () => {
  it('formats recall as a percentage and rank metrics as scores', () => {
    expect(formatMetric('recall5', 0.8123)).toBe('81.2%');
    expect(formatMetric('mrr', 0.71234)).toBe('0.712');
  });

  it('marks the best retriever, including ties', () => {
    const reports = [report('a', 0.5), report('b', 0.7), report('c', 0.7)];
    expect(bestLabels(reports, (s) => s.recall5)).toEqual(new Set(['b', 'c']));
    expect(bestLabels(reports, (s) => s.mrr)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('skips retrievers without a value for a breakdown', () => {
    const reports = [report('a', 0.5), report('b', 0.9)];
    const best = bestLabels(
      reports,
      (s) => s.recall5,
      (r) => (r.label === 'b' ? undefined : r.overall),
    );
    expect(best).toEqual(new Set(['a']));
  });

  it('formats latency', () => {
    expect(formatMs(4.26)).toBe('4.3 ms');
    expect(formatMs(812.4)).toBe('812 ms');
  });
});
