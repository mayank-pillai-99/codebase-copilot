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

  describe('references', () => {
    const refs = (path: string, line: number) =>
      createCodeService(prisma).getReferences(userId, snapshotId, path, line);
    const controller = 'src/controllers/payments.controller.ts';
    const service = 'src/services/payment.service.ts';

    it('shows what a route handler calls and the route it handles', async () => {
      const r = await refs(controller, 5);
      expect(r.symbol).toMatchObject({ qualifiedName: 'createPayment', kind: 'function' });
      expect(r.routes.map((x) => `${x.method} ${x.path}`)).toEqual(['POST /payments']);
      expect(r.callees.map((c) => [c.callee, c.resolved, c.target?.path ?? null])).toEqual(
        expect.arrayContaining([
          ['PaymentService.create', true, service],
          // A method on a local variable can't be resolved by name.
          ['service.charge', false, null],
        ]),
      );
    });

    it('shows who calls a method', async () => {
      const r = await refs(service, 3);
      expect(r.symbol?.qualifiedName).toBe('PaymentService.create');
      expect(r.callers).toEqual([
        {
          from: expect.objectContaining({ label: 'createPayment', path: controller }),
          route: null,
          path: controller,
          line: 5,
        },
      ]);
    });

    it('follows this.method() calls', async () => {
      const r = await refs(service, 7);
      expect(r.symbol?.qualifiedName).toBe('PaymentService.charge');
      expect(r.callees.find((c) => c.callee === 'this.validate')?.target?.label).toBe(
        'PaymentService.validate',
      );
    });

    it("lists constructions of a class but not its methods' calls", async () => {
      const r = await refs(service, 1);
      expect(r.symbol).toMatchObject({ qualifiedName: 'PaymentService', kind: 'class' });
      expect(r.callees).toEqual([]);
      expect(r.callers.map((c) => c.from?.label)).toContain('PaymentService.create');
    });

    it('returns no symbol outside any function, and 404 for unknown files or viewers', async () => {
      expect((await refs(controller, 2)).symbol).toBeNull();
      await expect(refs('nope.ts', 1)).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        createCodeService(prisma).getReferences(null, snapshotId, controller, 5),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('impact', () => {
    const impact = (path: string, line: number) =>
      createCodeService(prisma).getImpact(userId, snapshotId, path, line);
    const controller = 'src/controllers/payments.controller.ts';
    const service = 'src/services/payment.service.ts';

    it('walks callers back to the routes that reach a method', async () => {
      const r = await impact(service, 3);
      expect(r.symbol?.qualifiedName).toBe('PaymentService.create');
      expect(r.dependents.map((d) => [d.label, d.depth])).toEqual([['createPayment', 1]]);
      expect(r.routes).toEqual([
        expect.objectContaining({
          method: 'POST',
          path: '/payments',
          depth: 1,
          chain: [
            expect.objectContaining({ label: 'createPayment', path: controller, callLine: 5 }),
            expect.objectContaining({ label: 'PaymentService.create', callLine: null }),
          ],
        }),
      ]);
      expect(r).toMatchObject({ tests: [], hasTests: false, truncated: false });
    });

    it('counts callers of any method when the target is a class', async () => {
      const r = await impact(service, 1);
      expect(r.symbol?.kind).toBe('class');
      expect(r.dependents.map((d) => d.label)).toEqual(['createPayment']);
      expect(r.routes.map((x) => `${x.method} ${x.path}`)).toEqual(['POST /payments']);
    });

    it('returns no symbol outside any function, and 404 for unknown files or viewers', async () => {
      expect((await impact(controller, 2)).symbol).toBeNull();
      await expect(impact('nope.ts', 1)).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        createCodeService(prisma).getImpact(null, snapshotId, controller, 5),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
