import {
  parseGitHubUrl,
  snapshotProgressSchema,
  snapshotStatsSchema,
  type RepositorySummary,
  type RouteSummary,
  type SnapshotDto,
} from '@codebase-copilot/shared';
import type { GitHubClient } from '../github/client';
import { AppError } from '../lib/errors';
import type { PrismaClient } from '../lib/prisma';
import type { DailyQuota } from '../lib/quota';
import type { IndexingQueue } from '../queue/indexing-queue';
import {
  demoRepositoryFilter,
  findVisibleSnapshot,
  snapshotInclude,
  type DemoRepositories,
} from './snapshot-access';

export interface RepositoryService {
  /** Resolves the URL to a commit and queues indexing unless that commit is already indexed. */
  addRepository(userId: string, url: string): Promise<SnapshotDto>;
  listRepositories(userId: string): Promise<RepositorySummary[]>;
  /** viewerId is null for anonymous visitors (demo repositories only). */
  getSnapshot(viewerId: string | null, snapshotId: string): Promise<SnapshotDto>;
  listRoutes(viewerId: string | null, snapshotId: string): Promise<RouteSummary[]>;
  /** Demo repositories with their latest READY snapshot, for the landing page. */
  listDemo(): Promise<RepositorySummary[]>;
  /** Makes sure every demo repository has a snapshot, queuing indexing where needed. */
  seedDemo(): Promise<void>;
}

type SnapshotRow = {
  id: string;
  commitSha: string;
  ref: string;
  status: SnapshotDto['status'];
  failureReason: string | null;
  progress: unknown;
  stats: unknown;
  createdAt: Date;
  readyAt: Date | null;
  repository: { id: string; owner: string; name: string };
};

export function createRepositoryService(deps: {
  prisma: PrismaClient;
  github: GitHubClient;
  queue: IndexingQueue;
  /** How long to wait for Redis before telling the user to try again. */
  enqueueTimeoutMs?: number;
  demo?: DemoRepositories;
  /** New indexing jobs per user per day, protecting the free database; unlimited when omitted. */
  dailyIndexing?: { quota: DailyQuota; limit: number };
}): RepositoryService {
  const { prisma, github, queue, enqueueTimeoutMs = 5_000, demo = [], dailyIndexing } = deps;
  const findVisible = (viewerId: string | null, snapshotId: string) =>
    findVisibleSnapshot(prisma, viewerId, snapshotId, demo);

  async function enqueue(snapshotId: string) {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        queue.enqueue(snapshotId),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('enqueue timed out')), enqueueTimeoutMs);
        }),
      ]);
    } catch {
      // The snapshot stays QUEUED; submitting the URL again re-queues it.
      throw new AppError(503, 'Indexing is unavailable right now. Please try again in a minute.');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async addRepository(userId, url) {
      const parsed = parseGitHubUrl(url);
      if (!parsed) throw new AppError(400, 'Enter a public GitHub repository URL');

      const meta = await github.getRepository(parsed.owner, parsed.repo);
      if (meta.isPrivate) {
        throw new AppError(
          404,
          'Repository not found. Only public GitHub repositories are supported.',
        );
      }
      const ref = parsed.ref ?? meta.defaultBranch;
      const commitSha = await github.resolveCommit(meta.owner, meta.name, ref);

      // Only work that indexes something counts: a new commit, or a retry of a failed one.
      if (dailyIndexing) {
        const existing = await prisma.snapshot.findFirst({
          where: { commitSha, repository: { owner: meta.owner, name: meta.name } },
          select: { status: true },
        });
        if (
          (!existing || existing.status === 'FAILED') &&
          !(await dailyIndexing.quota.consume(userId))
        ) {
          throw new AppError(
            429,
            `You can index up to ${dailyIndexing.limit} new commits a day. Try again tomorrow.`,
          );
        }
      }

      const repository = await prisma.repository.upsert({
        where: { owner_name: { owner: meta.owner, name: meta.name } },
        create: { owner: meta.owner, name: meta.name, defaultBranch: meta.defaultBranch },
        update: { defaultBranch: meta.defaultBranch },
      });
      await prisma.trackedRepository.upsert({
        where: { userId_repositoryId: { userId, repositoryId: repository.id } },
        create: { userId, repositoryId: repository.id },
        update: {},
      });

      // Commits are immutable, so one snapshot per commit is shared by everyone.
      let snapshot = await prisma.snapshot.upsert({
        where: { repositoryId_commitSha: { repositoryId: repository.id, commitSha } },
        create: { repositoryId: repository.id, commitSha, ref },
        update: {},
        include: snapshotInclude,
      });

      if (snapshot.status === 'FAILED') {
        snapshot = await prisma.snapshot.update({
          where: { id: snapshot.id },
          data: { status: 'QUEUED', failureReason: null },
          include: snapshotInclude,
        });
      }
      if (snapshot.status === 'QUEUED') await enqueue(snapshot.id);
      return toSnapshotDto(snapshot);
    },

    async listRepositories(userId) {
      const tracked = await prisma.trackedRepository.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          repository: {
            include: {
              snapshots: { orderBy: { createdAt: 'desc' }, take: 1, include: snapshotInclude },
            },
          },
        },
      });
      return tracked.map(({ repository }) => ({
        id: repository.id,
        owner: repository.owner,
        name: repository.name,
        defaultBranch: repository.defaultBranch,
        latestSnapshot: repository.snapshots[0] ? toSnapshotDto(repository.snapshots[0]) : null,
      }));
    },

    async getSnapshot(viewerId, snapshotId) {
      return toSnapshotDto(await findVisible(viewerId, snapshotId));
    },

    async listDemo() {
      if (demo.length === 0) return [];
      const repositories = await prisma.repository.findMany({
        where: { OR: demoRepositoryFilter(demo) },
        include: {
          snapshots: {
            where: { status: 'READY' },
            orderBy: { readyAt: 'desc' },
            take: 1,
            include: snapshotInclude,
          },
        },
      });
      return repositories
        .filter((r) => r.snapshots.length > 0)
        .map((r) => ({
          id: r.id,
          owner: r.owner,
          name: r.name,
          defaultBranch: r.defaultBranch,
          latestSnapshot: toSnapshotDto(r.snapshots[0]!),
        }));
    },

    async seedDemo() {
      for (const { owner, name } of demo) {
        const existing = await prisma.repository.findFirst({
          where: { OR: demoRepositoryFilter([{ owner, name }]) },
          include: { snapshots: { where: { status: { not: 'FAILED' } } } },
        });
        const snapshots = existing?.snapshots ?? [];
        // Demo content stays pinned once indexed.
        if (snapshots.some((s) => s.status === 'READY')) continue;
        const unfinished = snapshots[0];
        if (unfinished) {
          // Its job may never have been queued (Redis was down) or may have been lost.
          // enqueue() is deduplicated by snapshot id, so this is safe if it is running.
          await queue.enqueue(unfinished.id);
          continue;
        }

        const meta = await github.getRepository(owner, name);
        const commitSha = await github.resolveCommit(meta.owner, meta.name, meta.defaultBranch);
        const repository = await prisma.repository.upsert({
          where: { owner_name: { owner: meta.owner, name: meta.name } },
          create: { owner: meta.owner, name: meta.name, defaultBranch: meta.defaultBranch },
          update: {},
        });
        const snapshot = await prisma.snapshot.upsert({
          where: { repositoryId_commitSha: { repositoryId: repository.id, commitSha } },
          create: { repositoryId: repository.id, commitSha, ref: meta.defaultBranch },
          update: { status: 'QUEUED', failureReason: null },
        });
        await queue.enqueue(snapshot.id);
      }
    },

    async listRoutes(viewerId, snapshotId) {
      await findVisible(viewerId, snapshotId);
      const routes = await prisma.route.findMany({
        where: { snapshotId },
        orderBy: [{ path: 'asc' }, { method: 'asc' }],
        include: {
          file: { select: { path: true } },
          handlerSymbol: {
            select: {
              qualifiedName: true,
              startLine: true,
              endLine: true,
              file: { select: { path: true } },
            },
          },
        },
      });
      return routes.map((r) => ({
        id: r.id,
        method: r.method,
        path: r.path,
        framework: r.framework,
        handlerName: r.handlerName,
        file: { path: r.file.path, startLine: r.startLine, endLine: r.endLine },
        handler: r.handlerSymbol
          ? {
              qualifiedName: r.handlerSymbol.qualifiedName,
              path: r.handlerSymbol.file.path,
              startLine: r.handlerSymbol.startLine,
              endLine: r.handlerSymbol.endLine,
            }
          : null,
      }));
    },
  };
}

function toSnapshotDto(row: SnapshotRow): SnapshotDto {
  // JSON columns are validated on the way out so the API contract can't drift silently.
  const progress = snapshotProgressSchema.safeParse(row.progress);
  const stats = snapshotStatsSchema.safeParse(row.stats);
  return {
    id: row.id,
    repository: row.repository,
    commitSha: row.commitSha,
    ref: row.ref,
    status: row.status,
    failureReason: row.failureReason,
    progress: progress.success ? progress.data : null,
    stats: stats.success ? stats.data : null,
    createdAt: row.createdAt.toISOString(),
    readyAt: row.readyAt?.toISOString() ?? null,
  };
}
