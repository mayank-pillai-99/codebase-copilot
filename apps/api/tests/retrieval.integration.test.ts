import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GitHubClient } from '../src/github/client';
import { createIndexer } from '../src/indexing/indexer';
import { createCodeParser } from '../src/indexing/parser';
import { createPrisma, type PrismaClient } from '../src/lib/prisma';
import { createFullTextRetriever } from '../src/retrieval/fulltext';
import { createHybridRetriever } from '../src/retrieval/hybrid';
import type { RetrievedChunk } from '../src/retrieval/types';
import { createVectorRetriever } from '../src/retrieval/vector';
import { hashingEmbedder } from './support/fakes';
import { fixtureEntries } from './support/fixture-repo';
import { makeTarball, toWebStream } from './support/tar';

const { DATABASE_URL, RUN_INTEGRATION } = process.env;

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL)('retrieval (integration)', () => {
  let prisma: PrismaClient;
  const owner = `retrieval-${randomUUID().slice(0, 8)}`;
  const snapshotIds: string[] = [];
  let expansionSnapshotId = '';
  const embedder = hashingEmbedder();

  // submitOrder calls chargeCard, and the two share no words.
  const expansionRepo = [
    {
      path: 'src/checkout.ts',
      content: `import { chargeCard } from './billing';\nexport function submitOrder() {\n  return chargeCard();\n}\n`,
    },
    {
      path: 'src/billing.ts',
      content: `export function chargeCard() {\n  return stripe.charges.create();\n}\n`,
    },
  ];

  beforeAll(async () => {
    prisma = createPrisma(DATABASE_URL!);
    const github: GitHubClient = {
      getRepository: async () => {
        throw new Error('unused');
      },
      resolveCommit: async () => 'x',
      downloadTarball: async (_owner, repo) =>
        toWebStream(makeTarball(repo === 'expansion' ? expansionRepo : fixtureEntries())),
    };
    const index = createIndexer({
      prisma,
      github,
      getParser: createCodeParser,
      embedder,
      limits: {
        maxArchiveBytes: 1e7,
        maxFileBytes: 2e5,
        maxTotalBytes: 1e7,
        maxCodeFiles: 100,
        maxChunks: 1000,
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    // Two identical snapshots (to check results never leak across snapshots) and one
    // tiny repo for graph expansion.
    for (const name of ['a', 'b', 'expansion']) {
      const repository = await prisma.repository.create({
        data: { owner, name, defaultBranch: 'main' },
      });
      const snapshot = await prisma.snapshot.create({
        data: { repositoryId: repository.id, commitSha: 'f'.repeat(40), ref: 'main' },
      });
      await index(snapshot.id, { isFinalAttempt: true });
      if (name === 'expansion') expansionSnapshotId = snapshot.id;
      else snapshotIds.push(snapshot.id);
    }
  });

  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { owner } });
    await prisma.$disconnect();
  });

  const labels = (chunks: RetrievedChunk[]) =>
    chunks.map((c) => c.label ?? `${c.path}:${c.startLine}`);

  it('full-text search matches camelCase symbols from word queries', async () => {
    const results = await createFullTextRetriever(prisma).retrieve({
      snapshotId: snapshotIds[0]!,
      query: 'How do we create a payment?',
      k: 5,
    });
    expect(labels(results)).toContain('createPayment');
    expect(results.every((r) => r.sources.includes('fulltext'))).toBe(true);
  });

  it('vector search ranks by embedding similarity and stays within the snapshot', async () => {
    const results = await createVectorRetriever(prisma, embedder).retrieve({
      snapshotId: snapshotIds[1]!,
      query: 'validate amount invalid',
      k: 3,
    });
    // Small classes are one chunk, so the class chunk (containing validate) is the hit.
    expect(labels(results)[0]).toBe('PaymentService');
    const owners = await prisma.chunk.findMany({
      where: { id: { in: results.map((r) => r.chunkId) } },
      select: { snapshotId: true },
    });
    expect(owners.every((o) => o.snapshotId === snapshotIds[1])).toBe(true);
    expect(results[0]!.score).toBeGreaterThan(results.at(-1)!.score - 1e-9);
  });

  it('refuses to compare vectors from a different embedding model', async () => {
    const other = hashingEmbedder('some-other-model');
    const results = await createVectorRetriever(prisma, other).retrieve({
      snapshotId: snapshotIds[0]!,
      query: 'payment',
      k: 5,
    });
    expect(results).toEqual([]);
  });

  it('returns nothing from vector search when no embedder is configured', async () => {
    const results = await createVectorRetriever(prisma, null).retrieve({
      snapshotId: snapshotIds[0]!,
      query: 'payment',
      k: 5,
    });
    expect(results).toEqual([]);
  });

  it('hybrid search fuses vector and full-text results', async () => {
    const hybrid = createHybridRetriever(
      prisma,
      createVectorRetriever(prisma, embedder),
      createFullTextRetriever(prisma),
    );
    const results = await hybrid.retrieve({
      snapshotId: snapshotIds[0]!,
      query: 'createPayment handler',
      k: 6,
    });

    const top3 = results.slice(0, 3);
    expect(labels(top3)).toContain('createPayment');
    expect(top3.find((r) => r.label === 'createPayment')?.sources).toEqual(
      expect.arrayContaining(['vector', 'fulltext']),
    );
    expect(new Set(results.map((r) => r.chunkId)).size).toBe(results.length);
  });

  it('still works as full-text plus graph when there are no embeddings', async () => {
    const hybrid = createHybridRetriever(
      prisma,
      createVectorRetriever(prisma, null),
      createFullTextRetriever(prisma),
    );
    const results = await hybrid.retrieve({
      snapshotId: snapshotIds[0]!,
      query: 'createPayment',
      k: 4,
    });
    expect(labels(results.slice(0, 3))).toContain('createPayment');
  });

  it('pulls in called code that shares no words with the query', async () => {
    // Full-text only: vector search returns every chunk of a two-file repo anyway.
    const hybrid = createHybridRetriever(
      prisma,
      createVectorRetriever(prisma, null),
      createFullTextRetriever(prisma),
    );
    const results = await hybrid.retrieve({
      snapshotId: expansionSnapshotId,
      query: 'submit order',
      k: 5,
    });
    expect(results.map((r) => [r.label, r.sources])).toEqual([
      ['submitOrder', ['fulltext']],
      ['chargeCard', ['graph']],
    ]);
    expect(results[1]!.score).toBeCloseTo(results[0]!.score / 2);
  });

  it('can turn graph expansion off (for evaluation)', async () => {
    const hybrid = createHybridRetriever(
      prisma,
      createVectorRetriever(prisma, null),
      createFullTextRetriever(prisma),
      { graphExpansion: false },
    );
    const results = await hybrid.retrieve({
      snapshotId: expansionSnapshotId,
      query: 'submit order',
      k: 5,
    });
    expect(labels(results)).toEqual(['submitOrder']);
  });
});
