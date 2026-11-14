// Measurement logging for the paper's evaluation (review of the updated manuscript,
// comments 2-4): per-frame latency with median and 95th percentile, spoken-warning
// start time, depth samples to compare against a tape measure, and place-recognition
// scores against a known true place.
//
// No native imports, so it runs under plain `node` (see measure.test.ts) and the laptop
// script `scripts/measure-report.ts` can reuse the same summaries.
//
// Every record is one log line, `LUMINA_MEASURE <kind> <json>`, which reaches
// `adb logcat` in debug and release builds alike. That is the export path: no new
// dependency, and nothing written to the phone's storage.

export const TAG = 'LUMINA_MEASURE'

// ---------------------------------------------------------------- record shapes

/** One processed camera frame. Times are `Date.now()` milliseconds. */
export type FrameRecord = {
  /** When the worklet started on this frame (before YOLO). */
  t0: number
  /** -1 when detection was skipped on this frame (depth-first scheduling, App.tsx). */
  yoloMs: number
  /** -1 when depth was not ready or failed on this frame. */
  depthMs: number
  /**
   * When the safety decision (vibration pattern, spoken "Stop") ran on the JS thread
   * with this frame's result. Since depth-first scheduling this is before detection.
   */
  publishedAt: number
  /** When a vibration was dispatched for this frame, or null if none fired. */
  hapticAt: number | null
  /** Centre-zone distance in metres, or null without depth. */
  centreM: number | null
}

/** One utterance: how long the TTS engine took to start speaking. */
export type SpeechRecord = {
  kind: 'warning' | 'alert' | 'narration'
  calledAt: number
  startedAt: number
  /** For a "Stop" warning: the t0 of the frame that triggered it. */
  frameT0: number | null
}

/** One "log distance" sample: the median of several consecutive centre-zone readings. */
export type DepthSample = {
  sample: number
  at: number
  frames: number
  centreM: number
  leftM: number
  rightM: number
}

/** One "where am I" query, with the true place when the tester said it. */
export type PlaceQuery = {
  at: number
  /**
   * The true place: a saved label, `null` for a place that is not saved, or
   * `undefined` for an ordinary query with no ground truth.
   */
  truth?: string | null
  threshold: number
  candidates: { label: string | null; similarity: number }[]
}

export type Kind = 'frame' | 'speech' | 'depth' | 'place' | 'session'

export function formatRecord(kind: Kind, record: object): string {
  return `${TAG} ${kind} ${JSON.stringify(record)}`
}

/** Pulls every record out of a log dump (`adb logcat` output or plain lines). */
export function parseLog(text: string): { kind: Kind; record: any }[] {
  const out: { kind: Kind; record: any }[] = []
  const re = new RegExp(`${TAG} (frame|speech|depth|place|session) (\\{.*\\})\\s*$`)
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line)
    if (m == null) continue
    try {
      out.push({ kind: m[1] as Kind, record: JSON.parse(m[2]) })
    } catch {
      // a line truncated by logcat; skip it rather than fail the report
    }
  }
  return out
}

// ---------------------------------------------------------------- statistics

export type Summary = { n: number; median: number; p95: number; min: number; max: number }

/** Nearest-rank percentile of an ascending array, p in [0, 100]. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

export function summarise(values: number[]): Summary | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  return { n: v.length, median: percentile(v, 50), p95: percentile(v, 95), min: v[0], max: v[v.length - 1] }
}

/** Processing time of one frame: depth, plus detection when it ran. */
export function frameTime(r: FrameRecord): number {
  return Math.max(0, r.yoloMs) + Math.max(0, r.depthMs)
}

export type FrameReport = {
  frames: number
  /** Frames on which detection ran (the rest were depth-only). */
  detectedFrames: number
  yoloMs: Summary | null
  depthMs: Summary | null
  /** Per-frame processing time T: depth, plus detection when it ran. */
  frameMs: Summary | null
  /**
   * Worklet start to the safety decision on the JS thread: how old a distance is when
   * it is acted on. Equal to T (plus the thread hop) when detection ran first.
   */
  toPublishMs: Summary | null
  /** Worklet start to vibration dispatch: detection-to-feedback for haptics. */
  toHapticMs: Summary | null
  /** Time between consecutive processed frames. */
  intervalMs: Summary | null
  /** 1000 / median interval: the processed frame rate, measured rather than derived. */
  processedFps: number | null
}

/**
 * @param skipMs frames in the first `skipMs` after the first frame are dropped as
 * warm-up, as the evaluation protocol says.
 */
export function frameReport(frames: FrameRecord[], skipMs = 0): FrameReport {
  const sorted = [...frames].sort((a, b) => a.t0 - b.t0)
  const start = sorted.length > 0 ? sorted[0].t0 + skipMs : 0
  const f = sorted.filter((r) => r.t0 >= start)
  const withDepth = f.filter((r) => r.depthMs >= 0)
  const intervals: number[] = []
  for (let i = 1; i < f.length; i++) intervals.push(f[i].t0 - f[i - 1].t0)
  const intervalMs = summarise(intervals)
  return {
    frames: f.length,
    detectedFrames: f.filter((r) => r.yoloMs >= 0).length,
    yoloMs: summarise(f.filter((r) => r.yoloMs >= 0).map((r) => r.yoloMs)),
    depthMs: summarise(withDepth.map((r) => r.depthMs)),
    frameMs: summarise(withDepth.map(frameTime)),
    toPublishMs: summarise(f.map((r) => r.publishedAt - r.t0)),
    toHapticMs: summarise(f.filter((r) => r.hapticAt != null).map((r) => (r.hapticAt as number) - r.t0)),
    intervalMs,
    processedFps: intervalMs != null && intervalMs.median > 0 ? 1000 / intervalMs.median : null,
  }
}

export function speechReport(rows: SpeechRecord[]): {
  startMs: Summary | null
  warningFromFrameMs: Summary | null
} {
  return {
    startMs: summarise(rows.map((r) => r.startedAt - r.calledAt)),
    warningFromFrameMs: summarise(
      rows.filter((r) => r.kind === 'warning' && r.frameT0 != null).map((r) => r.startedAt - (r.frameT0 as number)),
    ),
  }
}

/** One sentence for the phone to speak at the end of a session. */
export function spokenSummary(r: FrameReport): string {
  if (r.frames === 0 || r.frameMs == null) return 'No frames with depth were measured.'
  const fps = r.processedFps == null ? '' : ` About ${r.processedFps.toFixed(1)} frames per second.`
  return (
    `Measured ${r.frames} frames. Frame time median ${Math.round(r.frameMs.median)} milliseconds, ` +
    `95th percentile ${Math.round(r.frameMs.p95)}.${fps}`
  )
}

/** Median of centre, left and right over a run of frames, for one "log distance". */
export function depthSample(
  sample: number,
  at: number,
  zones: { left: number; centre: number; right: number }[],
): DepthSample {
  const med = (xs: number[]) => percentile([...xs].sort((a, b) => a - b), 50)
  return {
    sample,
    at,
    frames: zones.length,
    centreM: med(zones.map((z) => z.centre)),
    leftM: med(zones.map((z) => z.left)),
    rightM: med(zones.map((z) => z.right)),
  }
}

// ---------------------------------------------------------------- place recognition

export function sameLabel(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return n(a) === n(b)
}

type Outcome = 'correct' | 'missed' | 'wrong' | 'rejected' | 'false'

/** What the app would have said for one query at threshold `tau`, judged against the truth. */
export function judge(q: PlaceQuery, tau: number): Outcome {
  let best: { label: string; similarity: number } | null = null
  for (const c of q.candidates) {
    if (c.label == null || c.label.trim() === '') continue
    if (best == null || c.similarity > best.similarity) best = { label: c.label, similarity: c.similarity }
  }
  const named = best != null && best.similarity >= tau ? best.label : null
  if (q.truth == null) return named == null ? 'rejected' : 'false'
  if (named == null) return 'missed'
  return sameLabel(named, q.truth) ? 'correct' : 'wrong'
}

export type PlaceReport = {
  /** Queries at a saved place. */
  genuine: number
  /** Queries at a place that was not saved. */
  impostor: number
  /** Best similarity to the true place's own views (genuine queries, when in the top k). */
  genuineScores: number[]
  /** Best similarity to any other place (all queries with a truth). */
  impostorScores: number[]
  /** One row per threshold. */
  sweep: {
    tau: number
    recognitionRate: number
    /** Genuine queries named as the wrong place, plus impostors named at all, over all queries. */
    falseRecognitionRate: number
  }[]
  /** Lowest threshold in the sweep with no false recognitions, or null if none. */
  lowestSafeTau: number | null
}

export function placeReport(queries: PlaceQuery[], taus: number[]): PlaceReport {
  const q = queries.filter((x) => x.truth !== undefined)
  const genuine = q.filter((x) => x.truth != null)
  const genuineScores: number[] = []
  const impostorScores: number[] = []
  for (const x of q) {
    let own = -Infinity
    let other = -Infinity
    for (const c of x.candidates) {
      if (c.label == null) continue
      if (x.truth != null && sameLabel(c.label, x.truth)) own = Math.max(own, c.similarity)
      else other = Math.max(other, c.similarity)
    }
    if (x.truth != null && own > -Infinity) genuineScores.push(own)
    if (other > -Infinity) impostorScores.push(other)
  }
  const sweep = taus.map((tau) => {
    const outcomes = q.map((x) => judge(x, tau))
    const correct = outcomes.filter((o) => o === 'correct').length
    const falses = outcomes.filter((o) => o === 'wrong' || o === 'false').length
    return {
      tau,
      recognitionRate: genuine.length > 0 ? correct / genuine.length : NaN,
      falseRecognitionRate: q.length > 0 ? falses / q.length : NaN,
    }
  })
  const safe = sweep.filter((s) => s.falseRecognitionRate === 0).map((s) => s.tau)
  return {
    genuine: genuine.length,
    impostor: q.length - genuine.length,
    genuineScores,
    impostorScores,
    sweep,
    lowestSafeTau: safe.length > 0 ? Math.min(...safe) : null,
  }
}

// ---------------------------------------------------------------- on-phone session

// A session lives in module state, like the narrator's cooldowns: one at a time, and
// `publish` reaches it without a ref.
let active = false
let frames: FrameRecord[] = []
let sampleCount = 0
// ponytail: an hour at ~2 fps is ~7000 frames; the cap only stops a forgotten session
// growing without bound. The log lines are the real record, not this array.
const MAX_FRAMES = 20000

export function isMeasuring(): boolean {
  return active
}

export function startMeasuring(now: number = Date.now()): void {
  active = true
  frames = []
  console.log(formatRecord('session', { event: 'start', at: now }))
}

/** Ends the session and returns its summary (no warm-up skipped on the phone). */
export function stopMeasuring(now: number = Date.now()): FrameReport {
  active = false
  const report = frameReport(frames)
  console.log(formatRecord('session', { event: 'stop', at: now, frames: frames.length }))
  frames = []
  return report
}

export function recordFrame(r: FrameRecord): void {
  if (!active) return
  if (frames.length < MAX_FRAMES) frames.push(r)
  console.log(formatRecord('frame', r))
}

export function recordSpeech(r: SpeechRecord): void {
  if (!active) return
  console.log(formatRecord('speech', r))
}

/** Depth samples and place queries are logged whether or not a session is running. */
export function nextSampleNumber(): number {
  sampleCount += 1
  return sampleCount
}

export function recordDepthSample(s: DepthSample): void {
  console.log(formatRecord('depth', s))
}

export function recordPlaceQuery(q: PlaceQuery): void {
  console.log(formatRecord('place', q))
}
