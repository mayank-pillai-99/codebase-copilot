export interface CitationCheck {
  /** Markers that refer to a provided source, in order of first appearance. */
  valid: number[];
  /** Markers outside 1..sourceCount (hallucinated sources). */
  invalid: number[];
  /** The text with invalid markers removed. */
  cleaned: string;
}

// [3], [1, 2], [1,2,5]
const MARKER_GROUP = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Server-side citation validation (SPEC §7.3). The model only sees numbered
 * sources, so any marker outside 1..sourceCount is something it made up. Those are
 * removed from the text; valid ones are kept and resolved to real locations by the
 * caller from the database, never from the model's words.
 */
export function checkCitations(text: string, sourceCount: number): CitationCheck {
  const valid: number[] = [];
  const invalid: number[] = [];

  const cleaned = text.replace(MARKER_GROUP, (_match, group: string) => {
    const markers = group.split(',').map((n) => Number.parseInt(n.trim(), 10));
    const kept = markers.filter((m) => {
      const ok = m >= 1 && m <= sourceCount;
      const list = ok ? valid : invalid;
      if (!list.includes(m)) list.push(m);
      return ok;
    });
    return kept.length ? `[${kept.join(', ')}]` : '';
  });

  return {
    valid,
    invalid,
    // Removing a marker can leave "word ." or double spaces behind.
    cleaned: invalid.length
      ? cleaned.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ')
      : cleaned,
  };
}
