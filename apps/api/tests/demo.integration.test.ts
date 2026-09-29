import { randomUUID } from 'node:crypto';
import type { ChatEvent } from '@codebase-copilot/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createChatService } from '../src/chat/chat.service';
import type { GitHubClient } from '../src/github/client';
import { createIndexer } from '../src/indexing/indexer';
import { createCodeParser } from '../src/indexing/parser';
import { createPrisma, type PrismaClient } from '../src/lib/prisma';
import type { ChatModel } from '../src/llm/chat-model';
import { createFullTextRetriever } from '../src/retrieval/fulltext';
import { createCodeService } from '../src/services/code.service';
import { createRepositoryService } from '../src/services/repository.service';
import { parseDemoRepositories } from '../src/services/snapshot-access';
import { fixtureEntries } from './support/fixture-repo';
import { makeTarball, toWebStream } from './support/tar';

const { DATABASE_URL, RUN_INTEGRATION } = process.env;
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const echoModel: ChatModel = {
  model: 'echo',
  async *stream() {
    yield 'See [1].';
  },
};

describe('parseDemoRepositories', () => {
  it('reads owner/name pairs and ignores malformed entries', () => {
    expect(parseDemoRepositories(' expressjs/express, honojs/examples ,bad, a/b/c,')).toEqual([
      { owner: 'expressjs', name: 'express' },
      { owner: 'honojs', name: 'examples' },
    ]);
    expect(parseDemoRepositories(undefined)).toEqual([]);
  });
});

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL)('demo mode (integration)', () => {
  let prisma: PrismaClient;
  const owner = `demo-${randomUUID().slice(0, 8)}`;
  // GitHub casing differs from the configured list on purpose.
  const demo = parseDemoRepositories(`${owner.toUpperCase()}/Showcase`);
  const enqueue = vi.fn(async (_snapshotId: string) => undefined);
  const github: GitHubClient = {
    getRepository: async (_o, name) => ({
      owner,
      name: name.toLowerCase(),
      defaultBranch: 'main',
      isPrivate: false,
      sizeKb: 1,
    }),
    resolveCommit: async () => 'a'.repeat(40),
    downloadTarball: async () => toWebStream(makeTarball(fixtureEntries())),
  };

  beforeAll(() => {
    prisma = createPrisma(DATABASE_URL!);
  });
  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { owner } });
    await prisma.$disconnect();
  });

  const repositories = () =>
    createRepositoryService({
      prisma,
      github,
      queue: { enqueue, close: async () => undefined },
      demo,
    });

  it('seeds a snapshot once per demo repository and lists it only when READY', async () => {
    const service = repositories();
    await service.seedDemo();
    await service.seedDemo();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(await service.listDemo()).toEqual([]);

    const snapshotId = enqueue.mock.calls[0]![0];
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
      logger: silent,
    })(snapshotId, { isFinalAttempt: true });

    const listed = await service.listDemo();
    expect(listed.map((r) => [r.owner, r.name, r.latestSnapshot?.id])).toEqual([
      [owner, 'showcase', snapshotId],
    ]);
  });

  it('lets anyone read and chat about demo snapshots, anonymously too', async () => {
    const [demoRepo] = await repositories().listDemo();
    const snapshotId = demoRepo!.latestSnapshot!.id;

    await expect(repositories().getSnapshot(null, snapshotId)).resolves.toMatchObject({
      id: snapshotId,
    });
    await expect(repositories().getSnapshot(randomUUID(), snapshotId)).resolves.toMatchObject({
      id: snapshotId,
    });
    const code = createCodeService(prisma, demo);
    expect((await code.listFiles(null, snapshotId)).length).toBeGreaterThan(0);

    const chat = createChatService({
      prisma,
      retriever: createFullTextRetriever(prisma),
      model: echoModel,
      logger: silent,
      demo,
    });
    const prepared = await chat.prepare({
      userId: null,
      snapshotId,
      message: 'How is a payment created?',
    });
    const events: ChatEvent[] = [];
    await chat.answer(prepared, (e) => events.push(e), new AbortController().signal);
    expect(events.at(-1)).toMatchObject({ type: 'done', content: 'See [1].' });

    // Anonymous conversations have no owner, can't be listed, and reopen by id only.
    expect(await chat.listSessions(null, snapshotId)).toEqual([]);
    const reopened = await chat.getSession(null, prepared.sessionId);
    expect(reopened.messages).toHaveLength(2);
    await expect(chat.getSession(randomUUID(), prepared.sessionId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('keeps non-demo snapshots private', async () => {
    const service = repositories();
    const repository = await prisma.repository.create({
      data: { owner, name: 'private-one', defaultBranch: 'main' },
    });
    const snapshot = await prisma.snapshot.create({
      data: {
        repositoryId: repository.id,
        commitSha: 'b'.repeat(40),
        ref: 'main',
        status: 'READY',
      },
    });
    await expect(service.getSnapshot(null, snapshot.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      createCodeService(prisma, demo).listFiles(null, snapshot.id),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    const chat = createChatService({
      prisma,
      retriever: createFullTextRetriever(prisma),
      model: echoModel,
      logger: silent,
      demo,
    });
    await expect(
      chat.prepare({ userId: null, snapshotId: snapshot.id, message: 'hi' }),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
