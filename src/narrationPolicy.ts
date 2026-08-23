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
  zone: Zone
  /** 0 = far, 1 = at your feet. See {@link proximityOf} — it is a heuristic. */
  proximity: number
}

/** Below this, nothing is close enough to be worth a buzz. */
export const PULSE_MIN_PROXIMITY = 0.55
export const PULSE_SLOWEST_MS = 1200
export const PULSE_FASTEST_MS = 250

/** A newly-seen object is announced at once, then backs off while it persists. */
export const FIRST_DELAY_MS = 3000
export const MAX_DELAY_MS = 12000

/** Nothing is ever spoken more often than this, however much is in frame. */
export const GLOBAL_MIN_GAP_MS = 2500

/**
 * Out of sight this long and an object counts as new again.
 *
 * Deliberately long. Sweeping the camera past something and back takes a couple of
 * seconds, and at 8s this re-announced everything on every sweep.
 */
export const FORGET_MS = 20000

/**
 * How far past a zone boundary a box must travel before we call it a zone change,
 * as a fraction of frame width.
 *
 * Without this, a box sitting near the one-third line jitters between 'ahead' and
 * 'on your left' frame to frame. Those are different keys, so each flip counted as
 * news and the app announced the same object over and over.
 */
export const ZONE_MARGIN = 0.06

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
export function zoneOf(box: Box, frameWidth: number, previous?: Zone): Zone {
  const centreX = (box.x1 + box.x2) / 2
  const margin = previous == null ? 0 : frameWidth * ZONE_MARGIN

  // Boundaries move to favour whichever zone we already called it, so a jittering
  // box has to move decisively before we treat it as having crossed.
  let leftEdge = frameWidth / 3
  let rightEdge = (frameWidth * 2) / 3
  if (previous === 'on your left') leftEdge += margin
  else if (previous === 'on your right') rightEdge -= margin
  else if (previous === 'ahead') {
    leftEdge -= margin
    rightEdge += margin
  }

  if (centreX < leftEdge) return 'on your left'
  if (centreX > rightEdge) return 'on your right'
  return 'ahead'
}

/** Last zone we assigned each label, so {@link zoneOf} can apply hysteresis. */
export type ZoneMemory = Map<string, Zone>

/**
 * How close something is, from where its base sits in the frame.
 *
 * For a forward-facing camera at chest height, the bottom edge of a box — where the
 * object meets the floor — falls lower in the frame the closer it is. Unlike box
 * area this is independent of how big the object actually is, so a nearby chair and
 * a distant sofa are told apart.
 *
 * ponytail: heuristic, not metric. Assumes the object rests on the floor and the
 * phone is held roughly upright. A sign on a wall reads as far; a phone held tilted
 * down reads everything as close. Replace with real depth — see docs/decisions.md
 * for why this device cannot supply it today.
 */
export function proximityOf(box: Box, frameHeight: number): number {
  if (frameHeight <= 0) return 0
  return Math.max(0, Math.min(1, box.y2 / frameHeight))
}

/**
 * Three distinct buzz patterns, rather than a rate that slides smoothly with distance.
 *
 * A continuously varying rate is not learnable — you cannot tell 900ms from 700ms
 * while walking. Three patterns that feel obviously different can be learned in a
 * minute and then recognised without thinking.
 */
export type PulsePattern = 'none' | 'far' | 'near' | 'imminent'

export function patternFor(proximity: number): PulsePattern {
  if (proximity < PULSE_MIN_PROXIMITY) return 'none'
  if (proximity < 0.7) return 'far'
  if (proximity < 0.85) return 'near'
  return 'imminent'
}

/** Gap between repeats of a pattern, in ms. */
export function intervalFor(pattern: PulsePattern): number | null {
  switch (pattern) {
    case 'none':
      return null
    case 'far':
      return PULSE_SLOWEST_MS
    case 'near':
      return 700
    case 'imminent':
      return PULSE_FASTEST_MS
  }
}

/**
 * The closest thing directly in the user's path, or null.
 *
 * Only 'ahead' counts: things to the side get walked past, and buzzing about them
 * would train the user to ignore the buzz.
 */
export function nearestInPath(candidates: Candidate[]): Candidate | null {
  let nearest: Candidate | null = null
  for (const c of candidates) {
    if (c.zone !== 'ahead') continue
    if (nearest == null || c.proximity > nearest.proximity) nearest = c
  }
  return nearest
}

/**
 * Turns raw detections into ranked, speakable candidates.
 *
 * Score is box area — a stand-in for "how close", which is a stand-in for "how much
 * it matters" — boosted for things near the centre of the frame, because those are
 * in the user's path. It is a rough proxy and will be replaced by real depth in M3.
 */
export function toCandidates(
  detections: Detected[],
  frameWidth: number,
  frameHeight: number,
  zoneMemory?: ZoneMemory,
): Candidate[] {
  return detections.map((d) => {
    const label = d.label.toLowerCase().replace(/_/g, ' ')
    const zone = zoneOf(d.bbox, frameWidth, zoneMemory?.get(label))
    zoneMemory?.set(label, zone)
    const area = Math.max(0, d.bbox.x2 - d.bbox.x1) * Math.max(0, d.bbox.y2 - d.bbox.y1)
    const centreX = (d.bbox.x1 + d.bbox.x2) / 2
    const offCentre = Math.min(1, Math.abs(centreX - frameWidth / 2) / (frameWidth / 2))

    return {
      // Moving between zones is news. Standing still is not.
      key: `${label}|${zone}`,
      text: `${label} ${zone}`,
      score: area * (2 - offCentre),
      zone,
      proximity: proximityOf(d.bbox, frameHeight),
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
