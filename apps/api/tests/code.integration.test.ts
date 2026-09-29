import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GitHubClient } from '../src/github/client';
import { createIndexer } from '../src/indexing/indexer';
import { createCodeParser } from '../src/indexing/parser';
import { AppError } from '../src/lib/errors';
import { createPrisma, type PrismaClient } from '../src/lib/prisma';
import { createCodeService } from '../src/services/code.service';
import { fixtureEntries } from './support/fixture-repo';
import { makeTarball, toWebStream } from './support/tar';

const { DATABASE_URL, RUN_INTEGRATION } = process.env;

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL)('code browsing (integration)', () => {
  let prisma: PrismaClient;
  let snapshotId = '';
  let userId = '';
  const owner = `code-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    prisma = createPrisma(DATABASE_URL!);
    const repository = await prisma.repository.create({
      data: { owner, name: 'api', defaultBranch: 'main' },
    });
    userId = (
      await prisma.user.create({ data: { email: `${owner}@example.test`, passwordHash: 'x' } })
    ).id;
    await prisma.trackedRepository.create({ data: { userId, repositoryId: repository.id } });
    snapshotId = (
      await prisma.snapshot.create({
        data: { repositoryId: repository.id, commitSha: 'd'.repeat(40), ref: 'main' },
      })
    ).id;
    const github: GitHubClient = {
      getRepository: async () => {
        throw new Error('unused');
      },
      resolveCommit: async () => 'x',
      downloadTarball: async () => toWebStream(makeTarball(fixtureEntries())),
    };
    await createIndexer({
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
    })(snapshotId, { isFinalAttempt: true });
  });

  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { owner } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('lists files without their content', async () => {
    const files = await createCodeService(prisma).listFiles(userId, snapshotId);
    expect(files.map((f) => f.path)).toContain('src/server.ts');
    expect(files[0]).not.toHaveProperty('content');
    expect(files.find((f) => f.path === 'src/server.ts')).toMatchObject({
      kind: 'CODE',
      language: 'typescript',
    });
  });

  it('returns a file with its symbol outline', async () => {
    const { file, symbols } = await createCodeService(prisma).getFile(
      userId,
      snapshotId,
      'src/services/payment.service.ts',
    );
    expect(file.content).toContain('export class PaymentService');
    expect(symbols.map((s) => s.qualifiedName)).toEqual([
      'PaymentService',
      'PaymentService.create',
      'PaymentService.charge',
      'PaymentService.validate',
    ]);
  });

  it('answers 404 for unknown paths and for users who cannot see the snapshot', async () => {
    const code = createCodeService(prisma);
    await expect(code.getFile(userId, snapshotId, 'nope.ts')).rejects.toEqual(
      new AppError(404, 'File not found in this snapshot'),
    );
    await expect(code.listFiles(randomUUID(), snapshotId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
