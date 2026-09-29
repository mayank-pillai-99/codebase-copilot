import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GitHubClient } from '../src/github/client';
import { createIndexer, IndexingError, type Indexer } from '../src/indexing/indexer';
import { createCodeParser } from '../src/indexing/parser';
import type { ExtractLimits } from '../src/indexing/tarball';
import { AppError } from '../src/lib/errors';
import { createPrisma, type PrismaClient } from '../src/lib/prisma';
import { fixtureEntries } from './support/fixture-repo';
import { makeTarball, toWebStream } from './support/tar';

const { DATABASE_URL, RUN_INTEGRATION } = process.env;

const limits: ExtractLimits = {
  maxArchiveBytes: 10 * 1024 * 1024,
  maxFileBytes: 200 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxCodeFiles: 100,
};
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const SHA = 'c0ffee'.padEnd(40, '0');

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL)('indexer (integration)', () => {
  let prisma: PrismaClient;
  const owner = `test-${randomUUID().slice(0, 8)}`;

  beforeAll(() => {
    prisma = createPrisma(DATABASE_URL!);
  });
  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { owner } });
    await prisma.$disconnect();
  });

  async function newSnapshot() {
    const repository = await prisma.repository.create({
      data: { owner, name: `repo-${randomUUID().slice(0, 8)}`, defaultBranch: 'main' },
    });
    return prisma.snapshot.create({
      data: { repositoryId: repository.id, commitSha: SHA, ref: 'main' },
    });
  }

  function indexerWith(
    downloadTarball: GitHubClient['downloadTarball'],
    overrides: Partial<ExtractLimits> = {},
  ): Indexer {
    const github: GitHubClient = {
      getRepository: async () => {
        throw new Error('not used');
      },
      resolveCommit: async () => SHA,
      downloadTarball,
    };
    return createIndexer({
      prisma,
      github,
      getParser: createCodeParser,
      limits: { ...limits, ...overrides },
      logger: silent,
    });
  }

  const fixtureIndexer = (overrides?: Partial<ExtractLimits>) =>
    indexerWith(async () => toWebStream(makeTarball(fixtureEntries())), overrides);

  it('indexes a repository into files, symbols, edges and routes', async () => {
    const snapshot = await newSnapshot();
    await fixtureIndexer()(snapshot.id, { isFinalAttempt: true });

    const saved = await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect(saved).toMatchObject({ status: 'READY', failureReason: null, progress: null });
    expect(saved.readyAt).toBeInstanceOf(Date);
    expect(saved.stats).toMatchObject({
      files: { total: 7, code: 4, docs: 1, config: 2 },
      filesWithParseErrors: 0,
      routes: 3,
      skipped: { 'ignored-directory': 2, lockfile: 1, 'unsupported-type': 1 },
    });

    const files = await prisma.file.findMany({
      where: { snapshotId: snapshot.id },
      orderBy: { path: 'asc' },
    });
    expect(files.map((f) => f.path)).toEqual([
      'package.json',
      'README.md',
      'src/controllers/payments.controller.ts',
      'src/routes/payments.ts',
      'src/server.ts',
      'src/services/payment.service.ts',
      'tsconfig.json',
    ]);
    expect(files.find((f) => f.path === 'src/server.ts')?.content).toContain('app.listen(3000)');

    // The @/ alias from tsconfig resolves to a file in the repo.
    const aliasImport = await prisma.importEdge.findFirstOrThrow({
      where: { snapshotId: snapshot.id, specifier: '@/routes/payments' },
      include: { toFile: true },
    });
    expect(aliasImport.toFile?.path).toBe('src/routes/payments.ts');

    const routes = await prisma.route.findMany({
      where: { snapshotId: snapshot.id },
      include: { handlerSymbol: { include: { file: true } } },
      orderBy: [{ path: 'asc' }, { method: 'asc' }],
    });
    expect(
      routes.map(
        (r) =>
          `${r.method} ${r.path} → ${r.handlerSymbol ? `${r.handlerSymbol.file.path}:${r.handlerSymbol.qualifiedName}` : (r.handlerName ?? 'inline')}`,
      ),
    ).toEqual([
      'GET /health → inline',
      'GET /payments → src/controllers/payments.controller.ts:listPayments',
      'POST /payments → src/controllers/payments.controller.ts:createPayment',
    ]);

    // Controller → static service method, and the method's this.validate() call.
    const resolved = await prisma.callEdge.findMany({
      where: { snapshotId: snapshot.id, resolved: true },
      include: { fromSymbol: true, toSymbol: true },
    });
    expect(
      resolved.map((c) => `${c.fromSymbol?.qualifiedName} → ${c.toSymbol?.qualifiedName}`).sort(),
    ).toEqual([
      'PaymentService.charge → PaymentService.validate',
      'PaymentService.create → PaymentService',
      'createPayment → PaymentService.create',
    ]);
  });

  it('can be re-run on the same snapshot without duplicating rows', async () => {
    const snapshot = await newSnapshot();
    const index = fixtureIndexer();
    await index(snapshot.id, { isFinalAttempt: true });
    await index(snapshot.id, { isFinalAttempt: true });
    expect(await prisma.file.count({ where: { snapshotId: snapshot.id } })).toBe(7);
    expect(await prisma.route.count({ where: { snapshotId: snapshot.id } })).toBe(3);
  });

  it('fails with a readable reason when a limit is exceeded, and keeps no partial data', async () => {
    const snapshot = await newSnapshot();
    await expect(
      fixtureIndexer({ maxCodeFiles: 2 })(snapshot.id, { isFinalAttempt: false }),
    ).rejects.toBeInstanceOf(IndexingError);
    const saved = await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect(saved).toMatchObject({
      status: 'FAILED',
      failureReason: 'Repository has more than 2 source files, the current limit.',
    });
    expect(await prisma.file.count({ where: { snapshotId: snapshot.id } })).toBe(0);
  });

  it('fails without retrying when GitHub says the repository is gone', async () => {
    const snapshot = await newSnapshot();
    const index = indexerWith(async () => {
      throw new AppError(
        404,
        'Repository not found. Only public GitHub repositories are supported.',
      );
    });
    await expect(index(snapshot.id, { isFinalAttempt: false })).rejects.toBeInstanceOf(
      IndexingError,
    );
    expect(
      (await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).failureReason,
    ).toMatch(/Only public GitHub repositories/);
  });

  it('rejects repositories without TypeScript or JavaScript', async () => {
    const snapshot = await newSnapshot();
    const index = indexerWith(async () =>
      toWebStream(makeTarball([{ path: 'main.py', content: 'print(1)' }])),
    );
    await expect(index(snapshot.id, { isFinalAttempt: true })).rejects.toThrow(
      /No TypeScript or JavaScript/,
    );
  });

  it('marks transient failures as retrying until the final attempt', async () => {
    const snapshot = await newSnapshot();
    const index = indexerWith(async () => {
      throw new Error('socket hang up');
    });

    await expect(index(snapshot.id, { isFinalAttempt: false })).rejects.toThrow('socket hang up');
    expect(await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).toMatchObject({
      status: 'QUEUED',
      progress: { stage: 'retrying' },
    });

    await expect(index(snapshot.id, { isFinalAttempt: true })).rejects.toThrow('socket hang up');
    expect(await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).toMatchObject({
      status: 'FAILED',
      failureReason: 'Indexing failed because of an unexpected error. Please try again.',
    });
  });
});
