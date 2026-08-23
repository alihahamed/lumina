/**
 * Announcement rate limiting.
 *
 * Kept free of native imports so it can be tested with plain `node`.
 * See `rateLimit.test.ts`.
 */

/** How long before the same announcement key may repeat. */
export const COOLDOWN_MS = 3000

/**
 * Decides whether `key` may be announced at `now`, recording it when it may.
 *
 * `seen` is the caller's cooldown state and is mutated on a pass — that is what
 * makes the next call within the window return false.
 */
export function shouldAnnounce(
  key: string,
  now: number,
  seen: Map<string, number>,
  cooldown: number = COOLDOWN_MS,
): boolean {
  const last = seen.get(key)
  if (last !== undefined && now - last < cooldown) return false
  seen.set(key, now)
  return true
}
