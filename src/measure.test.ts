// Run with: node src/measure.test.ts
import assert from 'node:assert'
import {
  depthSample,
  formatRecord,
  frameReport,
  judge,
  parseLog,
  percentile,
  placeReport,
  sameLabel,
  speechReport,
  spokenSummary,
  summarise,
  type FrameRecord,
  type PlaceQuery,
} from './measure.ts'

// --- percentiles: nearest rank, so every reported value is one that was measured
const hundred = Array.from({ length: 100 }, (_, i) => i + 1)
assert.equal(percentile(hundred, 50), 50)
assert.equal(percentile(hundred, 95), 95)
assert.equal(percentile([7], 95), 7)
assert.ok(Number.isNaN(percentile([], 50)))
assert.deepEqual(summarise([3, 1, 2, NaN]), { n: 3, median: 2, p95: 3, min: 1, max: 3 })
assert.equal(summarise([]), null)

// --- frames: T is detection + depth; rate comes from the gaps between frames
const frame = (t0: number, yoloMs: number, depthMs: number, hapticAfter: number | null = null): FrameRecord => ({
  t0,
  yoloMs,
  depthMs,
  publishedAt: t0 + yoloMs + Math.max(0, depthMs) + 5,
  hapticAt: hapticAfter == null ? null : t0 + hapticAfter,
  centreM: 2,
})
const run = [frame(0, 100, 400, 510), frame(500, 120, 380), frame(1000, 110, -1), frame(1500, 130, 420, 560)]
const r = frameReport(run)
assert.equal(r.frames, 4)
assert.equal(r.depthMs?.n, 3, 'frames without depth do not count towards depth or T')
assert.equal(r.frameMs?.median, 500)
assert.equal(r.intervalMs?.median, 500)
assert.equal(r.processedFps, 2)
assert.deepEqual(r.toHapticMs && [r.toHapticMs.min, r.toHapticMs.max], [510, 560])
assert.equal(frameReport(run, 600).frames, 2, 'warm-up frames are skipped')
assert.equal(r.detectedFrames, 4)

// --- depth-first frames: detection skipped (yoloMs -1) counts as zero towards T and is
// left out of the YOLO statistics; the decision can land long before the frame ends.
const depthOnly: FrameRecord[] = [
  { t0: 0, yoloMs: 300, depthMs: 400, publishedAt: 405, hapticAt: null, centreM: 3 },
  { t0: 700, yoloMs: -1, depthMs: 400, publishedAt: 1105, hapticAt: 1106, centreM: 2 },
  { t0: 1100, yoloMs: -1, depthMs: 420, publishedAt: 1525, hapticAt: null, centreM: 1.8 },
]
const d = frameReport(depthOnly)
assert.equal(d.detectedFrames, 1)
assert.equal(d.yoloMs?.n, 1, 'skipped detection is not a 0 ms or -1 ms inference')
assert.deepEqual(d.frameMs && [d.frameMs.min, d.frameMs.max], [400, 700])
assert.deepEqual(d.toPublishMs && [d.toPublishMs.min, d.toPublishMs.max], [405, 425])
assert.deepEqual(d.intervalMs && [d.intervalMs.min, d.intervalMs.max], [400, 700])
assert.match(spokenSummary(r), /median 500 milliseconds, 95th percentile 550\. About 2\.0 frames per second/)
assert.equal(spokenSummary(frameReport([])), 'No frames with depth were measured.')

// --- speech: start delay, and frame-to-speech only for warnings
const sp = speechReport([
  { kind: 'warning', calledAt: 1000, startedAt: 1180, frameT0: 400 },
  { kind: 'narration', calledAt: 0, startedAt: 250, frameT0: null },
])
assert.equal(sp.startMs?.max, 250)
assert.equal(sp.warningFromFrameMs?.median, 780)

// --- log round trip, including logcat's prefix and a truncated line
const line = formatRecord('frame', run[0])
const dump = `11-14 10:00:00.000  1234  5678 I ReactNativeJS: ${line}\nnoise\n${line.slice(0, 30)}\n`
const parsed = parseLog(dump)
assert.equal(parsed.length, 1)
assert.deepEqual(parsed[0], { kind: 'frame', record: run[0] })

// --- depth sample: medians, robust to one bad reading
const s = depthSample(3, 99, [
  { left: 1, centre: 1.45, right: 3 },
  { left: 1, centre: 1.55, right: 3 },
  { left: 1, centre: 9.95, right: 3 },
])
assert.equal(s.centreM, 1.55)
assert.equal(s.frames, 3)

// --- place recognition
assert.ok(sameLabel('Library Door', 'library door.'))
assert.ok(!sameLabel(null, 'x'))
const q = (truth: string | null | undefined, ...c: [string, number][]): PlaceQuery => ({
  at: 0,
  truth,
  threshold: 0.85,
  candidates: c.map(([label, similarity]) => ({ label, similarity })),
})
assert.equal(judge(q('kitchen', ['kitchen', 0.9]), 0.85), 'correct')
assert.equal(judge(q('kitchen', ['kitchen', 0.8]), 0.85), 'missed')
assert.equal(judge(q('kitchen', ['lab', 0.9], ['kitchen', 0.88]), 0.85), 'wrong')
assert.equal(judge(q(null, ['lab', 0.84]), 0.85), 'rejected')
assert.equal(judge(q(null, ['lab', 0.86]), 0.85), 'false')

const queries = [
  q('kitchen', ['kitchen', 0.93], ['lab', 0.8]),
  q('lab', ['lab', 0.88], ['kitchen', 0.86]),
  q(null, ['kitchen', 0.84]),
  q(undefined, ['lab', 0.99]), // no truth: ignored by the report
]
const pr = placeReport(queries, [0.8, 0.85, 0.87, 0.9])
assert.equal(pr.genuine, 2)
assert.equal(pr.impostor, 1)
assert.deepEqual(pr.genuineScores, [0.93, 0.88])
assert.deepEqual(pr.impostorScores, [0.8, 0.86, 0.84])
assert.deepEqual(
  pr.sweep.map((x) => [x.tau, x.recognitionRate, x.falseRecognitionRate]),
  [
    [0.8, 1, 1 / 3], // the unsaved room is named at 0.84
    [0.85, 1, 0],
    [0.87, 1, 0],
    [0.9, 0.5, 0],
  ],
)
assert.equal(pr.lowestSafeTau, 0.85)

console.log('measure: ok')
