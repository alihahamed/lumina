// Place-memory decisions. No native imports, so it runs under plain `node`
// (see placeMatch.test.ts).

/**
 * Cosine similarity a match must reach before we name the place.
 *
 * ponytail: a guess. CLIP scores most indoor rooms fairly close to each other, so this
 * is high on purpose: saying "you're at the library door" in the wrong place is worse
 * than "I don't recognise this place". Tune it from the similarities shown on the debug
 * overlay while walking between saved places. docs/decisions.md.
 */
export const MATCH_THRESHOLD = 0.85

/** pgvector's text input format, which PostgREST passes straight through. */
export function toPgVector(v: ArrayLike<number>): string {
  return `[${Array.from(v, (x) => (Number.isFinite(x) ? x : 0)).join(',')}]`
}

export interface Candidate {
  label: string | null
  similarity: number
}

/** The best labelled candidate at or over the threshold, or null. */
export function bestMatch(
  candidates: Candidate[],
  threshold: number = MATCH_THRESHOLD,
): { label: string; similarity: number } | null {
  let best: { label: string; similarity: number } | null = null
  for (const c of candidates) {
    if (c.label == null || c.label.trim() === '') continue
    if (c.similarity < threshold) continue
    if (best == null || c.similarity > best.similarity) best = { label: c.label, similarity: c.similarity }
  }
  return best
}
