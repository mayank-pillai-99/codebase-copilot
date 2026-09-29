import type { FastifyBaseLogger } from 'fastify';
import type { GitHubClient } from '../github/client';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../lib/errors';
import type { PrismaClient } from '../lib/prisma';
import { EmbeddingError, GeminiEmbeddings } from '../llm/embeddings';
import { buildChunks, type ChunkDraft } from './chunker';
import { buildCodeGraph, type CodeGraph } from './graph';
import type { CodeParser } from './parser';
import { saveChunks, saveCodeGraph, saveEmbeddings } from './persist';
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

/** What the indexer needs from an embedding model (GeminiEmbeddings in production). */
export interface ChunkEmbedder {
  readonly model: string;
  embedDocuments(documents: string[]): Promise<number[][]>;
}

export interface IndexerDeps {
  prisma: PrismaClient;
  github: GitHubClient;
  getParser: () => Promise<CodeParser>;
  /** Null when no API key is configured: chunks are stored for full-text search only. */
  embedder: ChunkEmbedder | null;
  limits: ExtractLimits & { maxChunks: number };
  logger: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  /** Chunks per embedding request and progress update. */
  embeddingBatchSize?: number;
}

export interface IndexOptions {
  /** False while the queue will retry transient failures; the snapshot shows "retrying". */
  isFinalAttempt: boolean;
}

export type Indexer = (snapshotId: string, options: IndexOptions) => Promise<void>;

type EmbeddingOutcome =
  | { status: 'complete'; model: string; embedded: number }
  | { status: 'disabled'; model: null; embedded: 0 }
  | { status: 'failed'; model: string; embedded: number; reason: string };

const GENERIC_FAILURE = 'Indexing failed because of an unexpected error. Please try again.';
const PROGRESS_INTERVAL_MS = 1_000;

export function createIndexer(deps: IndexerDeps): Indexer {
  const { prisma, github, limits, logger, embedder } = deps;
  const batchSize = deps.embeddingBatchSize ?? 100;

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

      // Checked before anything is written, so an oversized repository fails fast.
      const chunks = buildChunks(extracted.files, graph);
      if (chunks.length > limits.maxChunks) {
        throw new IndexingError(
          `Repository produced ${chunks.length.toLocaleString('en-US')} searchable chunks; the current limit is ${limits.maxChunks.toLocaleString('en-US')}.`,
        );
      }

      await setProgress(snapshotId, { stage: 'saving' });
      const saved = await saveCodeGraph(prisma, snapshotId, extracted.files, graph);
      const chunkIds = await saveChunks(prisma, snapshotId, chunks, saved);

      const embeddings = await embedChunks(snapshotId, chunks, chunkIds, isFinalAttempt);

      await prisma.snapshot.update({
        where: { id: snapshotId },
        data: {
          status: 'READY',
          readyAt: new Date(),
          progress: Prisma.DbNull,
          stats: {
            ...buildStats(extracted, graph, saved.counts.files),
            chunks: chunks.length,
            embeddings,
            durationMs: Date.now() - started,
          },
        },
      });
      logger.info(
        {
          ...log,
          ...saved.counts,
          chunks: chunks.length,
          embeddings: embeddings.status,
          durationMs: Date.now() - started,
        },
        'snapshot indexed',
      );
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

  /**
   * Embeds chunks batch by batch, saving each batch as it completes. A missing key or a
   * configuration error shouldn't make the repository unusable, so those end in a READY
   * snapshot with full-text search only. A rate limit that outlasts the client's own
   * retries is re-thrown so the queue retries later, unless this is the last attempt.
   */
  async function embedChunks(
    snapshotId: string,
    chunks: ChunkDraft[],
    ids: string[],
    isFinalAttempt: boolean,
  ): Promise<EmbeddingOutcome> {
    if (!embedder) return { status: 'disabled', model: null, embedded: 0 };

    await prisma.snapshot.update({
      where: { id: snapshotId },
      data: {
        status: 'EMBEDDING',
        progress: { stage: 'embedding', processed: 0, total: chunks.length },
      },
    });
    let embedded = 0;
    try {
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const vectors = await embedder.embedDocuments(batch.map(embeddingInput));
        await saveEmbeddings(prisma, ids.slice(i, i + batchSize), vectors, embedder.model);
        embedded += batch.length;
        await setProgress(snapshotId, {
          stage: 'embedding',
          processed: embedded,
          total: chunks.length,
        });
      }
      return { status: 'complete', model: embedder.model, embedded };
    } catch (err) {
      if (!(err instanceof EmbeddingError) || (err.retryable && !isFinalAttempt)) throw err;
      logger.warn(
        { snapshotId, err: err.message, embedded },
        'embedding failed; full-text search only',
      );
      return {
        status: 'failed',
        model: embedder.model,
        embedded,
        reason: err.retryable
          ? 'The embedding service stayed rate-limited.'
          : 'The embedding service rejected the request (check the API key and model).',
      };
    }
  }

  async function markFailed(snapshotId: string, failureReason: string) {
    await prisma.file.deleteMany({ where: { snapshotId } });
    await prisma.snapshot.update({
      where: { id: snapshotId },
      data: { status: 'FAILED', failureReason, progress: Prisma.DbNull },
    });
  }
}

/** The text embedded for a chunk: its location as the title, then header and code. */
function embeddingInput(c: {
  path: string;
  label: string | null;
  header: string;
  content: string;
}) {
  return GeminiEmbeddings.formatDocument(
    c.label ? `${c.path} · ${c.label}` : c.path,
    `${c.header}\n${c.content}`,
  );
}

/**
 * Embeds the chunks of a snapshot that have no vector from `embedder.model` yet,
 * saving batch by batch, so a run cut short by rate limits resumes where it stopped
 * instead of starting over. Marks the snapshot's embeddings complete once every chunk
 * has one. Errors from the embedder propagate after the finished batches are saved.
 */
export async function embedMissingChunks(
  deps: {
    prisma: PrismaClient;
    embedder: ChunkEmbedder;
    batchSize?: number;
    onProgress?: (embedded: number, total: number) => void;
  },
  snapshotId: string,
): Promise<{ embedded: number; total: number }> {
  const { prisma, embedder, batchSize = 100 } = deps;
  const missing = await prisma.chunk.findMany({
    where: {
      snapshotId,
      OR: [{ embeddingModel: null }, { embeddingModel: { not: embedder.model } }],
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      label: true,
      header: true,
      content: true,
      file: { select: { path: true } },
    },
  });
  const total = await prisma.chunk.count({ where: { snapshotId } });
  let embedded = total - missing.length;

  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    const vectors = await embedder.embedDocuments(
      batch.map((c) => embeddingInput({ ...c, path: c.file.path })),
    );
    await saveEmbeddings(
      prisma,
      batch.map((c) => c.id),
      vectors,
      embedder.model,
    );
    embedded += batch.length;
    deps.onProgress?.(embedded, total);
  }

  const snapshot = await prisma.snapshot.findUniqueOrThrow({
    where: { id: snapshotId },
    select: { stats: true },
  });
  if (snapshot.stats && typeof snapshot.stats === 'object') {
    await prisma.snapshot.update({
      where: { id: snapshotId },
      data: {
        stats: {
          ...(snapshot.stats as Record<string, unknown>),
          embeddings: { status: 'complete', model: embedder.model, embedded },
        },
      },
    });
  }
  return { embedded, total };
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
