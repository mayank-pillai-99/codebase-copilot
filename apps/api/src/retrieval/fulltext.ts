import { splitIdentifier } from '../indexing/chunker';
import type { PrismaClient } from '../lib/prisma';
import { loadChunks } from './chunks';
import type { Retriever } from './types';

const STOP_WORDS = new Set(
  (
    'a an and are as at be but by can do does for from get how i if in into is it its me my ' +
    'of on or should so that the their them then there these this to use used uses using was ' +
    'we what when where which who why will with work works you your code function functions ' +
    'project repo repository happen happens'
  ).split(' '),
);

/**
 * Turns a natural-language or identifier query into an OR tsquery with prefix
 * matching: "where do we createUser?" → "createuser:* | create:* | user:*".
 * Tokens are reduced to [a-z0-9_], so nothing the user types is parsed as
 * tsquery syntax. Returns null when nothing searchable remains.
 */
export function toTsQuery(query: string): string | null {
  const terms = new Set<string>();
  for (const word of query.match(/[A-Za-z_$][\w$]*|\d+/g) ?? []) {
    const lower = word.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (lower.length > 1 && !STOP_WORDS.has(lower)) terms.add(lower);
    for (const part of splitIdentifier(word)) {
      if (!STOP_WORDS.has(part)) terms.add(part.replace(/[^a-z0-9_]/g, ''));
    }
  }
  const tokens = [...terms].filter(Boolean).slice(0, 24);
  return tokens.length ? tokens.map((t) => `${t}:*`).join(' | ') : null;
}

/** Identifiers in a query, lowercased: candidates for an exact symbol-name match. */
export function queryIdentifiers(query: string): string[] {
  const words = query.match(/[A-Za-z_$][\w$]*/g) ?? [];
  return [...new Set(words.map((w) => w.toLowerCase()))].filter(
    (w) => w.length > 2 && !STOP_WORDS.has(w),
  );
}

// Added to ts_rank_cd scores (which are well below this) for an exact name match.
const NAME_MATCH_BOOST = 10;

/**
 * Postgres full-text search over chunk search_text (identifiers split into words).
 * A chunk whose symbol is named exactly like a word in the query (`createArticle`,
 * or the method part of `PaymentService.charge`) ranks first, so searching for an
 * identifier lands on its definition rather than on code that mentions it often.
 */
export function createFullTextRetriever(prisma: PrismaClient): Retriever {
  return {
    name: 'fulltext',
    async retrieve({ snapshotId, query, k }) {
      const tsquery = toTsQuery(query);
      if (!tsquery) return [];
      const names = queryIdentifiers(query);
      const rows = await prisma.$queryRaw<{ id: string; score: number }[]>`
        SELECT id,
          ts_rank_cd(tsv, q)
            + CASE
                WHEN lower(label) = ANY(${names}::text[])
                  OR regexp_replace(lower(label), '^.*\.', '') = ANY(${names}::text[])
                THEN ${NAME_MATCH_BOOST}
                ELSE 0
              END AS score
        FROM chunks, to_tsquery('simple', ${tsquery}) AS q
        WHERE snapshot_id = ${snapshotId}::uuid AND tsv @@ q
        ORDER BY score DESC, id
        LIMIT ${k}
      `;
      return loadChunks(
        prisma,
        rows.map((r) => ({ id: r.id, score: Number(r.score), sources: ['fulltext' as const] })),
      );
    },
  };
}
