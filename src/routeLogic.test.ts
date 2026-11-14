// Run with: node src/routeLogic.test.ts
import assert from 'node:assert'
import {
  type Checkpoint,
  cosine,
  describeLeg,
  legsOf,
  makeFollower,
  makeRecorder,
  makeStepDetector,
  makeTurnDetector,
  yawRate,
} from './routeLogic.ts'

// --- steps: one per bounce, none for standing still, none for a double-count
{
  const step = makeStepDetector()
  let n = 0
  // 2 Hz walk for 5 s at 20 Hz sampling: a 3 m/s² bounce on top of gravity.
  for (let i = 0; i < 100; i++) {
    const t = i * 50
    if (step(9.81 + 3 * Math.sin((2 * Math.PI * 2 * t) / 1000), t)) n++
  }
  assert.equal(n, 10, 'ten steps in five seconds at 2 Hz')
  const still = makeStepDetector()
  for (let i = 0; i < 100; i++) assert.equal(still(9.81 + 0.3 * Math.sin(i), i * 50), false)
}

// --- yaw: positive is left, whatever the tilt
{
  // Phone flat, screen up: "down" is -z, and a counter-clockwise spin is +z.
  assert.ok(yawRate({ x: 0, y: 0, z: 90 }, { x: 0, y: 0, z: -9.81 }) > 89)
  // Phone upright in portrait: "down" is -y, turning left spins about +y.
  assert.ok(yawRate({ x: 0, y: 90, z: 0 }, { x: 0, y: -9.81, z: 0 }) > 89)
  // Tipping the phone forward (about x) while upright is not a turn.
  assert.ok(Math.abs(yawRate({ x: 90, y: 0, z: 0 }, { x: 0, y: -9.81, z: 0 })) < 1e-9)
}

// --- turns
const spin = (turn: ReturnType<typeof makeTurnDetector>, rate: number, seconds: number, t0: number) => {
  let out: string | null = null
  let t = t0
  for (let i = 0; i < seconds * 20; i++) {
    t += 50
    out = turn(rate, 0.05, t) ?? out
  }
  return { out, t }
}
{
  const turn = makeTurnDetector()
  let r = spin(turn, 90, 1, 0) // 90° left in a second
  assert.equal(r.out, null, 'not reported mid-turn')
  r = spin(turn, 0, 1, r.t)
  assert.equal(r.out, 'left')
  r = spin(turn, -90, 1, r.t)
  r = spin(turn, 0, 1, r.t)
  assert.equal(r.out, 'right')
  r = spin(turn, 120, 1.5, r.t)
  r = spin(turn, 0, 1, r.t)
  assert.equal(r.out, 'around')
  // A wobble and a slow drift are not turns.
  const calm = makeTurnDetector()
  r = spin(calm, 60, 0.5, 0) // 30°
  r = spin(calm, 0, 1, r.t)
  assert.equal(r.out, null, '30 degree wobble')
  r = spin(calm, 3, 60, r.t) // 180° over a minute: a curving corridor or gyro drift
  assert.equal(r.out, null, 'slow drift')
}

// --- recording gives back the legs that were walked
const view = (i: number) => {
  const v = new Array(8).fill(0)
  v[i] = 1
  return v
}
let route: Checkpoint[]
{
  const rec = makeRecorder()
  for (let i = 0; i < 12; i++) rec.onStep()
  rec.addView({ leg: 0, step: 6 }, view(0))
  rec.onTurn('left').descriptor = view(1)
  for (let i = 0; i < 20; i++) rec.onStep()
  rec.onTurn('right') // its photo failed: no descriptor
  for (let i = 0; i < 4; i++) rec.onStep()
  assert.equal(rec.totalSteps, 36)
  route = rec.finish(view(2))
  assert.deepEqual(legsOf(route), [
    { steps: 12, then: 'left' },
    { steps: 20, then: 'right' },
    { steps: 4, then: 'arrive' },
  ])
  assert.equal(describeLeg({ steps: 12, then: 'left' }), 'Walk about 12 steps, then turn left.')
  assert.equal(describeLeg({ steps: 1, then: 'around' }), 'Turn around.')
}

// --- following it
{
  const f = makeFollower('library', route)
  assert.equal(f.start(), 'Route to library. Walk about 12 steps, then turn left.')
  const said: string[] = []
  const walk = (n: number) => {
    for (let i = 0; i < n; i++) {
      const s = f.onStep()
      if (s) said.push(s)
    }
  }
  walk(12)
  assert.deepEqual(said, ['Turn left in 5 steps.', 'Turn left now.'])
  assert.equal(f.onTurn('left'), 'Walk about 20 steps, then turn right.')
  // A wrong turn, then undoing it.
  walk(3)
  assert.equal(f.onTurn('left'), 'That turn is not on the route. Turn right to get back.')
  assert.equal(f.onStep(), null, 'steps while off the route do not count')
  assert.equal(f.onTurn('right'), 'Back on the route. Keep going.')
  assert.deepEqual(f.position, { leg: 1, step: 3 })
  // Turning a little early is still the turn: step counts differ walk to walk.
  walk(13)
  assert.equal(f.onTurn('right'), 'Walk about 4 steps, then you arrive.')
  said.length = 0
  walk(4)
  assert.deepEqual(said, ['You have arrived at library.'])
  assert.equal(f.done, true)
}

// --- walking past the turn
{
  const f = makeFollower('library', route)
  f.start()
  const said: string[] = []
  for (let i = 0; i < 18; i++) {
    const s = f.onStep()
    if (s) said.push(s)
  }
  assert.equal(said.at(-1), 'You may have passed the turn. Turn left when you can.')
}

// --- views: snap the count, never to another leg, and notice a wrong corridor
{
  const f = makeFollower('library', route)
  f.start()
  f.onStep()
  assert.equal(f.onView(view(0)).say, null)
  assert.deepEqual(f.position, { leg: 0, step: 6 }, 'snapped to the checkpoint at step 6')
  // view(2) is the arrival view, on leg 2: it must not match from leg 0.
  assert.equal(f.onView(view(2)).best, 0)
  assert.deepEqual(f.position, { leg: 0, step: 6 })
  assert.equal(f.onView(view(5)).say, null)
  assert.equal(f.onView(view(5)).say, 'This does not look like the route. You may be off it.')
  assert.equal(cosine(view(1), []), 0, 'a failed photo matches nothing')
}

console.log('routeLogic: all checks passed')
