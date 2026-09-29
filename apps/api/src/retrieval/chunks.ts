import type { PrismaClient } from '../lib/prisma';
import type { RetrievedChunk, RetrievalSource } from './types';

/** Loads chunk details for ranked ids, preserving the given order and scores. */
export async function loadChunks(
  prisma: PrismaClient,
  ranked: { id: string; score: number; sources: RetrievalSource[] }[],
): Promise<RetrievedChunk[]> {
  if (ranked.length === 0) return [];
  const rows = await prisma.chunk.findMany({
    where: { id: { in: ranked.map((r) => r.id) } },
    select: {
      id: true,
      fileId: true,
      symbolId: true,
      kind: true,
      label: true,
      startLine: true,
      endLine: true,
      header: true,
      content: true,
      file: { select: { path: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ranked.flatMap(({ id, score, sources }) => {
    const row = byId.get(id);
    if (!row) return [];
    return [
      {
        chunkId: row.id,
        fileId: row.fileId,
        symbolId: row.symbolId,
        path: row.file.path,
        kind: row.kind,
        label: row.label,
        startLine: row.startLine,
        endLine: row.endLine,
        header: row.header,
        content: row.content,
        score,
        sources,
      },
    ];
  });
}
