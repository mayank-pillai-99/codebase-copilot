import type { SearchResponse, searchRetrievers } from '@codebase-copilot/shared';
import { AppError } from '../lib/errors';
import type { PrismaClient } from '../lib/prisma';
import type { Retriever } from '../retrieval/types';
import { findVisibleSnapshot, type DemoRepositories } from './snapshot-access';

type SearchRetriever = (typeof searchRetrievers)[number];

export interface SearchService {
  /** viewerId is null for anonymous visitors (demo repositories only). */
  search(
    viewerId: string | null,
    snapshotId: string,
    request: { query: string; retriever: SearchRetriever; k: number },
  ): Promise<SearchResponse>;
}

export interface SearchServiceDeps {
  prisma: PrismaClient;
  retrievers: Record<SearchRetriever, Retriever>;
  demo?: DemoRepositories;
}

/** Runs one retriever directly, without an LLM: the same results chat and evaluation see. */
export function createSearchService({
  prisma,
  retrievers,
  demo = [],
}: SearchServiceDeps): SearchService {
  return {
    async search(viewerId, snapshotId, { query, retriever, k }) {
      const snapshot = await findVisibleSnapshot(prisma, viewerId, snapshotId, demo);
      if (snapshot.status !== 'READY') {
        throw new AppError(409, 'This snapshot is still being indexed.');
      }
      const chunks = await retrievers[retriever].retrieve({ snapshotId, query, k });
      return {
        retriever,
        results: chunks.map((c) => ({
          chunkId: c.chunkId,
          path: c.path,
          startLine: c.startLine,
          endLine: c.endLine,
          kind: c.kind,
          label: c.label,
          snippet: buildSnippet(c.content),
          score: c.score,
          sources: c.sources,
        })),
      };
    },
  };
}

/**
 * A short preview of a chunk: its first few non-blank lines with the shared
 * indentation removed, capped in length.
 */
export function buildSnippet(content: string, maxLines = 4, maxChars = 300): string {
  const lines = content
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '')
    .slice(0, maxLines);
  const indent = Math.min(
    ...lines.map((line) => line.match(/^[ \t]*/)![0].length),
    Number.POSITIVE_INFINITY,
  );
  const text = lines.map((line) => line.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}
