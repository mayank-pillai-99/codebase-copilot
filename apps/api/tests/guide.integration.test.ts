import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PromptMessage } from '../src/chat/prompt';
import type { GitHubClient } from '../src/github/client';
import { createIndexer } from '../src/indexing/indexer';
import { createCodeParser } from '../src/indexing/parser';
import { createPrisma, type PrismaClient } from '../src/lib/prisma';
import type { ChatModel } from '../src/llm/chat-model';
import { createArchitectureService } from '../src/services/architecture.service';
import { createGuideService } from '../src/services/guide.service';
import { fixtureEntries, fixtureRepo } from './support/fixture-repo';
import { makeTarball, toWebStream } from './support/tar';

const { DATABASE_URL, RUN_INTEGRATION } = process.env;

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL)('onboarding guide (integration)', () => {
  let prisma: PrismaClient;
  const owner = `guide-${randomUUID().slice(0, 8)}`;
  let snapshotId = '';
  let userId = '';

  const files = {
    ...fixtureRepo,
    'package.json': JSON.stringify({
      name: 'payments-api',
      description: 'Charges customers over HTTP.',
      main: 'src/server.ts',
      dependencies: { express: '^5.0.0' },
      devDependencies: { typescript: '^5', vitest: '^3' },
    }),
    'CHANGELOG.md': '# Changelog\n\nNot the readme.',
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
      data: { repositoryId: repository.id, commitSha: 'd'.repeat(40), ref: 'main' },
    });
    await index(snapshot.id, { isFinalAttempt: true });
    snapshotId = snapshot.id;
  });

  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { owner } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const service = (model: ChatModel | null) =>
    createGuideService({ prisma, architecture: createArchitectureService(prisma), model });

  function scripted(reply: string | Error) {
    const calls: PromptMessage[][] = [];
    const model: ChatModel = {
      model: 'scripted',
      async *stream(messages) {
        calls.push(messages);
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (reply instanceof Error) throw reply;
        yield reply;
      },
    };
    return { model, calls };
  }

  it('builds the guide from the stored graph and caches it', async () => {
    const guide = await service(null).getGuide(userId, snapshotId);

    expect(guide.description).toBe('Charges customers over HTTP.');
    expect(guide.stack.map((s) => s.name)).toEqual(['TypeScript', 'Express', 'Vitest']);
    expect(guide.startHere[0]).toEqual({
      path: 'src/server.ts',
      reasons: ['entry point declared in package.json', 'defines 1 route'],
    });
    expect(guide.keyFlows[0]).toMatchObject({
      method: 'POST',
      path: '/payments',
      handler: { label: 'createPayment', path: 'src/controllers/payments.controller.ts' },
    });
    expect(guide.components.map((c) => c.id)).toContain('src/services');

    const row = await prisma.snapshotAnalysis.findUnique({
      where: { snapshotId_kind: { snapshotId, kind: 'guide' } },
    });
    expect(row?.data).toEqual(guide);
  });

  it('explains when no AI is configured', async () => {
    expect(await service(null).getSummary(userId, snapshotId)).toEqual({
      summary: null,
      reason: 'AI summaries are not configured on this server.',
    });
  });

  it('does not cache a failed summary', async () => {
    const { model } = scripted(new Error('overloaded'));
    const result = await service(model).getSummary(userId, snapshotId);
    expect(result.summary).toBeNull();
    expect(result.reason).toMatch(/unavailable/);
    const row = await prisma.snapshotAnalysis.findUnique({
      where: { snapshotId_kind: { snapshotId, kind: 'guide-summary' } },
    });
    expect(row).toBeNull();
  });

  it('writes the summary once from the README and facts, then serves it from cache', async () => {
    const { model, calls } = scripted('A **payments** API\nbuilt with Express. ');
    const guides = service(model);
    const [a, b] = await Promise.all([
      guides.getSummary(userId, snapshotId),
      guides.getSummary(userId, snapshotId),
    ]);
    expect(calls).toHaveLength(1);
    expect(a.summary?.text).toBe('A payments API built with Express.');
    expect(b).toEqual(a);

    const prompt = calls[0]!.map((m) => m.content).join('\n');
    expect(prompt).toContain('# Payments API');
    expect(prompt).not.toContain('Not the readme');
    expect(prompt).toContain('Tech stack: TypeScript, Express, Vitest');

    const again = scripted('different');
    expect(await service(again.model).getSummary(userId, snapshotId)).toEqual(a);
    expect(again.calls).toHaveLength(0);
  });

  it('hides the guide from viewers who cannot see the snapshot', async () => {
    await expect(service(null).getGuide(null, snapshotId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
