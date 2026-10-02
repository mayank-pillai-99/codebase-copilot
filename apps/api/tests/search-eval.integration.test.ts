import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvalRun } from '@codebase-copilot/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GitHubClient } from '../src/github/client';
import { createIndexer } from '../src/indexing/indexer';
import { createCodeParser } from '../src/indexing/parser';
import { createPrisma, type PrismaClient } from '../src/lib/prisma';
import { createFullTextRetriever } from '../src/retrieval/fulltext';
import { createHybridRetriever } from '../src/retrieval/hybrid';
import { createVectorRetriever } from '../src/retrieval/vector';
import { createEvalService, importEvalResults } from '../src/services/eval.service';
import { createSearchService } from '../src/services/search.service';
import { fixtureEntries } from './support/fixture-repo';
import { makeTarball, toWebStream } from './support/tar';

const { DATABASE_URL, RUN_INTEGRATION } = process.env;

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL)('search service (integration)', () => {
  let prisma: PrismaClient;
  const owner = `search-${randomUUID().slice(0, 8)}`;
  let readyId = '';
  let queuedId = '';
  let userId = '';

  beforeAll(async () => {
    prisma = createPrisma(DATABASE_URL!);
    const github: GitHubClient = {
      getRepository: async () => {
        throw new Error('unused');
      },
      resolveCommit: async () => 'x',
      downloadTarball: async () => toWebStream(makeTarball(fixtureEntries())),
    };
    const index = createIndexer({
      prisma,
      github,
      getParser: createCodeParser,
      embedder: null,
      limits: {
        maxArchiveBytes: 1e7,
        maxFileBytes: 2e5,
        maxTotalBytes: 1e7,
        maxCodeFiles: 100,
        maxChunks: 1000,
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    const user = await prisma.user.create({
      data: { email: `${owner}@example.com`, passwordHash: 'x' },
    });
    userId = user.id;
    const repository = await prisma.repository.create({
      data: {
        owner,
        name: 'app',
        defaultBranch: 'main',
        trackedBy: { create: { userId } },
      },
    });
    const ready = await prisma.snapshot.create({
      data: { repositoryId: repository.id, commitSha: 'a'.repeat(40), ref: 'main' },
    });
    await index(ready.id, { isFinalAttempt: true });
    readyId = ready.id;
    const queued = await prisma.snapshot.create({
      data: { repositoryId: repository.id, commitSha: 'b'.repeat(40), ref: 'dev' },
    });
    queuedId = queued.id;
  });

  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { owner } });
    await prisma.user.deleteMany({ where: { email: `${owner}@example.com` } });
    await prisma.$disconnect();
  });

  function service() {
    const vector = createVectorRetriever(prisma, null);
    const fulltext = createFullTextRetriever(prisma);
    return createSearchService({
      prisma,
      retrievers: { hybrid: createHybridRetriever(prisma, vector, fulltext), vector, fulltext },
    });
  }

  it('returns ranked chunks with locations for the owner', async () => {
    const res = await service().search(userId, readyId, {
      query: 'create payment',
      retriever: 'fulltext',
      k: 3,
    });
    expect(res.retriever).toBe('fulltext');
    expect(res.results.map((r) => r.label)).toContain('createPayment');
    expect(res.results[0]).toMatchObject({ sources: ['fulltext'] });
    expect(res.results[0]!.startLine).toBeGreaterThan(0);
    expect(res.results.find((r) => r.label === 'createPayment')?.snippet).toContain(
      'createPayment',
    );
  });

  it('hides snapshots from other viewers and refuses unfinished ones', async () => {
    await expect(
      service().search(null, readyId, { query: 'payment', retriever: 'hybrid', k: 3 }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      service().search(userId, queuedId, { query: 'payment', retriever: 'hybrid', k: 3 }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL)('evaluation results (integration)', () => {
  let prisma: PrismaClient;
  let dir = '';
  const ids: string[] = [];

  const run = (createdAt: string, recall5: number): EvalRun => {
    const id = randomUUID();
    ids.push(id);
    const scores = { questions: 1, recall5, recall10: 1, mrr: 1, ndcg10: 1 };
    return {
      id,
      kind: 'retrieval',
      createdAt,
      datasetVersion: 'v1+test',
      config: {
        k: 20,
        embeddingModel: 'test',
        repos: [{ repo: 'acme/api', sha: 'a'.repeat(40), description: 'x' }],
        questions: 1,
        questionSources: { human: 0, llmDrafted: 1 },
        review: { method: 'random-sample', seed: 1, sampled: 1, kept: 1, edited: 0, dropped: 0 },
        codeVersion: 'abc1234',
      },
      metrics: {
        retrievers: [
          {
            label: 'hybrid',
            overall: scores,
            byType: { locational: scores },
            byRepo: { 'acme/api': scores },
            latencyMs: { p50: 5, p95: 9 },
          },
        ],
        queryEmbeddingMs: { calls: 1, p50: 100, p95: 100 },
      },
      results: [],
    };
  };

  beforeAll(async () => {
    prisma = createPrisma(DATABASE_URL!);
    dir = await mkdtemp(join(tmpdir(), 'eval-results-'));
  });

  afterAll(async () => {
    await prisma.evalRun.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await rm(dir, { recursive: true, force: true });
  });

  it('imports committed runs once and serves the newest', async () => {
    // Far-future dates so rows left by other runs of this suite don't win.
    const older = run('2999-01-01T00:00:00.000Z', 0.5);
    const newer = run('2999-02-01T00:00:00.000Z', 0.75);
    await writeFile(join(dir, 'a.json'), JSON.stringify(older));
    await writeFile(join(dir, 'b.json'), JSON.stringify(newer));
    await writeFile(join(dir, 'notes.txt'), 'ignored');

    expect(await importEvalResults(prisma, dir)).toBe(2);
    expect(await importEvalResults(prisma, dir)).toBe(0);

    const latest = await createEvalService(prisma).latest();
    expect(latest).toEqual(newer);
  });

  it('treats a missing directory as empty and rejects malformed files', async () => {
    expect(await importEvalResults(prisma, join(dir, 'missing'))).toBe(0);
    const bad = await mkdtemp(join(tmpdir(), 'eval-bad-'));
    await writeFile(join(bad, 'broken.json'), JSON.stringify({ id: 'nope' }));
    await expect(importEvalResults(prisma, bad)).rejects.toThrow(/broken.json/);
    await rm(bad, { recursive: true, force: true });
  });
});
