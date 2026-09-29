import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../config/env';
import { createGitHubClient } from '../github/client';
import { GeminiEmbeddings } from '../llm/embeddings';
import type { PrismaClient } from '../lib/prisma';
import { createIndexer, type Indexer } from './indexer';
import { createCodeParser, type CodeParser } from './parser';

const MB = 1024 * 1024;

/** Wires the indexer from configuration; shared by the API (in-process worker) and worker.ts. */
export function createIndexerFromEnv(
  env: Env,
  prisma: PrismaClient,
  logger: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>,
): Indexer {
  let parser: Promise<CodeParser> | undefined;
  return createIndexer({
    prisma,
    github: createGitHubClient({ token: env.GITHUB_TOKEN }),
    getParser: () => (parser ??= createCodeParser()),
    embedder: env.GEMINI_API_KEY
      ? new GeminiEmbeddings({ apiKey: env.GEMINI_API_KEY, model: env.EMBEDDING_MODEL })
      : null,
    limits: {
      maxArchiveBytes: env.MAX_ARCHIVE_MB * MB,
      maxFileBytes: env.MAX_FILE_KB * 1024,
      maxTotalBytes: env.MAX_TOTAL_SOURCE_MB * MB,
      maxCodeFiles: env.MAX_SOURCE_FILES,
      maxChunks: env.MAX_CHUNKS,
    },
    logger,
  });
}
