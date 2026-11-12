// Route memory without ARCore: a route is steps and turns, with a picture-descriptor
// checkpoint every few steps to correct the step count and notice a wrong corridor.
// Steps + turns alone is the UCSC backtracking app (arXiv 2401.08021); checkpoints in
// sequence is visual teach-and-repeat (GuideNav, arXiv 2512.06147). docs/decisions.md.
//
// No native imports, so it runs under plain `node` (see routeLogic.test.ts).

export type Turn = 'left' | 'right' | 'around'

const GRAVITY = 9.81

/**
 * Counts a step when vertical bounce pushes acceleration well past gravity, then waits
 * for it to settle before the next. Our own detector rather than Android's step
 * counter: that one reports in batches, seconds late, which is useless for "turn now".
 * ponytail: fixed thresholds, tuned on nobody's gait. If steps are missed or doubled,
 * these two numbers and STEP_MIN_GAP_MS are the knobs.
 */
export const STEP_RISE = 1.6
export const STEP_FALL = 0.4
export const STEP_MIN_GAP_MS = 280

export function makeStepDetector() {
  let armed = true
  let lastAt = -Infinity
  /** @param magnitude |acceleration including gravity|, m/s². @returns true on a step. */
  return (magnitude: number, nowMs: number): boolean => {
    const bounce = magnitude - GRAVITY
    if (!armed) {
      if (bounce < STEP_FALL) armed = true
      return false
    }
    if (bounce > STEP_RISE && nowMs - lastAt >= STEP_MIN_GAP_MS) {
      armed = false
      lastAt = nowMs
      return true
    }
    return false
  }
}

/**
 * Turn rate about the vertical, in deg/s, positive = turning left.
 *
 * Projecting the gyroscope onto "up" makes this independent of how the phone is tilted
 * in the hand. `down` is expo-sensors' accelerationIncludingGravity, which on Android
 * is (accelerometer - 2 * gravity) and so points at the floor at rest; Android's
 * gyroscope is counter-clockwise positive (DeviceMotionModule.kt).
 */
export function yawRate(
  gyro: { x: number; y: number; z: number },
  down: { x: number; y: number; z: number },
): number {
  const n = Math.hypot(down.x, down.y, down.z)
  if (n < 1e-6) return 0
  return -(gyro.x * down.x + gyro.y * down.y + gyro.z * down.z) / n
}

/** Past this much heading change, something is a turn and not a wobble. */
export const TURN_MIN_DEG = 55
/** A turn is over once rotation has stayed under this rate for TURN_SETTLE_MS. */
export const TURN_QUIET_DEG_S = 25
export const TURN_SETTLE_MS = 400
/** While walking straight, the reference heading follows the phone this fast (per second). */
const DRIFT_FOLLOW = 0.15

/**
 * Turns, quantised to 90°, from integrated turn rate. No compass: indoors, steel and
 * wiring make it lie. Gyro drift and gentle corridor curves are absorbed by letting the
 * reference heading creep toward the current one while the phone is not rotating.
 * ponytail: 90° only, like the UCSC study's building. A 45° junction reads as nothing
 * or as 90°. Add a 45° bucket if a real route needs it.
 */
export function makeTurnDetector() {
  let heading = 0
  let ref = 0
  let quietSince: number | null = null
  return (rateDegS: number, dtS: number, nowMs: number): Turn | null => {
    heading += rateDegS * dtS
    if (Math.abs(rateDegS) >= TURN_QUIET_DEG_S) {
      quietSince = null
      return null
    }
    quietSince ??= nowMs
    const off = heading - ref
    if (Math.abs(off) < TURN_MIN_DEG) {
      ref += off * Math.min(1, DRIFT_FOLLOW * dtS)
      return null
    }
    if (nowMs - quietSince < TURN_SETTLE_MS) return null
    const quarters = Math.round(off / 90)
    ref = heading
    if (quarters === 0) return null
    if (Math.abs(quarters) >= 2) return 'around'
    return quarters > 0 ? 'left' : 'right'
  }
}

/** One saved view along the route. `turn` is what the walker did right here. */
export interface Checkpoint {
  /** Which straight stretch this is on, from 0. */
  leg: number
  /** Steps walked on this leg when the view was taken. */
  step: number
  turn?: Turn | 'arrive'
  descriptor: number[]
}

export interface Leg {
  steps: number
  /** What ends this leg. */
  then: Turn | 'arrive'
}

/** The walking instructions, read back out of the checkpoints. */
export function legsOf(checkpoints: Checkpoint[]): Leg[] {
  const legs: Leg[] = []
  for (const c of checkpoints) {
    if (c.turn != null) legs[c.leg] = { steps: c.step, then: c.turn }
  }
  return legs
}

const turnWords = (t: Turn | 'arrive') => (t === 'arrive' ? 'you arrive' : t === 'around' ? 'turn around' : `turn ${t}`)

const sentence = (s: string) => s[0].toUpperCase() + s.slice(1)

export function describeLeg(leg: Leg): string {
  const walk = leg.steps <= 2 ? '' : `walk about ${leg.steps} steps, then `
  return sentence(`${walk}${turnWords(leg.then)}.`)
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}

/**
 * A view this similar to a checkpoint on the current leg moves the step count there.
 * ponytail: guesses, like MATCH_THRESHOLD in placeMatch.ts. CLIP scores one corridor
 * close to the next, so SNAP is high and OFF_ROUTE low on purpose: doing nothing is
 * safer than jumping to the wrong place. Tune from the `route view` log lines.
 */
export const SNAP_SIMILARITY = 0.9
export const OFF_ROUTE_SIMILARITY = 0.6
export const OFF_ROUTE_STRIKES = 3
/** Say "turn in N steps" this far ahead, and give up waiting this far past. */
export const WARN_STEPS = 5
export const OVERSHOOT_STEPS = 6

const opposite = (t: Turn): Turn => (t === 'left' ? 'right' : t === 'right' ? 'left' : 'around')

/**
 * Follows a recorded route: feed it steps, turns and views, speak what it returns.
 * Only the current leg's checkpoints are ever matched (sequence matching): the same
 * door seen on another leg must not teleport the walker there.
 */
export function makeFollower(name: string, checkpoints: Checkpoint[]) {
  const legs = legsOf(checkpoints)
  let leg = 0
  let step = 0
  let warned = false
  let told = false
  let overshot = false
  let done = legs.length === 0
  let strikes = 0
  /** The turn that undoes a wrong one, while off the route. */
  let undo: Turn | null = null

  const startLeg = (): string => {
    step = 0
    warned = told = overshot = false
    return describeLeg(legs[leg])
  }

  return {
    get done() {
      return done
    },
    get position() {
      return { leg, step }
    },
    start(): string {
      if (done) return `The route to ${name} is empty.`
      return `Route to ${name}. ${startLeg()}`
    },
    onStep(): string | null {
      if (done || undo != null) return null
      step++
      const { steps, then } = legs[leg]
      const left = steps - step
      if (then === 'arrive') {
        if (left > 0) return null
        done = true
        return `You have arrived at ${name}.`
      }
      if (left === WARN_STEPS && steps >= WARN_STEPS * 2 && !warned) {
        warned = true
        return sentence(`${turnWords(then)} in ${WARN_STEPS} steps.`)
      }
      if (left <= 0 && !told) {
        told = true
        return sentence(`${turnWords(then)} now.`)
      }
      if (-left >= OVERSHOOT_STEPS && !overshot) {
        overshot = true
        return `You may have passed the turn. ${sentence(turnWords(then))} when you can.`
      }
      return null
    },
    onTurn(turn: Turn): string | null {
      if (done) return null
      if (undo != null) {
        if (turn !== undo) return null
        undo = null
        return 'Back on the route. Keep going.'
      }
      const { steps, then } = legs[leg]
      // Close enough to where the turn was recorded: step counts differ walk to walk.
      const near = steps - step <= Math.max(WARN_STEPS, Math.round(steps * 0.3))
      if (turn === then && near) {
        leg++
        return startLeg()
      }
      undo = opposite(turn)
      // ponytail: one wrong turn at a time. A second turn while lost is ignored
      // unless it is the undo, so two wrong turns in a row need a restart.
      return `That turn is not on the route. ${sentence(turnWords(undo))} to get back.`
    },
    /** @returns words to speak (or null), and the best similarity for the log. */
    onView(descriptor: ArrayLike<number>): { say: string | null; best: number } {
      if (done || undo != null) return { say: null, best: 0 }
      let best = 0
      let at: Checkpoint | null = null
      for (const c of checkpoints) {
        if (c.leg !== leg) continue
        const s = cosine(descriptor, c.descriptor)
        if (s > best) {
          best = s
          at = c
        }
      }
      if (at != null && best >= SNAP_SIMILARITY) {
        strikes = 0
        // Never move the count after a spoken "turn now", or it would repeat.
        if (Math.abs(at.step - step) > 3 && !told) {
          step = at.step
          warned = legs[leg].steps - step < WARN_STEPS
        }
        return { say: null, best }
      }
      if (best < OFF_ROUTE_SIMILARITY) {
        strikes++
        if (strikes === OFF_ROUTE_STRIKES) return { say: 'This does not look like the route. You may be off it.', best }
      } else strikes = 0
      return { say: null, best }
    },
  }
}

/** Collects a route while it is walked. */
export function makeRecorder() {
  const checkpoints: Checkpoint[] = []
  let leg = 0
  let step = 0
  let total = 0
  return {
    get position() {
      return { leg, step }
    },
    get totalSteps() {
      return total
    },
    onStep() {
      step++
      total++
    },
    /** A turn ends the leg. The view for it is attached later, when the photo is ready. */
    onTurn(turn: Turn): Checkpoint {
      const c: Checkpoint = { leg, step, turn, descriptor: [] }
      checkpoints.push(c)
      leg++
      step = 0
      return c
    },
    /** A plain view, stamped with where the walker was when the photo was requested. */
    addView(at: { leg: number; step: number }, descriptor: number[]) {
      checkpoints.push({ ...at, descriptor })
    },
    finish(descriptor: number[]): Checkpoint[] {
      checkpoints.push({ leg, step, turn: 'arrive', descriptor })
      // Turn checkpoints whose photo failed keep an empty descriptor; cosine() scores
      // those 0, so they still give the instruction and never match a view.
      return [...checkpoints].sort((a, b) => a.leg - b.leg || a.step - b.step || (a.turn ? 1 : 0) - (b.turn ? 1 : 0))
    },
  }
}
