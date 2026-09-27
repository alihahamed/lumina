// Text shaping for speech. No native imports, so it runs under plain `node`
// (see text.test.ts).

/**
 * The first `n` complete sentences. Small models run on past the point, and a reply
 * cut off by a timeout ends mid-sentence; neither is worth speaking. Text with no
 * sentence punctuation at all is returned whole rather than dropped.
 */
export function firstSentences(text: string, n: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  const parts = clean.match(/[^.!?]+[.!?]+/g)
  if (parts == null) return clean
  return parts
    .slice(0, n)
    .map((p) => p.trim())
    .join(' ')
}
