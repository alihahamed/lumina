// Run with: npm test
import assert from 'node:assert'
import {
  FIRST_DELAY_MS,
  PULSE_FASTEST_MS,
  PULSE_MIN_PROXIMITY,
  PULSE_SLOWEST_MS,
  nearestInPath,
  proximityOf,
  pulseIntervalFor,
  FORGET_MS,
  GLOBAL_MIN_GAP_MS,
  MAX_DELAY_MS,
  delayFor,
  selectAnnouncement,
  toCandidates,
  zoneOf,
  type Tracks,
} from './narrationPolicy.ts'

const W = 900 // frame width; thirds fall at 300 and 600
const H = 1000 // frame height
const box = (x1: number, x2: number, y1 = 0, y2 = 100) => ({ x1, x2, y1, y2 })

// --- zones -------------------------------------------------------------------
assert.equal(zoneOf(box(0, 100), W), 'on your left')
assert.equal(zoneOf(box(400, 500), W), 'ahead')
assert.equal(zoneOf(box(800, 880), W), 'on your right')
// A box spanning the frame is centred, so it reads as ahead.
assert.equal(zoneOf(box(0, 900), W), 'ahead')

// --- candidates --------------------------------------------------------------
const [c] = toCandidates([{ label: 'POTTED_PLANT', bbox: box(0, 100) }], W, H)
assert.equal(c.key, 'potted plant|on your left', 'key is label + zone')
assert.equal(c.text, 'potted plant on your left', 'underscores become spaces')

// Same size, but nearer the centre must outrank the edge — it is in the user's path.
const ranked = toCandidates(
  [
    { label: 'chair', bbox: box(0, 100) },
    { label: 'person', bbox: box(400, 500) },
  ],
  W,
  H,
)
assert.ok(ranked[1].score > ranked[0].score, 'centre beats edge at equal size')

// --- announcement selection --------------------------------------------------
const tracks: Tracks = new Map()
const chairLeft = toCandidates([{ label: 'chair', bbox: box(0, 100) }], W, H)

let pick = selectAnnouncement(chairLeft, 0, tracks, -Infinity)
assert.equal(pick?.text, 'chair on your left', 'a newly seen object speaks at once')

// Still there → silence, both because of the global gap and its own cooldown.
assert.equal(selectAnnouncement(chairLeft, 1000, tracks, 0), null, 'no repeat while present')
assert.equal(selectAnnouncement(chairLeft, FIRST_DELAY_MS - 1, tracks, 0), null, 'still inside cooldown')
// The first repeat waits FIRST_DELAY_MS, not double it.
assert.equal(delayFor(1), FIRST_DELAY_MS, 'first repeat gap is 3s')
assert.equal(delayFor(2), FIRST_DELAY_MS * 2, 'second is 6s')

// At the cooldown boundary it repeats once, then backs off to 2x.
pick = selectAnnouncement(chairLeft, FIRST_DELAY_MS, tracks, 0)
assert.ok(pick, 'repeats at the cooldown boundary')
assert.equal(delayFor(tracks.get('chair|on your left')!.spoken), FIRST_DELAY_MS * 2, 'backoff doubles')

// --- the "person ahead, person ahead" case -----------------------------------
// A single object in view for a long time must go quiet, not repeat forever.
const persistent: Tracks = new Map()
let spokeAt = -Infinity
let utterances = 0
for (let t = 0; t <= 60_000; t += 500) {
  const said = selectAnnouncement(chairLeft, t, persistent, spokeAt)
  if (said) {
    utterances++
    spokeAt = t
  }
}
assert.ok(utterances <= 8, `a stationary object over 60s spoke ${utterances} times, expected <= 8`)
assert.equal(delayFor(persistent.get('chair|on your left')!.spoken), MAX_DELAY_MS, 'backoff caps out')

// --- moving between zones is news --------------------------------------------
const moving: Tracks = new Map()
selectAnnouncement(toCandidates([{ label: 'person', bbox: box(0, 100) }], W, H), 0, moving, -Infinity)
const moved = selectAnnouncement(
  toCandidates([{ label: 'person', bbox: box(800, 880) }], W, H),
  GLOBAL_MIN_GAP_MS,
  moving,
  0,
)
assert.equal(moved?.text, 'person on your right', 'crossing to another zone is announced')

// --- global budget -----------------------------------------------------------
const budget: Tracks = new Map()
const two = toCandidates(
  [
    { label: 'chair', bbox: box(0, 100) },
    { label: 'person', bbox: box(400, 600) },
  ],
  W,
  H,
)
const first = selectAnnouncement(two, 0, budget, -Infinity)
assert.equal(first?.text, 'person ahead', 'the biggest, most central thing wins')
assert.equal(
  selectAnnouncement(two, GLOBAL_MIN_GAP_MS - 1, budget, 0),
  null,
  'nothing else speaks inside the global gap, however much is in frame',
)

// --- canSpeak = false still tracks visibility --------------------------------
const busy: Tracks = new Map()
assert.equal(selectAnnouncement(chairLeft, 0, busy, -Infinity, false), null, 'silent while speaking')
assert.equal(busy.get('chair|on your left')?.lastSeen, 0, 'but the object is still marked seen')
assert.equal(
  busy.get('chair|on your left')?.lastSpoken,
  -Infinity,
  'and its cooldown is not consumed by a suppressed pick',
)

// --- leaving and returning resets the backoff --------------------------------
const returning: Tracks = new Map()
selectAnnouncement(chairLeft, 0, returning, -Infinity)
selectAnnouncement([], FORGET_MS + 1, returning, 0) // out of view long enough to forget
assert.equal(returning.size, 0, 'a long-absent object is forgotten')
const again = selectAnnouncement(chairLeft, FORGET_MS + 2, returning, 0)
assert.equal(again?.text, 'chair on your left', 'and speaks again on return')

// --- proximity ---------------------------------------------------------------
// Base of the box lower in frame = closer.
assert.equal(proximityOf(box(0, 100, 0, 1000), H), 1, 'box reaching the bottom is closest')
assert.equal(proximityOf(box(0, 100, 0, 500), H), 0.5, 'halfway down is mid-range')
assert.ok(
  proximityOf(box(0, 100, 0, 900), H) > proximityOf(box(0, 100, 0, 400), H),
  'a lower base reads as nearer regardless of box size',
)
// Size must not fool it: a big far object vs a small near one.
const farButBig = proximityOf(box(0, 800, 0, 300), H)
const nearButSmall = proximityOf(box(400, 450, 850, 950), H)
assert.ok(nearButSmall > farButBig, 'base position beats area as a distance cue')
assert.equal(proximityOf(box(0, 100, 0, 500), 0), 0, 'degenerate frame height is safe')

// --- pulse pacing ------------------------------------------------------------
assert.equal(pulseIntervalFor(0), null, 'nothing far away buzzes')
assert.equal(pulseIntervalFor(PULSE_MIN_PROXIMITY - 0.01), null, 'below threshold stays silent')
assert.equal(pulseIntervalFor(PULSE_MIN_PROXIMITY), PULSE_SLOWEST_MS, 'at threshold, slowest')
assert.equal(pulseIntervalFor(1), PULSE_FASTEST_MS, 'at your feet, fastest')
assert.ok(
  pulseIntervalFor(0.9)! < pulseIntervalFor(0.7)!,
  'closer pulses faster — a rising rate needs no explaining',
)

// --- only what is in your path -----------------------------------------------
const scene = toCandidates(
  [
    { label: 'chair', bbox: box(0, 100, 0, 990) },      // very close, but off to the left
    { label: 'person', bbox: box(400, 500, 0, 700) },   // ahead, further away
  ],
  W,
  H,
)
const path = nearestInPath(scene)
assert.equal(path?.text, 'person ahead', 'things to the side are walked past, not buzzed about')
assert.equal(nearestInPath([]), null, 'empty scene has nothing in the path')
assert.equal(
  nearestInPath(toCandidates([{ label: 'chair', bbox: box(0, 100, 0, 990) }], W, H)),
  null,
  'a scene with nothing ahead returns null',
)

console.log('narrationPolicy: all checks passed')
