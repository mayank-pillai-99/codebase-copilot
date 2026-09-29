import type { PrismaClient } from '../lib/prisma';
import { loadChunks } from './chunks';
import type { RetrievedChunk, Retriever, RetrievalSource } from './types';

const RRF_K = 60;
const CANDIDATES = 30;
const EXPAND_FROM = 5;
const MAX_EXPANSIONS = 6;
const GRAPH_DECAY = 0.5;

interface Ranked {
  id: string;
  score: number;
  sources: RetrievalSource[];
}

/**
 * Reciprocal Rank Fusion: each list contributes 1 / (k + rank) per item. It needs
 * no score calibration between cosine similarity and ts_rank, which live on
 * unrelated scales.
 */
export function reciprocalRankFusion(lists: RetrievedChunk[][], k = RRF_K): Ranked[] {
  const fused = new Map<string, Ranked>();
  for (const list of lists) {
    list.forEach((chunk, rank) => {
      const entry = fused.get(chunk.chunkId) ?? { id: chunk.chunkId, score: 0, sources: [] };
      entry.score += 1 / (k + rank + 1);
      for (const s of chunk.sources) if (!entry.sources.includes(s)) entry.sources.push(s);
      fused.set(chunk.chunkId, entry);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

/**
 * Default retriever (SPEC §6.2): vector and full-text candidates fused with RRF,
 * then expanded one hop along the call graph from the best results, so a question
 * about a handler also brings in the service it calls (or its callers).
 */
export function createHybridRetriever(
  prisma: PrismaClient,
  vector: Retriever,
  fulltext: Retriever,
  /** Evaluation turns graph expansion off to measure what it adds. */
  { graphExpansion = true }: { graphExpansion?: boolean } = {},
): Retriever {
  return {
    name: 'hybrid',
    async retrieve({ snapshotId, query, k }) {
      const [byVector, byText] = await Promise.all([
        vector.retrieve({ snapshotId, query, k: CANDIDATES }),
        fulltext.retrieve({ snapshotId, query, k: CANDIDATES }),
      ]);
      const fused = reciprocalRankFusion([byVector, byText]);
      const details = new Map([...byVector, ...byText].map((c) => [c.chunkId, c]));

      const top = fused.slice(0, k);
      const expanded = graphExpansion ? await expandAlongCalls(prisma, top) : [];
      const ranked = [...top, ...expanded].sort((a, b) => b.score - a.score).slice(0, k);

      // Chunks from the candidate lists are already loaded; only graph additions need a query.
      const missing = ranked.filter((r) => !details.has(r.id));
      const loaded = new Map((await loadChunks(prisma, missing)).map((c) => [c.chunkId, c]));
      return ranked.flatMap((r) => {
        const chunk = details.get(r.id) ?? loaded.get(r.id);
        return chunk ? [{ ...chunk, score: r.score, sources: r.sources }] : [];
      });
    },
  };
}

/**
 * Chunks one resolved call away from the top results. Calls are matched on every
 * symbol *inside* a seed chunk (a small class is one chunk, but its calls belong to
 * its methods), and each neighbor symbol maps to the tightest chunk containing it.
 */
async function expandAlongCalls(prisma: PrismaClient, top: Ranked[]): Promise<Ranked[]> {
  const seeds = top.slice(0, EXPAND_FROM);
  if (seeds.length === 0) return [];

  const rows = await prisma.$queryRaw<{ seed: string; neighbor: string }[]>`
    WITH seed AS (
      SELECT id, file_id, start_line, end_line FROM chunks WHERE id = ANY(${seeds.map((s) => s.id)}::uuid[])
    ),
    seed_symbols AS (
      SELECT s.id AS symbol_id, seed.id AS seed_id
      FROM symbols s
      JOIN seed ON s.file_id = seed.file_id AND s.start_line BETWEEN seed.start_line AND seed.end_line
    ),
    neighbor_symbols AS (
      SELECT ss.seed_id, e.to_symbol_id AS symbol_id
      FROM call_edges e JOIN seed_symbols ss ON e.from_symbol_id = ss.symbol_id
      WHERE e.resolved
      UNION
      SELECT ss.seed_id, e.from_symbol_id
      FROM call_edges e JOIN seed_symbols ss ON e.to_symbol_id = ss.symbol_id
      WHERE e.resolved AND e.from_symbol_id IS NOT NULL
    )
    SELECT DISTINCT n.seed_id AS seed, c.id AS neighbor
    FROM neighbor_symbols n
    JOIN symbols ns ON ns.id = n.symbol_id
    JOIN LATERAL (
      SELECT id FROM chunks
      WHERE file_id = ns.file_id AND ns.start_line BETWEEN start_line AND end_line
      ORDER BY end_line - start_line
      LIMIT 1
    ) c ON true
  `;

  const scoreOf = new Map(seeds.map((s) => [s.id, s.score]));
  const present = new Set(top.map((r) => r.id));
  const best = new Map<string, number>();
  for (const { seed, neighbor } of rows) {
    if (present.has(neighbor)) continue; // includes calls within the same chunk
    const score = (scoreOf.get(seed) ?? 0) * GRAPH_DECAY;
    best.set(neighbor, Math.max(best.get(neighbor) ?? 0, score));
  }
  return [...best]
    .map(([id, score]) => ({ id, score, sources: ['graph' as const] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EXPANSIONS);
}
