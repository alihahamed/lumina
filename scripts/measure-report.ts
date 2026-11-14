// Turns a phone log into the numbers the paper's evaluation needs (src/measure.ts).
//
//   adb logcat -c                                   # clear old lines first
//   adb logcat -s ReactNativeJS:V > run.log         # leave running during the test
//   node scripts/measure-report.ts run.log [--warmup 60] [--depth-truth truth.csv]
//                                          [--device device.csv]
//
// --warmup     seconds dropped from the start of each session (default 60)
// --depth-truth CSV with header `sample,true_m` (extra columns such as target,light are
//              printed alongside): the tape-measured distance for each "log distance"
// --device     CSV written by scripts/device-monitor.sh (battery level and temperature)
import { readFileSync } from 'node:fs'
import {
  frameReport,
  frameTime,
  percentile,
  parseLog,
  placeReport,
  speechReport,
  summarise,
  type DepthSample,
  type FrameRecord,
  type PlaceQuery,
  type SpeechRecord,
  type Summary,
} from '../src/measure.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

const file = process.argv[2]
if (file == null || file.startsWith('--')) {
  console.error('usage: node scripts/measure-report.ts run.log [--warmup 60] [--depth-truth truth.csv] [--device device.csv]')
  process.exit(1)
}
const warmupMs = Number(arg('--warmup') ?? '60') * 1000
const records = parseLog(readFileSync(file, 'utf8'))

const fmt = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '-')
function row(name: string, s: Summary | null, d = 0): string {
  if (s == null) return `  ${name.padEnd(36)} (no data)`
  return `  ${name.padEnd(36)} n=${String(s.n).padStart(5)}  median ${fmt(s.median, d).padStart(7)}  p95 ${fmt(s.p95, d).padStart(7)}  min ${fmt(s.min, d).padStart(7)}  max ${fmt(s.max, d).padStart(7)}`
}
function csv(path: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(path, 'utf8').trim().split(/\r?\n/)
  const keys = head.split(',').map((k) => k.trim())
  return lines.filter((l) => l.trim() !== '').map((l) => {
    const v = l.split(',')
    return Object.fromEntries(keys.map((k, i) => [k, (v[i] ?? '').trim()]))
  })
}

// ---------------------------------------------------------------- latency, per session
const frames = records.filter((r) => r.kind === 'frame').map((r) => r.record as FrameRecord)
const speech = records.filter((r) => r.kind === 'speech').map((r) => r.record as SpeechRecord)
const starts = records.filter((r) => r.kind === 'session' && r.record.event === 'start').map((r) => r.record.at as number)
const stops = records.filter((r) => r.kind === 'session' && r.record.event === 'stop').map((r) => r.record.at as number)

console.log(`\n=== Latency (${starts.length} session(s), first ${warmupMs / 1000} s of each dropped) ===`)
const sessions = starts.map((start) => {
  const end = stops.find((s) => s > start) ?? Infinity
  return { start, end, frames: frames.filter((f) => f.t0 >= start && f.t0 <= end) }
})
const kept: FrameRecord[] = []
sessions.forEach((s, i) => {
  const r = frameReport(s.frames, warmupMs)
  const mins = Number.isFinite(s.end) ? ((s.end - s.start) / 60000).toFixed(1) : '?'
  console.log(`\nSession ${i + 1}: ${new Date(s.start).toISOString()}, ${mins} min, ${r.frames} frames after warm-up`)
  console.log(`  Detection ran on ${r.detectedFrames} of ${r.frames} frames (the rest were depth-only)`)
  console.log(row('YOLO26n inference (ms)', r.yoloMs))
  console.log(row('Depth inference (ms)', r.depthMs))
  console.log(row('T = depth (+ detection if run) (ms)', r.frameMs))
  console.log(row('Age of distance at decision (ms)', r.toPublishMs))
  console.log(row('Frame start -> vibration (ms)', r.toHapticMs))
  console.log(row('Interval between frames (ms)', r.intervalMs))
  console.log(`  Processed frame rate                 ${r.processedFps == null ? '-' : r.processedFps.toFixed(2)} fps`)
  const first = s.frames.length > 0 ? s.frames[0].t0 + warmupMs : 0
  kept.push(...s.frames.filter((f) => f.t0 >= first))
})
if (sessions.length > 1) {
  const all = frameReport(kept)
  console.log(`\nAll sessions pooled (${all.frames} frames)`)
  console.log(row('T = depth (+ detection if run) (ms)', all.frameMs))
  console.log(row('Age of distance at decision (ms)', all.toPublishMs))
  console.log(row('Interval between frames (ms)', all.intervalMs))
  console.log(`  Processed frame rate                 ${all.processedFps == null ? '-' : all.processedFps.toFixed(2)} fps`)
}
const all = frameReport(kept)
if (all.toPublishMs != null && all.intervalMs != null) {
  // The paper's Eq. (1), generalised. A distance is `age` old when it is acted on, and a
  // threshold crossed just after a frame is seen one `interval` later, so the user covers
  // v(age + t_s) .. v(age + interval + t_s) before the cue. With detection before depth on
  // every frame, age = interval = T and this is the paper's v(T + t_s) .. v(2T + t_s).
  // 95th percentiles of each: conservative, since the two are not independent.
  const sp = speechReport(speech)
  const age = all.toPublishMs.p95 / 1000
  const gap = all.intervalMs.p95 / 1000
  const ts = (sp.startMs?.p95 ?? 200) / 1000
  const v = 1.2
  console.log(`\nEq. (1) with p95 age = ${age.toFixed(3)} s, p95 interval = ${gap.toFixed(3)} s, t_s = ${ts.toFixed(3)} s ${sp.startMs == null ? '(assumed, no speech measured)' : '(p95 measured)'}, v = ${v} m/s:`)
  for (const [cue, th, s] of [['Light vibration', 2.5, 0], ['Double vibration', 1.6, 0], ['Spoken "Stop"', 1.0, ts]] as const) {
    console.log(`  ${cue.padEnd(18)} ${th.toFixed(1)} m: margin best ${(th - v * (age + s)).toFixed(2)} m, worst ${(th - v * (age + gap + s)).toFixed(2)} m`)
  }
}

console.log('\n=== Speech ===')
const sp = speechReport(speech)
console.log(row('Speech start delay t_s (ms)', sp.startMs))
console.log(row('"Stop": frame start -> speech (ms)', sp.warningFromFrameMs))

// ---------------------------------------------------------------- depth vs tape
const samples = records.filter((r) => r.kind === 'depth').map((r) => r.record as DepthSample)
console.log(`\n=== Depth samples (${samples.length}) ===`)
const truthPath = arg('--depth-truth')
if (truthPath == null) {
  for (const s of samples) console.log(`  sample ${s.sample}: centre ${s.centreM.toFixed(2)} m (left ${s.leftM.toFixed(2)}, right ${s.rightM.toFixed(2)}, ${s.frames} frames)`)
  if (samples.length > 0) console.log('  Pass --depth-truth truth.csv (sample,true_m,...) to compute the error.')
} else {
  const truth = csv(truthPath)
  const signed: number[] = []
  for (const t of truth) {
    const s = samples.find((x) => x.sample === Number(t.sample))
    if (s == null) {
      console.log(`  sample ${t.sample}: not in the log`)
      continue
    }
    const trueM = Number(t.true_m)
    const err = s.centreM - trueM
    signed.push(err)
    const extra = Object.entries(t).filter(([k]) => k !== 'sample' && k !== 'true_m').map(([k, v]) => `${k}=${v}`).join(' ')
    console.log(`  sample ${String(s.sample).padStart(3)}: true ${trueM.toFixed(2)} m, estimated ${s.centreM.toFixed(2)} m, error ${err >= 0 ? '+' : ''}${err.toFixed(2)} m  ${extra}`)
  }
  console.log(row('Signed error (m)', summarise(signed), 2))
  console.log(row('Absolute error (m)', summarise(signed.map(Math.abs)), 2))
  console.log('  (positive error = the phone thinks the obstacle is further away than it is: the dangerous direction)')
}

// ---------------------------------------------------------------- place recognition
const places = records.filter((r) => r.kind === 'place').map((r) => r.record as PlaceQuery)
const taus = Array.from({ length: 29 }, (_, i) => Math.round((0.7 + i * 0.01) * 100) / 100)
const pr = placeReport(places, taus)
console.log(`\n=== Place recognition (${pr.genuine} at saved places, ${pr.impostor} at unsaved places) ===`)
console.log(row('Genuine: best own-place score', summarise(pr.genuineScores), 3))
console.log(row('Impostor: best other-place score', summarise(pr.impostorScores), 3))
if (pr.genuine + pr.impostor > 0) {
  console.log('  tau   recognised  false recognitions')
  for (const s of pr.sweep) console.log(`  ${s.tau.toFixed(2)}  ${fmt(s.recognitionRate * 100, 1).padStart(9)}%  ${fmt(s.falseRecognitionRate * 100, 1).padStart(9)}%`)
  console.log(`  Lowest tau with no false recognitions: ${pr.lowestSafeTau ?? 'none in 0.70-0.98'}`)
  console.log('  Choose tau on one half of the visits and report the rates on the other half (paper, Section VI-F).')
}

// ---------------------------------------------------------------- battery and heat
const devicePath = arg('--device')
if (devicePath != null) {
  const d = csv(devicePath)
  console.log(`\n=== Battery and temperature (${d.length} readings) ===`)
  if (d.length >= 2) {
    const first = d[0]
    const last = d[d.length - 1]
    const mins = (Number(last.epoch_s) - Number(first.epoch_s)) / 60
    const drop = Number(first.level) - Number(last.level)
    console.log(`  ${mins.toFixed(1)} min: battery ${first.level}% -> ${last.level}% (${drop} points, ${(drop / (mins / 60)).toFixed(1)} %/h)`)
    console.log(row('Battery temperature (C)', summarise(d.map((r) => Number(r.battery_temp_c))), 1))
    if (d.some((r) => r.plugged !== '0')) console.log('  WARNING: the phone was on power for some readings; use wireless adb for the battery test.')
  }
  // Older CSVs (before CPU columns were added) stop here.
  if (d.length > 0 && d[0].cpu_temp_c != null) {
    const num = (k: string) => d.map((r) => Number(r[k])).filter(Number.isFinite)
    console.log(row('CPU temperature (C)', summarise(num('cpu_temp_c')), 1))
    console.log(row('Skin temperature (C)', summarise(num('skin_temp_c')), 1))
    console.log(row('Big-core clock (MHz)', summarise(num('freq_big_khz').map((k) => k / 1000))))
    const throttled = d.filter((r) => Number(r.cpu_cooling) > 0 || Number(r.thermal_status) > 0).length
    console.log(`  Readings with the thermal framework throttling: ${throttled} of ${d.length}`)

    // Review comment 3: is the frame-time variation thermal? Each device reading is
    // matched with the frames processed in the interval before it (same phone clock),
    // then grouped. If T rises with CPU temperature, or with throttling on, the cause
    // is thermal; if T varies just as much at a steady temperature, it is not.
    type Row = { cpu: number; big: number; throttled: boolean; T: number[] }
    const rows: Row[] = []
    for (let i = 1; i < d.length; i++) {
      const from = Number(d[i - 1].epoch_s) * 1000
      const to = Number(d[i].epoch_s) * 1000
      const T = kept.filter((f) => f.t0 >= from && f.t0 < to && f.depthMs >= 0).map(frameTime)
      if (T.length === 0) continue
      rows.push({
        cpu: Number(d[i].cpu_temp_c),
        big: Number(d[i].freq_big_khz) / 1000,
        throttled: Number(d[i].cpu_cooling) > 0 || Number(d[i].thermal_status) > 0,
        T,
      })
    }
    if (rows.length > 0) {
      console.log('\n  Frame time T against device state (frames after warm-up only):')
      const buckets = new Map<number, number[]>()
      for (const r of rows) {
        const b = Math.floor(r.cpu / 5) * 5
        buckets.set(b, [...(buckets.get(b) ?? []), ...r.T])
      }
      for (const b of [...buckets.keys()].sort((x, y) => x - y)) {
        console.log(row(`CPU ${b}-${b + 5} C: T (ms)`, summarise(buckets.get(b) ?? [])))
      }
      console.log(row('Throttling on: T (ms)', summarise(rows.filter((r) => r.throttled).flatMap((r) => r.T))))
      console.log(row('Throttling off: T (ms)', summarise(rows.filter((r) => !r.throttled).flatMap((r) => r.T))))
      const pairs = rows.map((r) => [r.cpu, percentile([...r.T].sort((a, b) => a - b), 50)] as const)
      console.log(`  Spearman correlation, CPU temperature vs median T per reading: ${fmt(spearman(pairs), 2)} (n=${pairs.length})`)
      const clocks = rows.map((r) => [r.big, percentile([...r.T].sort((a, b) => a - b), 50)] as const)
      console.log(`  Spearman correlation, big-core clock vs median T per reading:  ${fmt(spearman(clocks), 2)} (n=${clocks.length})`)
    }
  }
}

/** Rank correlation, ties given their average rank. NaN for fewer than 3 pairs. */
function spearman(pairs: readonly (readonly [number, number])[]): number {
  if (pairs.length < 3) return NaN
  const rank = (xs: number[]) => {
    const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0])
    const r = new Array<number>(xs.length)
    for (let i = 0; i < order.length; ) {
      let j = i
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
      for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1
      i = j + 1
    }
    return r
  }
  const a = rank(pairs.map((p) => p[0]))
  const b = rank(pairs.map((p) => p[1]))
  const mean = (a.length + 1) / 2
  let num = 0, da = 0, db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - mean) * (b[i] - mean)
    da += (a[i] - mean) ** 2
    db += (b[i] - mean) ** 2
  }
  return da === 0 || db === 0 ? NaN : num / Math.sqrt(da * db)
}
console.log('')
