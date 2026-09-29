import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GitHubClient } from '../src/github/client';
import { createIndexer, embedMissingChunks } from '../src/indexing/indexer';
import { createCodeParser } from '../src/indexing/parser';
import { createPrisma, type PrismaClient } from '../src/lib/prisma';
import { hashingEmbedder } from './support/fakes';
import { fixtureEntries } from './support/fixture-repo';
import { makeTarball, toWebStream } from './support/tar';

const { DATABASE_URL, RUN_INTEGRATION } = process.env;

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL)('embedMissingChunks (integration)', () => {
  let prisma: PrismaClient;
  const owner = `backfill-${randomUUID().slice(0, 8)}`;
  let snapshotId = '';

  beforeAll(async () => {
    prisma = createPrisma(DATABASE_URL!);
    const github: GitHubClient = {
      getRepository: async () => {
        throw new Error('unused');
      },
      resolveCommit: async () => 'x',
      downloadTarball: async () => toWebStream(makeTarball(fixtureEntries())),
    };
    // Indexed without embeddings, as when no key is configured.
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
    const repository = await prisma.repository.create({
      data: { owner, name: 'app', defaultBranch: 'main' },
    });
    const snapshot = await prisma.snapshot.create({
      data: { repositoryId: repository.id, commitSha: 'c'.repeat(40), ref: 'main' },
    });
    await index(snapshot.id, { isFinalAttempt: true });
    snapshotId = snapshot.id;
  });

  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { owner } });
    await prisma.$disconnect();
  });

  it('keeps finished batches when the embedder fails, then resumes', async () => {
    const total = await prisma.chunk.count({ where: { snapshotId } });
    expect(total).toBeGreaterThan(2);

    const real = hashingEmbedder();
    let calls = 0;
    const flaky = {
      model: real.model,
      embedDocuments: async (texts: string[]) => {
        if (++calls > 1) throw new Error('rate limited');
        return real.embedDocuments(texts);
      },
    };
    await expect(
      embedMissingChunks({ prisma, embedder: flaky, batchSize: 2 }, snapshotId),
    ).rejects.toThrow('rate limited');
    expect(await prisma.chunk.count({ where: { snapshotId, embeddingModel: real.model } })).toBe(2);

    const progress: number[] = [];
    const result = await embedMissingChunks(
      { prisma, embedder: real, batchSize: 2, onProgress: (done) => progress.push(done) },
      snapshotId,
    );
    expect(result).toEqual({ embedded: total, total });
    expect(progress[0]).toBe(4); // resumed after the two saved chunks
    const snapshot = await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    expect((snapshot.stats as { embeddings: unknown }).embeddings).toEqual({
      status: 'complete',
      model: real.model,
      embedded: total,
    });
  });

  it('does nothing when every chunk already has a vector from the model', async () => {
    let calls = 0;
    const real = hashingEmbedder();
    const counting = {
      model: real.model,
      embedDocuments: async (texts: string[]) => {
        calls++;
        return real.embedDocuments(texts);
      },
    };
    const result = await embedMissingChunks({ prisma, embedder: counting }, snapshotId);
    expect(calls).toBe(0);
    expect(result.embedded).toBe(result.total);
  });

  it('re-embeds chunks whose vectors came from a different model', async () => {
    const other = hashingEmbedder('other-model-768');
    const result = await embedMissingChunks({ prisma, embedder: other }, snapshotId);
    expect(result.embedded).toBe(result.total);
    expect(
      await prisma.chunk.count({ where: { snapshotId, embeddingModel: 'other-model-768' } }),
    ).toBe(result.total);
  });
});
