import type { PrismaClient } from '../lib/prisma';
import { loadChunks } from './chunks';
import type { QueryEmbedder, Retriever } from './types';

/**
 * Cosine similarity over chunk embeddings with the HNSW index. Results are scoped
 * to one snapshot and one embedding model (vectors from different models aren't
 * comparable). Returns nothing when no embedder is configured.
 */
export function createVectorRetriever(
  prisma: PrismaClient,
  embedder: QueryEmbedder | null,
): Retriever {
  return {
    name: 'vector',
    async retrieve({ snapshotId, query, k }) {
      if (!embedder || !query.trim()) return [];
      const literal = `[${(await embedder.embedQuery(query)).join(',')}]`;

      // The snapshot filter is applied after the approximate index scan; iterative scans
      // keep searching until k rows survive the filter (pgvector ≥ 0.8). relaxed_order
      // can return rows slightly out of order, so they're re-sorted below.
      const [, rows] = await prisma.$transaction([
        prisma.$executeRaw`SET LOCAL hnsw.iterative_scan = relaxed_order`,
        prisma.$queryRaw<{ id: string; score: number }[]>`
          SELECT id, 1 - (embedding <=> ${literal}::vector) AS score
          FROM chunks
          WHERE snapshot_id = ${snapshotId}::uuid
            AND embedding IS NOT NULL
            AND embedding_model = ${embedder.model}
          ORDER BY embedding <=> ${literal}::vector
          LIMIT ${k}
        `,
      ]);

      return loadChunks(
        prisma,
        rows
          .map((r) => ({ id: r.id, score: Number(r.score), sources: ['vector' as const] }))
          .sort((a, b) => b.score - a.score),
      );
    },
  };
}
