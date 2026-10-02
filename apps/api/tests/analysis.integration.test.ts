import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GitHubClient } from '../src/github/client';
import { createIndexer } from '../src/indexing/indexer';
import { createCodeParser } from '../src/indexing/parser';
import { createPrisma, type PrismaClient } from '../src/lib/prisma';
import {
  ARCHITECTURE_VERSION,
  createArchitectureService,
} from '../src/services/architecture.service';
import { createCodeService } from '../src/services/code.service';
import { createTraceService } from '../src/services/trace.service';
import { fixtureEntries, fixtureRepo } from './support/fixture-repo';
import { makeTarball, toWebStream } from './support/tar';

const { DATABASE_URL, RUN_INTEGRATION } = process.env;

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL)('analysis (integration)', () => {
  let prisma: PrismaClient;
  const owner = `analysis-${randomUUID().slice(0, 8)}`;
  let snapshotId = '';
  let userId = '';

  const files = {
    ...fixtureRepo,
    'package.json': JSON.stringify({
      name: 'payments-api',
      dependencies: { express: '^5.0.0', stripe: '^14.0.0' },
    }),
    'src/services/stripe.ts': `import Stripe from 'stripe';\nexport const stripe = new Stripe(process.env.STRIPE_KEY);\n`,
    'src/routes/inline.ts': `import { Router } from 'express';
import { PaymentService } from '../services/payment.service';

export const inlineRouter = Router();
inlineRouter.get('/refunds', async (req, res) => {
  const service = PaymentService.create();
  res.json(await service.charge(1));
});
`,
  };

  beforeAll(async () => {
    prisma = createPrisma(DATABASE_URL!);
    const github: GitHubClient = {
      getRepository: async () => {
        throw new Error('unused');
      },
      resolveCommit: async () => 'x',
      downloadTarball: async () => toWebStream(makeTarball(fixtureEntries(files))),
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
      data: { owner, name: 'api', defaultBranch: 'main', trackedBy: { create: { userId } } },
    });
    const snapshot = await prisma.snapshot.create({
      data: { repositoryId: repository.id, commitSha: 'e'.repeat(40), ref: 'main' },
    });
    await index(snapshot.id, { isFinalAttempt: true });
    snapshotId = snapshot.id;
  });

  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { owner } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('builds the architecture map from the stored graph and caches it', async () => {
    const service = createArchitectureService(prisma);
    const map = await service.getArchitecture(userId, snapshotId);

    expect(map.components.map((c) => c.id)).toEqual([
      'src',
      'src/controllers',
      'src/routes',
      'src/services',
    ]);
    expect(map.dependencies.map((d) => `${d.from} → ${d.to}`)).toEqual(
      expect.arrayContaining([
        'src → src/routes',
        'src/routes → src/controllers',
        'src/controllers → src/services',
      ]),
    );
    expect(map.integrations.map((i) => [i.name, i.usedBy.map((u) => u.component)])).toEqual([
      ['Stripe', ['src/services']],
    ]);
    expect(map.envVars.map((e) => e.name)).toEqual(['STRIPE_KEY']);

    const cached = await prisma.snapshotAnalysis.findUnique({
      where: { snapshotId_kind: { snapshotId, kind: 'architecture' } },
    });
    expect(cached?.version).toBe(ARCHITECTURE_VERSION);
    expect(await service.getArchitecture(userId, snapshotId)).toEqual(map);
  });

  it('hides the map from viewers who cannot see the snapshot', async () => {
    await expect(
      createArchitectureService(prisma).getArchitecture(null, snapshotId),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('traces a route through its named handler into the service it calls', async () => {
    const route = await prisma.route.findFirstOrThrow({
      where: { snapshotId, method: 'POST', path: '/payments' },
    });
    const trace = await createTraceService(prisma).trace(userId, snapshotId, route.id);

    expect(trace.nodes.map((n) => [n.label, n.depth])).toEqual([
      ['createPayment', 0],
      ['PaymentService.create', 1],
      // new PaymentService(): the class has no constructor, so its methods aren't walked.
      ['PaymentService', 2],
    ]);
    expect(trace.nodes[2]!.calls).toEqual([]);
    const calls = trace.nodes[0]!.calls.map((c) => [c.callee, c.resolved]);
    expect(calls).toEqual(
      expect.arrayContaining([
        ['PaymentService.create', true],
        // A method on a local variable: listed, not followed.
        ['service.charge', false],
      ]),
    );
  });

  it('traces an inline handler without counting the route registration', async () => {
    const route = await prisma.route.findFirstOrThrow({
      where: { snapshotId, path: '/refunds' },
    });
    const trace = await createTraceService(prisma).trace(userId, snapshotId, route.id);
    expect(trace.nodes[0]).toMatchObject({ id: 'handler', kind: 'inline handler' });
    expect(trace.nodes[0]!.calls.map((c) => c.callee)).not.toContain('inlineRouter.get');
    expect(trace.nodes.map((n) => n.label)).toContain('PaymentService.create');
  });

  it('returns 404 for a route from another snapshot or a malformed id', async () => {
    const service = createTraceService(prisma);
    await expect(service.trace(userId, snapshotId, randomUUID())).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(service.trace(userId, snapshotId, 'nope')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('names callers inside inline route handlers by their route', async () => {
    const refs = await createCodeService(prisma).getReferences(
      userId,
      snapshotId,
      'src/services/payment.service.ts',
      3,
    );
    expect(refs.callers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: null,
          route: expect.objectContaining({ method: 'GET', path: '/refunds' }),
          path: 'src/routes/inline.ts',
        }),
      ]),
    );
  });
});
