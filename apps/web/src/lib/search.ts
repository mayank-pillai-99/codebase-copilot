/**
 * Fuzzy file-path matching for the command palette: the query's characters must
 * appear in order. Matches in the file name, runs of consecutive characters and
 * shorter paths rank higher, so "authsvc" finds `auth.service.ts` first.
 */
export function matchFiles<T extends { path: string }>(
  files: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return [];
  const scored: { file: T; score: number }[] = [];
  for (const file of files) {
    const score = scorePath(file.path, q);
    if (score !== null) scored.push({ file, score });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.file.path.length - b.file.path.length ||
        a.file.path.localeCompare(b.file.path),
    )
    .slice(0, limit)
    .map((s) => s.file);
}

function scorePath(path: string, query: string): number | null {
  const lower = path.toLowerCase();
  const nameStart = lower.lastIndexOf('/') + 1;
  const name = lower.slice(nameStart);

  let score = 0;
  const substring = name.includes(query) || lower.includes(query);
  if (name.includes(query)) score += 40 + (name.startsWith(query) ? 20 : 0);
  else if (lower.includes(query)) score += 20;

  // Every character in order, taking the tightest placement. A loose one (letters
  // scattered across the whole path) isn't a match unless it's also a substring.
  const positions = tightestMatch(lower, query);
  if (!positions) return null;
  const span = positions.at(-1)! - positions[0]! + 1;
  if (!substring && span > Math.max(query.length * 2, 8)) return null;

  positions.forEach((found, i) => {
    score += i > 0 && found === positions[i - 1]! + 1 ? 3 : 1;
    if (found >= nameStart) score += 1;
  });
  return score - path.length / 100;
}

/** Positions of the query's characters, in order, with the smallest span; null if absent. */
function tightestMatch(text: string, query: string): number[] | null {
  let best: number[] | null = null;
  for (
    let start = text.indexOf(query[0]!);
    start !== -1;
    start = text.indexOf(query[0]!, start + 1)
  ) {
    const positions = [start];
    let at = start + 1;
    for (const ch of query.slice(1)) {
      const found = text.indexOf(ch, at);
      if (found === -1) break;
      positions.push(found);
      at = found + 1;
    }
    if (positions.length !== query.length) break; // later starts can't do better
    if (!best || positions.at(-1)! - start < best.at(-1)! - best[0]!) best = positions;
  }
  return best;
}
