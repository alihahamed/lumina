/**
 * Decides what Lumina says, and when.
 *
 * The core rule: announce **changes, not state**. Reporting everything the camera
 * sees, continuously, is what makes assistive apps unusable — the user cannot hear
 * the actual world (traffic, footsteps, echo off a wall) over the narration, and
 * stops trusting it. Silence has to mean "nothing changed", not "app is confused".
 *
 * No native imports, so all of this is testable with plain `node`.
 * See `narrationPolicy.test.ts`.
 */

export type Zone = 'on your left' | 'ahead' | 'on your right'

export interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** A detection reduced to what the policy needs. */
export interface Detected {
  label: string
  bbox: Box
}

export interface Candidate {
  /** Identity for cooldown purposes. Same object in the same place = same key. */
  key: string
  text: string
  score: number
}

/** A newly-seen object is announced at once, then backs off while it persists. */
export const FIRST_DELAY_MS = 3000
export const MAX_DELAY_MS = 12000

/** Nothing is ever spoken more often than this, however much is in frame. */
export const GLOBAL_MIN_GAP_MS = 2500

/** Out of sight this long and an object counts as new again. */
export const FORGET_MS = 8000

export interface Track {
  lastSpoken: number
  lastSeen: number
  /** How many times this object has been announced in its current spell in view. */
  spoken: number
}

/**
 * Gap required before announcing the same object again: 3s, then 6s, then 12s and
 * stays there. Computed from the count rather than doubled in place, so the first
 * repeat waits 3s — doubling on the way out skips that step.
 */
export function delayFor(spoken: number): number {
  return Math.min(FIRST_DELAY_MS * 2 ** Math.max(0, spoken - 1), MAX_DELAY_MS)
}

export type Tracks = Map<string, Track>

/**
 * Which third of the frame the object sits in.
 *
 * Three zones, not five: under stress nobody can act on "slightly left of centre".
 * `bbox` is in original frame pixels (ExecuTorch scales it by
 * originalSize/inputSize), so `frameWidth` must be the frame's width, not the
 * model's input size.
 */
export function zoneOf(box: Box, frameWidth: number): Zone {
  const centreX = (box.x1 + box.x2) / 2
  if (centreX < frameWidth / 3) return 'on your left'
  if (centreX > (frameWidth * 2) / 3) return 'on your right'
  return 'ahead'
}

/**
 * Turns raw detections into ranked, speakable candidates.
 *
 * Score is box area — a stand-in for "how close", which is a stand-in for "how much
 * it matters" — boosted for things near the centre of the frame, because those are
 * in the user's path. It is a rough proxy and will be replaced by real depth in M3.
 */
export function toCandidates(detections: Detected[], frameWidth: number): Candidate[] {
  return detections.map((d) => {
    const label = d.label.toLowerCase().replace(/_/g, ' ')
    const zone = zoneOf(d.bbox, frameWidth)
    const area = Math.max(0, d.bbox.x2 - d.bbox.x1) * Math.max(0, d.bbox.y2 - d.bbox.y1)
    const centreX = (d.bbox.x1 + d.bbox.x2) / 2
    const offCentre = Math.min(1, Math.abs(centreX - frameWidth / 2) / (frameWidth / 2))

    return {
      // Moving between zones is news. Standing still is not.
      key: `${label}|${zone}`,
      text: `${label} ${zone}`,
      score: area * (2 - offCentre),
    }
  })
}

/**
 * Picks at most one thing to say this frame, or nothing.
 *
 * Always updates `tracks` from what is currently visible, even when it returns null,
 * so an object that stays in view during a long utterance is not wrongly forgotten.
 *
 * @param canSpeak false while something is already being spoken. Chatter never queues
 *   behind chatter — by the time a backlog is read out it describes the past.
 */
export function selectAnnouncement(
  candidates: Candidate[],
  now: number,
  tracks: Tracks,
  lastSpokeAt: number,
  canSpeak = true,
): Candidate | null {
  // Gone long enough to count as new on return, so its backoff resets.
  for (const [key, track] of tracks) {
    if (now - track.lastSeen > FORGET_MS) tracks.delete(key)
  }

  for (const candidate of candidates) {
    const track = tracks.get(candidate.key)
    if (track) track.lastSeen = now
    else tracks.set(candidate.key, { lastSpoken: -Infinity, lastSeen: now, spoken: 0 })
  }

  if (!canSpeak) return null

  // Hard ceiling. The user needs the gaps to hear the room.
  if (now - lastSpokeAt < GLOBAL_MIN_GAP_MS) return null

  // One utterance per frame — the most important thing only. Five objects in view
  // must not produce five sentences.
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const track = tracks.get(candidate.key)
    if (track == null || now - track.lastSpoken < delayFor(track.spoken)) continue

    // Backs off while it persists, so your own desk chair goes quiet within about
    // twenty seconds instead of repeating forever.
    track.lastSpoken = now
    track.spoken += 1
    return candidate
  }

  return null
}
