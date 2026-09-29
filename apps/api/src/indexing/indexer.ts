import type { FastifyBaseLogger } from 'fastify';
import type { GitHubClient } from '../github/client';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../lib/errors';
import type { PrismaClient } from '../lib/prisma';
import { buildCodeGraph, type CodeGraph } from './graph';
import type { CodeParser } from './parser';
import { saveCodeGraph } from './persist';
import {
  extractTarball,
  LimitExceededError,
  type ExtractLimits,
  type ExtractResult,
} from './tarball';

export type IndexingStage = 'fetching' | 'parsing' | 'saving' | 'embedding' | 'retrying';

export interface SnapshotProgress {
  stage: IndexingStage;
  processed?: number;
  total?: number;
}

/** A failure the user can understand and act on; retrying won't help. */
export class IndexingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexingError';
  }
}

export interface IndexerDeps {
  prisma: PrismaClient;
  github: GitHubClient;
  getParser: () => Promise<CodeParser>;
  limits: ExtractLimits;
  logger: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
}

export interface IndexOptions {
  /** False while the queue will retry transient failures; the snapshot shows "retrying". */
  isFinalAttempt: boolean;
}

export type Indexer = (snapshotId: string, options: IndexOptions) => Promise<void>;

const GENERIC_FAILURE = 'Indexing failed because of an unexpected error. Please try again.';
const PROGRESS_INTERVAL_MS = 1_000;

export function createIndexer(deps: IndexerDeps): Indexer {
  const { prisma, github, limits, logger } = deps;

  const setProgress = (id: string, progress: SnapshotProgress) =>
    prisma.snapshot.update({ where: { id }, data: { progress: { ...progress } } });

  return async function indexSnapshot(snapshotId, { isFinalAttempt }) {
    const snapshot = await prisma.snapshot.findUnique({
      where: { id: snapshotId },
      include: { repository: true },
    });
    if (!snapshot) {
      logger.warn({ snapshotId }, 'snapshot vanished before indexing');
      return;
    }
    const { owner, name } = snapshot.repository;
    const log = { snapshotId, repo: `${owner}/${name}`, sha: snapshot.commitSha };
    const started = Date.now();

    try {
      await prisma.snapshot.update({
        where: { id: snapshotId },
        data: {
          status: 'FETCHING',
          failureReason: null,
          startedAt: new Date(),
          progress: { stage: 'fetching' },
        },
      });

      const archive = await github.downloadTarball(owner, name, snapshot.commitSha);
      const extracted = await extractTarball(archive, limits);
      const codeFiles = extracted.files.filter((f) => f.kind === 'CODE');
      if (codeFiles.length === 0) {
        throw new IndexingError('No TypeScript or JavaScript files were found in this repository.');
      }
      logger.info(
        { ...log, files: extracted.files.length, skipped: extracted.skipped },
        'archive extracted',
      );

      await prisma.snapshot.update({
        where: { id: snapshotId },
        data: {
          status: 'PARSING',
          progress: { stage: 'parsing', processed: 0, total: codeFiles.length },
        },
      });
      const parser = await deps.getParser();
      let lastWrite = Date.now();
      let pending: Promise<unknown> = Promise.resolve();
      const graph = buildCodeGraph(extracted.files, parser, (processed, total) => {
        // Parsing is synchronous; progress writes are throttled and chained, not awaited.
        if (Date.now() - lastWrite < PROGRESS_INTERVAL_MS && processed !== total) return;
        lastWrite = Date.now();
        pending = pending.then(() =>
          setProgress(snapshotId, { stage: 'parsing', processed, total }),
        );
      });
      await pending;

      await setProgress(snapshotId, { stage: 'saving' });
      const saved = await saveCodeGraph(prisma, snapshotId, extracted.files, graph);

      await prisma.snapshot.update({
        where: { id: snapshotId },
        data: {
          status: 'READY',
          readyAt: new Date(),
          progress: Prisma.DbNull,
          stats: { ...buildStats(extracted, graph, saved.files), durationMs: Date.now() - started },
        },
      });
      logger.info({ ...log, ...saved, durationMs: Date.now() - started }, 'snapshot indexed');
    } catch (err) {
      const userMessage = userFacingMessage(err);
      if (userMessage) {
        logger.info({ ...log, reason: userMessage }, 'indexing rejected');
        await markFailed(snapshotId, userMessage);
        throw new IndexingError(userMessage);
      }
      logger.error({ ...log, err, isFinalAttempt }, 'indexing failed');
      if (isFinalAttempt) {
        await markFailed(snapshotId, GENERIC_FAILURE);
      } else {
        await prisma.snapshot.update({
          where: { id: snapshotId },
          data: { status: 'QUEUED', progress: { stage: 'retrying' } },
        });
      }
      throw err;
    }
  };

  async function markFailed(snapshotId: string, failureReason: string) {
    await prisma.file.deleteMany({ where: { snapshotId } });
    await prisma.snapshot.update({
      where: { id: snapshotId },
      data: { status: 'FAILED', failureReason, progress: Prisma.DbNull },
    });
  }
}

/** Returns a message for failures that retrying can't fix; null for transient ones. */
function userFacingMessage(err: unknown): string | null {
  if (err instanceof IndexingError || err instanceof LimitExceededError) return err.message;
  // GitHub 4xx (repo deleted, made private) won't change on retry; 5xx and rate limits might.
  if (err instanceof AppError && err.statusCode < 500) return err.message;
  return null;
}

function buildStats(extracted: ExtractResult, graph: CodeGraph, fileCount: number) {
  const byKind = { CODE: 0, DOC: 0, CONFIG: 0 };
  for (const f of extracted.files) byKind[f.kind]++;
  const internal = graph.imports.filter((i) => i.toPath !== null).length;
  const external = graph.imports.filter((i) => i.external).length;
  return {
    files: { total: fileCount, code: byKind.CODE, docs: byKind.DOC, config: byKind.CONFIG },
    filesWithParseErrors: [...graph.files.values()].filter((f) => f.hasErrors).length,
    symbols: [...graph.files.values()].reduce((n, f) => n + f.symbols.length, 0),
    imports: {
      total: graph.imports.length,
      internal,
      external,
      unresolved: graph.imports.length - internal - external,
    },
    calls: {
      total: graph.calls.length,
      resolved: graph.calls.filter((c) => c.target !== null).length,
    },
    routes: graph.routes.length,
    skipped: extracted.skipped,
  };
}
