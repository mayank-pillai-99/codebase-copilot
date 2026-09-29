import type { EvalRetrieverReport, EvalScores } from '@codebase-copilot/shared';

export type MetricKey = 'recall5' | 'recall10' | 'mrr' | 'ndcg10';

export const METRICS: { key: MetricKey; label: string; help: string }[] = [
  {
    key: 'recall5',
    label: 'Recall@5',
    help: 'Share of the answer files that appear in the top 5 files',
  },
  { key: 'recall10', label: 'Recall@10', help: 'The same, within the top 10 files' },
  { key: 'mrr', label: 'MRR', help: 'Mean of 1 / rank of the first answer file' },
  {
    key: 'ndcg10',
    label: 'nDCG@10',
    help: 'Rewards answer files ranked near the top (1 = ideal order)',
  },
];

/** Recall as a percentage, rank metrics as a 0–1 score. */
export function formatMetric(key: MetricKey, value: number): string {
  return key.startsWith('recall') ? `${(value * 100).toFixed(1)}%` : value.toFixed(3);
}

/** Label(s) of the retriever(s) with the highest value; ties are all best. */
export function bestLabels(
  reports: readonly EvalRetrieverReport[],
  pick: (scores: EvalScores) => number | undefined,
  source: (report: EvalRetrieverReport) => EvalScores | undefined = (r) => r.overall,
): Set<string> {
  let best = -Infinity;
  const labels = new Set<string>();
  for (const report of reports) {
    const scores = source(report);
    const value = scores ? pick(scores) : undefined;
    if (value === undefined) continue;
    if (value > best + 1e-9) {
      best = value;
      labels.clear();
      labels.add(report.label);
    } else if (Math.abs(value - best) <= 1e-9) {
      labels.add(report.label);
    }
  }
  return labels;
}

export function formatMs(ms: number): string {
  return ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`;
}
