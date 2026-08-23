/**
 * SPIKE — throwaway. Delete once it has answered its two questions.
 *
 * 1. Does ARCore depth, reached through ViroReact, give sane distances on our phone?
 * 2. How long does swapping the camera between ARCore and VisionCamera actually take?
 *
 * Question 2 decides the whole architecture. If the swap is under ~500 ms it can be
 * user-triggered ("what's around me?") and we keep both depth and object detection.
 * If it is seconds, the two-mode design is dead and we convert a depth model instead.
 *
 * Nothing here is production code. Do not build on it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  ViroARScene,
  ViroARSceneNavigator,
  type ViroARHitTestResult,
} from '@reactvision/react-viro'
import { models, useObjectDetection } from 'react-native-executorch'
import type { Frame } from 'react-native-vision-camera'
import { Camera, useFrameOutput } from 'react-native-vision-camera'
import { scheduleOnRN } from 'react-native-worklets'

const { width, height } = Dimensions.get('window')
const HIT_TEST_MS = 250

export interface Reading {
  depth: number | null
  confidence: number | null
  source: string
  type: string
}

// Viro types initialScene.scene as a zero-arg component, so the scene cannot take
// props. One spike, one instance — a module-level sink is enough.
let readingSink: ((r: Reading) => void) | null = null

/** Fires a ray straight out of the middle of the screen, a few times a second. */
function SpikeScene() {
  const sceneRef = useRef<any>(null)

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const results: ViroARHitTestResult[] =
          await sceneRef.current?.performARHitTestWithPoint(width / 2, height / 2)
        const hit = results?.find((r) => r.hasDepthData) ?? results?.[0]
        readingSink?.({
          depth: hit?.depthValue ?? null,
          confidence: hit?.depthConfidence ?? null,
          source: hit?.depthSource ?? 'none',
          type: hit?.type ?? 'no hit',
        })
      } catch {
        readingSink?.({ depth: null, confidence: null, source: 'error', type: 'error' })
      }
    }, HIT_TEST_MS)
    return () => clearInterval(id)
  }, [])

  return <ViroARScene ref={sceneRef} />
}

type Mode = 'arcore' | 'camera'

export default function DepthSpike({ onExit }: { onExit: () => void }) {
  // The no-swap path: ARCore keeps the camera, we grab a still and run YOLO on it.
  const navRef = useRef<any>(null)
  const [shot, setShot] = useState<{ capture: number; detect: number; found: number } | null>(
    null,
  )
  const [shotError, setShotError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('arcore')
  const [reading, setReading] = useState<Reading | null>(null)
  const [detections, setDetections] = useState(0)
  const [swapMs, setSwapMs] = useState<Record<Mode, number | null>>({
    arcore: null,
    camera: null,
  })

  // Stamped the moment the user taps switch, together with the mode being swapped TO.
  // The target matters: a hit-test promise issued before the swap can resolve after it,
  // and without this check that stale result was credited as an ARCore startup time.
  const swapPending = useRef<{ at: number; target: Mode } | null>(null)

  const markReady = useCallback((which: Mode) => {
    const pending = swapPending.current
    if (pending == null) return
    // Ignore anything reporting ready for the mode we just left.
    if (pending.target !== which) return
    swapPending.current = null
    setSwapMs((prev) => ({ ...prev, [which]: Date.now() - pending.at }))
  }, [])

  const onReading = useCallback(
    (r: Reading) => {
      setReading(r)
      // First reading after a swap = ARCore is genuinely usable, not merely mounted.
      if (r.depth != null) markReady('arcore')
    },
    [markReady],
  )

  useEffect(() => {
    readingSink = onReading
    return () => {
      readingSink = null
    }
  }, [onReading])

  const detection = useObjectDetection({ model: models.object_detection.yolo26n() })
  const { runOnFrame } = detection

  const publish = useCallback(
    (count: number) => {
      setDetections(count)
      markReady('camera')
    },
    [markReady],
  )

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet'
      if (runOnFrame == null) {
        frame.dispose()
        return
      }
      try {
        const found = runOnFrame(frame, false, { detectionThreshold: 0.5, inputSize: 384 })
        scheduleOnRN(publish, found.length)
      } finally {
        frame.dispose()
      }
    },
    [runOnFrame, publish],
  )

  const frameOutput = useFrameOutput({ pixelFormat: 'rgb', onFrame })

  /**
   * Screenshot → YOLO, without ever releasing the camera.
   *
   * If this is fast enough it replaces the whole two-mode swap: ARCore holds the
   * camera permanently and on-demand naming runs off a still.
   */
  const captureAndDetect = useCallback(async () => {
    setShotError(null)
    try {
      const t0 = Date.now()
      const result = await navRef.current?._takeScreenshot(`spike-${t0}`, false)
      const capture = Date.now() - t0

      const path: string | undefined =
        result?.url ?? result?.filePath ?? result?.path ?? result
      if (typeof path !== 'string') {
        setShotError(`screenshot returned ${JSON.stringify(result)?.slice(0, 80)}`)
        return
      }

      const t1 = Date.now()
      const uri = path.startsWith('file://') ? path : `file://${path}`
      const found = await detection.forward(uri, { detectionThreshold: 0.5, inputSize: 384 })
      setShot({ capture, detect: Date.now() - t1, found: found.length })
    } catch (e) {
      setShotError(String(e).slice(0, 140))
    }
  }, [detection])

  const swap = () => {
    setMode((m) => {
      const target: Mode = m === 'arcore' ? 'camera' : 'arcore'
      swapPending.current = { at: Date.now(), target }
      return target
    })
  }

  return (
    <View style={styles.root}>
      {mode === 'arcore' ? (
        <ViroARSceneNavigator
          ref={navRef}
          autofocus
          depthEnabled
          initialScene={{ scene: SpikeScene }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <Camera
          style={StyleSheet.absoluteFill}
          device="back"
          isActive
          outputs={[frameOutput]}
          constraints={[{ fps: 8 }]}
        />
      )}

      {/* Crosshair — the hit test fires exactly here, so you know what you're measuring. */}
      <View pointerEvents="none" style={styles.crosshair} />

      <View style={styles.panel} pointerEvents="box-none">
        <Text style={styles.heading}>SPIKE · mode: {mode}</Text>

        {mode === 'arcore' ? (
          <>
            <Text style={styles.big}>
              {reading?.depth != null ? `${reading.depth.toFixed(2)} m` : '— no depth —'}
            </Text>
            <Text style={styles.detail}>source: {reading?.source ?? '—'}</Text>
            <Text style={styles.detail}>confidence: {reading?.confidence ?? '—'}</Text>
            <Text style={styles.detail}>hit type: {reading?.type ?? '—'}</Text>
          </>
        ) : (
          <Text style={styles.big}>{detections} objects</Text>
        )}

        <Text style={styles.detail}>
          swap → arcore: {swapMs.arcore != null ? `${swapMs.arcore} ms` : '—'}
        </Text>
        <Text style={styles.detail}>
          swap → camera: {swapMs.camera != null ? `${swapMs.camera} ms` : '—'}
        </Text>
        <Text style={styles.note}>
          Swap cost measured at ~1.2s each way — too slow. The capture path below is
          the alternative: ARCore never lets go of the camera.
        </Text>

        {mode === 'arcore' ? (
          <>
            <Text style={styles.detail}>
              {shot != null
                ? `capture ${shot.capture} ms + detect ${shot.detect} ms = ${
                    shot.capture + shot.detect
                  } ms · ${shot.found} objects`
                : 'capture → detect: not run'}
            </Text>
            {shotError != null ? <Text style={styles.error}>{shotError}</Text> : null}
            <Pressable style={styles.button} onPress={() => void captureAndDetect()}>
              <Text style={styles.buttonText}>Capture &amp; detect (no swap)</Text>
            </Pressable>
          </>
        ) : null}

        <Pressable style={styles.button} onPress={swap}>
          <Text style={styles.buttonText}>Swap camera owner</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.exit]} onPress={onExit}>
          <Text style={styles.buttonText}>Back to Lumina</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0F' },
  crosshair: {
    position: 'absolute',
    left: width / 2 - 12,
    top: height / 2 - 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#7FD1AE',
  },
  panel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 24,
    padding: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  heading: { color: '#F5F5F7', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  big: { color: '#7FD1AE', fontSize: 34, fontWeight: '700', marginVertical: 6 },
  detail: { color: '#9A9AA5', fontSize: 13, marginTop: 2 },
  note: { color: '#6B6B76', fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  button: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#2B6CB0',
  },
  exit: { backgroundColor: '#3A3A44' },
  error: { color: '#E88', fontSize: 11, marginTop: 4 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
})
