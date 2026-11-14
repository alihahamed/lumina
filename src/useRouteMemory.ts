import { DeviceMotion } from 'expo-sensors'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  makeFollower,
  makeRecorder,
  makeStepDetector,
  makeTurnDetector,
  type Turn,
  yawRate,
} from './routeLogic'
import { loadRoute, saveRoute } from './routes'

// How often a view is saved while recording, and checked while following, in steps.
// ponytail: guesses. Fewer steps = better correction, more camera and CLIP time.
const RECORD_VIEW_EVERY = 8
const FOLLOW_VIEW_EVERY = 6
const SENSOR_INTERVAL_MS = 50
/** A route this short is a mis-spoken command, not a route. */
const MIN_ROUTE_STEPS = 3

type Mode = 'idle' | 'recording' | 'following'

/**
 * Route memory: "start route to X" … walk … "end route", later "take me to X".
 * Steps and turns come from the motion sensors, views from the camera through
 * `capture`. The decisions are all in routeLogic.ts; this file is the wiring.
 *
 * @param capture a CLIP descriptor of what the camera sees now, or null when the
 *   camera is busy or the photo failed. Called every few steps.
 * @param say speaks one sentence, interrupting narration.
 */
export function useRouteMemory(capture: () => Promise<number[] | null>, say: (text: string) => void) {
  const [status, setStatus] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const modeRef = useRef<Mode>('idle')
  const name = useRef('')
  const recorder = useRef<ReturnType<typeof makeRecorder> | null>(null)
  const follower = useRef<ReturnType<typeof makeFollower> | null>(null)
  // The sensor listener outlives renders, so it reaches the latest props through refs.
  const captureRef = useRef(capture)
  captureRef.current = capture
  const sayRef = useRef(say)
  sayRef.current = say

  const go = (m: Mode) => {
    modeRef.current = m
    setMode(m)
    if (m === 'idle') setStatus(null)
  }

  const onStep = useCallback(() => {
    const rec = recorder.current
    const fol = follower.current
    if (modeRef.current === 'recording' && rec != null) {
      rec.onStep()
      const at = rec.position
      setStatus(`recording ${name.current} · leg ${at.leg + 1} · step ${at.step}`)
      console.log('route rec step', at.leg, at.step)
      if (at.step % RECORD_VIEW_EVERY === 0) {
        void captureRef.current().then((d) => {
          if (d != null) rec.addView(at, d)
          console.log('route rec view', at.leg, at.step, d != null)
        })
      }
    } else if (modeRef.current === 'following' && fol != null) {
      const said = fol.onStep()
      const at = fol.position
      setStatus(`to ${name.current} · leg ${at.leg + 1} · step ${at.step}`)
      console.log('route step', at.leg, at.step, said ?? '')
      if (said != null) sayRef.current(said)
      if (fol.done) return go('idle')
      if (at.step % FOLLOW_VIEW_EVERY === 0) {
        void captureRef.current().then((d) => {
          if (d == null || modeRef.current !== 'following') return
          const r = fol.onView(d)
          // The number to tune SNAP_SIMILARITY and OFF_ROUTE_SIMILARITY from.
          console.log('route view', at.leg, at.step, r.best.toFixed(3), '→', fol.position.step, r.say ?? '')
          if (r.say != null) sayRef.current(r.say)
        })
      }
    }
  }, [])

  const onTurn = useCallback((turn: Turn) => {
    console.log('route turn', turn, modeRef.current)
    const rec = recorder.current
    const fol = follower.current
    if (modeRef.current === 'recording' && rec != null) {
      const c = rec.onTurn(turn)
      // Said back so the person recording knows it was caught, and can redo it if not.
      sayRef.current(turn === 'around' ? 'Turned around.' : `${turn} turn.`)
      void captureRef.current().then((d) => {
        if (d != null) c.descriptor = d
      })
    } else if (modeRef.current === 'following' && fol != null) {
      const said = fol.onTurn(turn)
      if (said != null) sayRef.current(said)
    }
  }, [])

  useEffect(() => {
    if (mode === 'idle') return
    const step = makeStepDetector()
    const turn = makeTurnDetector()
    // Walking shakes the accelerometer; "down" is its slow average.
    let down: { x: number; y: number; z: number } | null = null
    let last = Date.now()
    DeviceMotion.setUpdateInterval(SENSOR_INTERVAL_MS)
    const sub = DeviceMotion.addListener((m) => {
      const a = m.accelerationIncludingGravity
      const g = m.rotationRate
      if (a == null || g == null) return
      const now = Date.now()
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      down = down == null ? a : { x: down.x * 0.9 + a.x * 0.1, y: down.y * 0.9 + a.y * 0.1, z: down.z * 0.9 + a.z * 0.1 }
      if (step(Math.hypot(a.x, a.y, a.z), now)) onStep()
      // rotationRate's alpha/beta/gamma are the gyroscope's x/y/z (DeviceMotionModule.kt),
      // whatever the type comment says.
      const t = turn(yawRate({ x: g.alpha, y: g.beta, z: g.gamma }, down), dt, now)
      if (t != null) onTurn(t)
    })
    return () => sub.remove()
  }, [mode, onStep, onTurn])

  const startRecording = useCallback((to: string) => {
    name.current = to
    follower.current = null
    const rec = makeRecorder()
    recorder.current = rec
    go('recording')
    setStatus(`recording ${to}`)
    sayRef.current(`Recording the route to ${to}. Walk there, then hold and say end route.`)
    void captureRef.current().then((d) => {
      if (d != null) rec.addView({ leg: 0, step: 0 }, d)
    })
  }, [])

  /** Ends whichever is running: saves a recording, or stops guidance. */
  const end = useCallback(async () => {
    if (modeRef.current === 'following') {
      go('idle')
      return sayRef.current('Guidance stopped.')
    }
    const rec = recorder.current
    if (modeRef.current !== 'recording' || rec == null) return sayRef.current('No route is being recorded.')
    go('idle')
    recorder.current = null
    if (rec.totalSteps < MIN_ROUTE_STEPS) return sayRef.current('That was too short to be a route. Nothing saved.')
    try {
      const route = rec.finish((await captureRef.current()) ?? [])
      saveRoute(name.current, route)
      const turns = route.filter((c) => c.turn != null && c.turn !== 'arrive').length
      console.log('route saved', name.current, JSON.stringify(route.map((c) => [c.leg, c.step, c.turn ?? '', c.descriptor.length])))
      sayRef.current(`Saved the route to ${name.current}. ${rec.totalSteps} steps, ${turns} ${turns === 1 ? 'turn' : 'turns'}.`)
    } catch (e) {
      console.warn('route save failed', e)
      sayRef.current('Could not save the route.')
    }
  }, [])

  const follow = useCallback(async (to: string) => {
    try {
      const route = await loadRoute(to)
      if (route == null) return sayRef.current(`No route to ${to} is saved.`)
      name.current = to
      recorder.current = null
      const fol = makeFollower(to, route)
      follower.current = fol
      go('following')
      sayRef.current(`Stand where the recording started, facing the same way. ${fol.start()}`)
    } catch (e) {
      console.warn('route load failed', e)
      sayRef.current('Could not load the route.')
    }
  }, [])

  return { mode, status, startRecording, end, follow }
}
