import { zoneDepths } from './depthZones.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}
const near = (a: number, b: number, tol = 0.11) => Math.abs(a - b) <= tol

const W = 30
const H = 30
const fill = (f: (x: number, y: number) => number) => {
  const a = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = f(x, y)
  return a
}

// Open room, everything 5 m away.
{
  const z = zoneDepths(fill(() => 5), W, H)
  assert(near(z.left, 5) && near(z.centre, 5) && near(z.right, 5), 'uniform 5 m')
}

// Wall on the RIGHT third only: the bug this app had was never seeing "right".
{
  const z = zoneDepths(fill((x) => (x >= 20 ? 1 : 5)), W, H)
  assert(near(z.right, 1), `right wall reads ${z.right}`)
  assert(near(z.left, 5) && near(z.centre, 5), 'left and centre stay open')
}

// Wall on the left only.
{
  const z = zoneDepths(fill((x) => (x < 10 ? 0.8 : 5)), W, H)
  assert(near(z.left, 0.8) && near(z.right, 5), 'left wall')
}

// One noisy pixel must not read as an obstacle (that is why it is a percentile).
{
  const a = fill(() => 5)
  a[15 * W + 15] = 0.1
  const z = zoneDepths(a, W, H)
  assert(near(z.centre, 5), `single hot pixel leaked: ${z.centre}`)
}

// Ceiling and floor rows are ignored: a near object only in the top rows is not in path.
{
  const z = zoneDepths(fill((_, y) => (y < 5 ? 0.5 : 5)), W, H)
  assert(near(z.centre, 5), `ceiling leaked: ${z.centre}`)
}

// NaN and negatives are skipped, and an all-invalid zone reports "clear", not a crash.
{
  const z = zoneDepths(fill(() => NaN), W, H)
  assert(z.left === 10 && z.centre === 10 && z.right === 10, 'all NaN -> 10 m')
}

// Beyond range clamps into the last bin instead of indexing out of bounds.
{
  const z = zoneDepths(fill(() => 50), W, H)
  assert(z.centre > 9.9 && z.centre <= 10, `clamp ${z.centre}`)
}

console.log('depthZones: all checks passed')
