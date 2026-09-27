// Turns a metric depth map into three "how far is the nearest thing" numbers, one per
// direction zone. No native imports so it runs under plain `node` (see depthZones.test.ts)
// and inside a worklet.

export type ZoneDepths = { left: number; centre: number; right: number }

// Depth Anything V2 Metric-Indoor is trained to 20 m; nothing past 10 m matters indoors.
const MAX_M = 10
const BINS = 100 // 0.1 m each
// Ignore the top of the frame (ceiling, far wall) and the very bottom (own feet, hand).
// Rows are fractions of image height, top = 0.
const ROW_FROM = 0.3
const ROW_TO = 0.9

/**
 * Nearest-decile depth in metres for each third of the frame width.
 *
 * The 10th percentile, not the minimum: one noisy pixel would otherwise read as a wall
 * an arm's length away. Histogram instead of a sort so it stays O(n) on a phone.
 *
 * `depth` is row-major, `width` x `height`, upright (top of scene = row 0).
 */
export function zoneDepths(depth: ArrayLike<number>, width: number, height: number): ZoneDepths {
  'worklet'
  const r0 = Math.floor(height * ROW_FROM)
  const r1 = Math.ceil(height * ROW_TO)
  const out = [0, 0, 0]
  for (let z = 0; z < 3; z++) {
    const c0 = Math.floor((width * z) / 3)
    const c1 = Math.floor((width * (z + 1)) / 3)
    const hist = new Array<number>(BINS).fill(0)
    let n = 0
    for (let y = r0; y < r1; y++) {
      const row = y * width
      for (let x = c0; x < c1; x++) {
        const d = depth[row + x]
        if (!(d >= 0)) continue // NaN or negative: skip rather than poison the bin index
        hist[Math.min(BINS - 1, Math.floor((d / MAX_M) * BINS))]++
        n++
      }
    }
    if (n === 0) {
      out[z] = MAX_M
      continue
    }
    const target = n * 0.1
    let seen = 0
    let bin = 0
    for (; bin < BINS; bin++) {
      seen += hist[bin]
      if (seen >= target) break
    }
    out[z] = ((bin + 0.5) / BINS) * MAX_M
  }
  return { left: out[0], centre: out[1], right: out[2] }
}
