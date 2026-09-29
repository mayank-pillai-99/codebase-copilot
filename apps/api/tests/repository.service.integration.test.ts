import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GitHubClient } from '../src/github/client';
import { createIndexer } from '../src/indexing/indexer';
import { createCodeParser } from '../src/indexing/parser';
import { AppError } from '../src/lib/errors';
import { createPrisma, type PrismaClient } from '../src/lib/prisma';
import type { IndexingQueue } from '../src/queue/indexing-queue';
import { createRepositoryService } from '../src/services/repository.service';
import { fixtureEntries } from './support/fixture-repo';
import { makeTarball, toWebStream } from './support/tar';

const { DATABASE_URL, RUN_INTEGRATION } = process.env;
const SHA = 'b'.repeat(40);

describe.runIf(RUN_INTEGRATION === '1' && DATABASE_URL)('repository service (integration)', () => {
  let prisma: PrismaClient;
  const owner = `svc-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];

  beforeAll(() => {
    prisma = createPrisma(DATABASE_URL!);
  });
  afterAll(async () => {
    await prisma.repository.deleteMany({ where: { owner } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function newUser() {
    const user = await prisma.user.create({
      data: { email: `svc-${randomUUID()}@example.test`, passwordHash: 'x' },
    });
    userIds.push(user.id);
    return user.id;
  }

  function github(overrides: Partial<GitHubClient> = {}): GitHubClient {
    return {
      // GitHub reports the canonical casing, which is what gets stored.
      getRepository: async (_o, repo) => ({
        owner,
        name: repo.toLowerCase(),
        defaultBranch: 'main',
        isPrivate: false,
        sizeKb: 10,
      }),
      resolveCommit: async () => SHA,
      downloadTarball: async () => toWebStream(makeTarball(fixtureEntries())),
      ...overrides,
    };
  }

  function setup(
    gh = github(),
    queue: IndexingQueue = { enqueue: vi.fn(async () => undefined), close: async () => undefined },
  ) {
    return {
      queue,
      service: createRepositoryService({ prisma, github: gh, queue, enqueueTimeoutMs: 100 }),
    };
  }

  it('creates the repository, tracks it for the user and queues one snapshot per commit', async () => {
    const { service, queue } = setup();
    const [alice, bob] = [await newUser(), await newUser()];
    const repo = `Shared-${randomUUID().slice(0, 6)}`;

    const first = await service.addRepository(alice, `https://github.com/${owner}/${repo}`);
    expect(first).toMatchObject({
      status: 'QUEUED',
      commitSha: SHA,
      ref: 'main',
      repository: { owner, name: repo.toLowerCase() },
    });
    expect(queue.enqueue).toHaveBeenCalledWith(first.id);

    // Same commit from another user: same snapshot, now visible to both.
    const second = await service.addRepository(bob, `${owner}/${repo}`);
    expect(second.id).toBe(first.id);
    await expect(service.getSnapshot(bob, first.id)).resolves.toMatchObject({ id: first.id });
    expect((await service.listRepositories(alice))[0]?.latestSnapshot?.id).toBe(first.id);
  });

  it('uses the ref from /tree URLs', async () => {
    const resolveCommit = vi.fn(async () => SHA);
    const { service } = setup(github({ resolveCommit }));
    const snapshot = await service.addRepository(
      await newUser(),
      `https://github.com/${owner}/ref-test/tree/release/v2`,
    );
    expect(resolveCommit).toHaveBeenCalledWith(owner, 'ref-test', 'release/v2');
    expect(snapshot.ref).toBe('release/v2');
  });

  it('does not re-index a READY commit, and re-queues a FAILED one', async () => {
    const { service, queue } = setup();
    const user = await newUser();
    const url = `${owner}/states-${randomUUID().slice(0, 6)}`;
    const created = await service.addRepository(user, url);

    await prisma.snapshot.update({ where: { id: created.id }, data: { status: 'READY' } });
    vi.mocked(queue.enqueue).mockClear();
    expect((await service.addRepository(user, url)).status).toBe('READY');
    expect(queue.enqueue).not.toHaveBeenCalled();

    await prisma.snapshot.update({
      where: { id: created.id },
      data: { status: 'FAILED', failureReason: 'boom' },
    });
    const retried = await service.addRepository(user, url);
    expect(retried).toMatchObject({ status: 'QUEUED', failureReason: null });
    expect(queue.enqueue).toHaveBeenCalledWith(created.id);
  });

  it('hides snapshots from users who do not track the repository', async () => {
    const { service } = setup();
    const created = await service.addRepository(
      await newUser(),
      `${owner}/private-${randomUUID().slice(0, 6)}`,
    );
    const stranger = await newUser();

    await expect(service.getSnapshot(stranger, created.id)).rejects.toEqual(
      new AppError(404, 'Not found'),
    );
    await expect(service.listRoutes(stranger, created.id)).rejects.toEqual(
      new AppError(404, 'Not found'),
    );
    await expect(service.getSnapshot(stranger, 'not-a-uuid')).rejects.toEqual(
      new AppError(404, 'Not found'),
    );
  });

  it('refuses private repositories', async () => {
    const { service } = setup(
      github({
        getRepository: async () => ({
          owner,
          name: 'secret',
          defaultBranch: 'main',
          isPrivate: true,
          sizeKb: 1,
        }),
      }),
    );
    await expect(service.addRepository(await newUser(), `${owner}/secret`)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('reports 503 when the queue does not answer, leaving the snapshot QUEUED', async () => {
    const { service } = setup(github(), {
      enqueue: () => new Promise(() => undefined),
      close: async () => undefined,
    });
    await expect(
      service.addRepository(await newUser(), `${owner}/slow-${randomUUID().slice(0, 6)}`),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it('lists routes with their resolved handlers after indexing', async () => {
    const gh = github();
    const { service } = setup(gh);
    const user = await newUser();
    const created = await service.addRepository(
      user,
      `${owner}/indexed-${randomUUID().slice(0, 6)}`,
    );

    const index = createIndexer({
      prisma,
      github: gh,
      getParser: createCodeParser,
      embedder: null,
      limits: {
        maxArchiveBytes: 1e7,
        maxFileBytes: 2e5,
        maxTotalBytes: 1e7,
        maxCodeFiles: 100,
        maxChunks: 1_000,
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    await index(created.id, { isFinalAttempt: true });

    const snapshot = await service.getSnapshot(user, created.id);
    expect(snapshot.status).toBe('READY');
    expect(snapshot.stats).toMatchObject({ routes: 3, calls: { resolved: 3 } });

    const routes = await service.listRoutes(user, created.id);
    expect(routes.find((r) => r.method === 'POST')).toMatchObject({
      path: '/payments',
      file: { path: 'src/routes/payments.ts', startLine: 5 },
      handler: {
        qualifiedName: 'createPayment',
        path: 'src/controllers/payments.controller.ts',
        startLine: 4, // the line after its JSDoc comment
      },
    });
  });
});
