import { describe, expect, it } from 'vitest';
import type { EvalQuestion } from '../src/eval/dataset';
import { createPrimedEmbedder, findMissingGold, runEval } from '../src/eval/runner';
import type { RetrievedChunk, Retriever } from '../src/retrieval/types';

const question = (id: string, overrides: Partial<EvalQuestion> = {}): EvalQuestion => ({
  id,
  repo: 'acme/api',
  type: 'locational',
  question: `question ${id}`,
  gold: ['src/auth.ts'],
  source: 'human',
  reviewed: true,
  ...overrides,
});

const chunk = (path: string): RetrievedChunk => ({
  chunkId: path,
  fileId: path,
  symbolId: null,
  path,
  kind: 'symbol',
  label: null,
  startLine: 1,
  endLine: 2,
  header: '',
  content: '',
  score: 1,
  sources: ['fulltext'],
});

/** Returns fixed paths per query text. */
function scripted(name: Retriever['name'], answers: Record<string, string[]>): Retriever {
  return {
    name,
    retrieve: async ({ query }) => (answers[query] ?? []).map(chunk),
  };
}

describe('runEval', () => {
  const questions = [
    question('q1'),
    question('q2', { type: 'conceptual', gold: ['src/db.ts', 'src/models.ts'] }),
  ];
  it('scores each retriever per question, type and repo', async () => {
    let clock = 0;
    const report = await runEval({
      questions,
      snapshots: new Map([['acme/api', 'snap-1']]),
      targets: [
        {
          label: 'good',
          retriever: scripted('hybrid', {
            'question q1': ['src/auth.ts', 'src/auth.ts', 'src/other.ts'],
            'question q2': ['src/db.ts', 'src/x.ts', 'src/models.ts'],
          }),
        },
        { label: 'empty', retriever: scripted('vector', {}) },
      ],
      k: 20,
      now: () => (clock += 5),
    });

    const [good, empty] = report.retrievers;
    expect(good!.label).toBe('good');
    expect(good!.overall).toMatchObject({ questions: 2, recall5: 1, mrr: 1 });
    expect(good!.byType.conceptual?.questions).toBe(1);
    expect(good!.byRepo['acme/api']?.questions).toBe(2);
    expect(good!.latencyMs).toEqual({ p50: 5, p95: 5 });
    expect(empty!.overall).toMatchObject({ recall5: 0, recall10: 0, mrr: 0, ndcg10: 0 });

    // Chunks from the same file count once.
    expect(report.questions[0]!.results.good!.files).toEqual(['src/auth.ts', 'src/other.ts']);
  });

  it('passes the snapshot for the question’s repository', async () => {
    const seen: string[] = [];
    await runEval({
      questions: [question('q1')],
      snapshots: new Map([['acme/api', 'snap-9']]),
      targets: [
        {
          label: 'spy',
          retriever: {
            name: 'hybrid',
            retrieve: async ({ snapshotId, k }) => {
              seen.push(`${snapshotId}:${k}`);
              return [];
            },
          },
        },
      ],
      k: 20,
    });
    expect(seen).toEqual(['snap-9:20']);
  });

  it('aborts instead of scoring a failed query as a miss', async () => {
    const failing: Retriever = {
      name: 'vector',
      retrieve: async () => {
        throw new Error('embedding service down');
      },
    };
    await expect(
      runEval({
        questions,
        snapshots: new Map([['acme/api', 's']]),
        targets: [{ label: 'vector', retriever: failing }],
        k: 20,
      }),
    ).rejects.toThrow('embedding service down');
  });
});

describe('findMissingGold', () => {
  it('lists gold paths that are not in the snapshot', () => {
    const missing = findMissingGold(
      [question('q1', { gold: ['src/auth.ts', 'src/typo.ts'] })],
      new Map([['acme/api', new Set(['src/auth.ts'])]]),
    );
    expect(missing).toEqual([{ id: 'q1', path: 'src/typo.ts' }]);
  });
});

describe('createPrimedEmbedder', () => {
  it('embeds each query once and times only real calls', async () => {
    let calls = 0;
    let clock = 0;
    const embedder = createPrimedEmbedder(
      {
        model: 'm',
        embedQuery: async () => {
          calls++;
          clock += 100;
          return [calls];
        },
      },
      () => clock,
    );
    await embedder.prime(['a', 'b', 'a']);
    expect(await embedder.embedQuery('a')).toEqual([1]);
    expect(await embedder.embedQuery('a')).toEqual([1]);
    expect(calls).toBe(2);
    expect(embedder.latency()).toEqual({ calls: 2, p50: 100, p95: 100 });
    await expect(embedder.embedQuery('unseen')).rejects.toThrow(/not primed/);
  });
});
