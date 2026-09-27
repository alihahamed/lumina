import { File } from 'expo-file-system'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'
import { models, useObjectDetection } from 'react-native-executorch'
import type { Frame } from 'react-native-vision-camera'
import {
  Camera,
  CommonResolutions,
  useCameraPermission,
  useFrameOutput,
  usePhotoOutput,
} from 'react-native-vision-camera'
import { scheduleOnRN } from 'react-native-worklets'
import DepthSpike from './src/DepthSpike'
import { zoneDepths } from './src/depthZones'
import { useDepth } from './src/useDepth'
import { pulseFor, resetHaptics } from './src/haptics'
import {
  nearestInPath,
  patternFor,
  stablePatternForDepth,
  toCandidates,
  type Detected,
  type PulsePattern,
  type ZoneMemory,
} from './src/narrationPolicy'
import type { ZoneDepths } from './src/depthZones'
import { alert, narrate, resetNarrator } from './src/narrator'
import { readText } from './src/ocr'

// YOLO26n ships as an XNNPACK build, so inference runs on the CPU at roughly
// 100-300 ms a frame. Capping the whole pipeline is cheaper than throttling
// inside the worklet, and the preview only exists for this debug screen anyway.
// ponytail: fixed 8 fps, make it adaptive if slower devices drop too many frames
const TARGET_FPS = 8
const MIN_SCORE = 0.5
const INPUT_SIZE = 384

type DepthStats = {
  yoloMs: number
  depthMs: number
  zones: ZoneDepths | null
  error: string | null
}

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const [labels, setLabels] = useState<string[]>([])
  const [dropped, setDropped] = useState(0)
  const [proximityLabel, setProximityLabel] = useState('0.00 (bbox)')
  const [pattern, setPattern] = useState<PulsePattern>('none')
  // Which zone we last called each label, so boxes jittering on a zone boundary
  // do not flip back and forth and get announced twice.
  const zoneMemory = useRef<ZoneMemory>(new Map())
  // Last depth-driven pattern, so a noisy reading near a threshold does not flip
  // back and forth every frame — see stablePatternForDepth and docs/bug.md 2026-09-27.
  const lastDepthPattern = useRef<PulsePattern>('none')
  // ponytail: spike toggle, delete with src/DepthSpike.tsx once depth is decided
  const [spike, setSpike] = useState(false)

  const detection = useObjectDetection({ model: models.object_detection.yolo26n() })
  const { runOnFrame, isReady, downloadProgress, error } = detection
  // Depth drives haptics whenever it loads and stays healthy; see `publish` below.
  const depth = useDepth()
  const depthRun = depth.runOnFrame
  const [depthStats, setDepthStats] = useState<DepthStats | null>(null)

  // Phase 4: on-demand OCR (PRD section 4, "READING" tier). HD_4_3, not the 4K
  // default — legible enough for a sign, far less to capture and hand to ML Kit.
  const photoOutput = usePhotoOutput({ targetResolution: CommonResolutions.HD_4_3 })
  const [reading, setReading] = useState(false)
  // Debug only, like depthStats — lets us confirm OCR worked without needing to hear
  // the phone's TTS. ponytail: delete once this has been verified a few times.
  const [lastRead, setLastRead] = useState<string | null>(null)

  const readNow = useCallback(async () => {
    if (reading) return
    setReading(true)
    alert('Reading')
    let path: string | null = null
    try {
      const file = await photoOutput.capturePhotoToFile({}, {})
      path = file.filePath
      const uri = path.startsWith('file://') ? path : `file://${path}`
      const text = await readText(uri)
      setLastRead(text.length > 0 ? text : '(no text found)')
      alert(text.length > 0 ? text : 'No text found')
    } catch (e) {
      setLastRead(`error: ${String(e).slice(0, 200)}`)
      alert('Could not read that')
      console.warn('OCR failed', e)
    } finally {
      // Never leave a photo of the user's surroundings sitting on disk — privacy,
      // and this phone has run low on storage before (HANDOFF.md).
      if (path != null) {
        try {
          new File(path.startsWith('file://') ? path : `file://${path}`).delete()
        } catch {
          // best-effort cleanup; a leftover temp file is not worth surfacing
        }
      }
      setReading(false)
    }
  }, [photoOutput, reading])

  useEffect(() => {
    if (!hasPermission) void requestPermission()
  }, [hasPermission, requestPermission])

  useEffect(() => {
    // The only way a blind user learns the screen is a button is being told so.
    if (isReady) alert('Lumina ready. Tap anywhere to read text.')
    return () => {
      resetNarrator()
      resetHaptics()
      lastDepthPattern.current = 'none'
    }
  }, [isReady])

  const publish = useCallback(
    (
      found: Detected[],
      frameWidth: number,
      frameHeight: number,
      yoloMs: number,
      depthMs: number,
      depthZones: ZoneDepths | null,
      depthError: string | null,
    ) => {
      // Ranking, cooldowns and proximity live in narrationPolicy — see docs/decisions.md.
      const candidates = toCandidates(found, frameWidth, frameHeight, zoneMemory.current)
      setLabels(candidates.map((c) => c.text))

      // Haptics first, and unconditionally: this is the safety layer and must not wait
      // on speech, on a name for the obstacle, or on anything off-device.
      //
      // Depth decides when it is ready and healthy — PRD section 5: depth, not
      // detection, must drive safety, a glass door has no COCO class. The bbox
      // heuristic is the fallback for while depth is loading or throws, not the
      // steady state, now that depth runs fast enough to keep up (docs/decisions.md
      // 2026-09-27). Only one path calls `pulseFor` per frame — see its docstring for
      // why calling it from both would double-buzz.
      let thisPattern: PulsePattern
      if (depthZones != null) {
        thisPattern = stablePatternForDepth(depthZones.centre, lastDepthPattern.current)
        lastDepthPattern.current = thisPattern
        setProximityLabel(`${depthZones.centre.toFixed(1)} m (depth)`)
      } else {
        const path = nearestInPath(candidates)
        thisPattern = path != null ? patternFor(path.proximity) : 'none'
        setProximityLabel(path != null ? `${path.proximity.toFixed(2)} (bbox)` : '0.00 (bbox)')
      }
      setPattern(pulseFor(thisPattern))
      setDepthStats({ yoloMs, depthMs, zones: depthZones, error: depthError })

      narrate(candidates)
    },
    [],
  )

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet'
      // Rebound by useFrameOutput whenever runOnFrame changes, so this is null
      // only until the model finishes downloading.
      if (runOnFrame == null) {
        frame.dispose()
        return
      }
      try {
        const t0 = Date.now()
        const found = runOnFrame(frame, false, {
          detectionThreshold: MIN_SCORE,
          inputSize: INPUT_SIZE,
        })
        const yoloMs = Date.now() - t0

        // Depth failure must never take detection or haptics down with it — publish
        // still fires below, just with depthZones null so it falls back to bbox.
        let depthMs = -1
        let depthZones: ZoneDepths | null = null
        let depthError: string | null = null
        if (depthRun != null) {
          try {
            const t1 = Date.now()
            // resizeToInput=false: keep the model's own 140x140 grid, far cheaper than
            // resizing to the full frame just to read three numbers.
            const map = depthRun(frame, false, ['FOREGROUND'], false).FOREGROUND
            const side = Math.round(Math.sqrt(map.length))
            depthZones = zoneDepths(map, side, side)
            depthMs = Date.now() - t1
          } catch (e) {
            depthError = String(e)
          }
        }

        // Rebuild as plain objects — native host objects do not survive the hop to JS.
        // The buffer is sensor-native landscape (e.g. 640x480) but ExecuTorch returns
        // bboxes already rotated to portrait screen space (0-480 wide, 0-640 tall).
        // Dividing by frame.width put the 'on your right' zone past every possible x,
        // so right was never announced. The app is portrait-locked (app.json), so
        // portrait width is the short side.
        // ponytail: assumes portrait; derive from frame.orientation if we ever unlock
        scheduleOnRN(
          publish,
          found.map((d) => ({
            label: String(d.label),
            bbox: { x1: d.bbox.x1, y1: d.bbox.y1, x2: d.bbox.x2, y2: d.bbox.y2 },
          })),
          Math.min(frame.width, frame.height),
          Math.max(frame.width, frame.height),
          yoloMs,
          depthMs,
          depthZones,
          depthError,
        )
      } finally {
        // Not disposing stalls the camera pipeline.
        frame.dispose()
      }
    },
    [runOnFrame, publish, depthRun],
  )

  const onFrameDropped = useCallback(() => setDropped((n) => n + 1), [])

  // 'rgb' is not optional. ExecuTorch's FrameExtractor accepts only
  // R8G8B8A8 / R8G8B8X8 / R8G8B8 AHardwareBuffers; the default 'native' hands it
  // the camera's YUV (or a vendor-private) format and it throws on every frame.
  const frameOutput = useFrameOutput({ pixelFormat: 'rgb', onFrame, onFrameDropped })

  if (spike)
    return (
      <DepthSpike
        onExit={() => setSpike(false)}
        runOnFrame={runOnFrame}
        forward={detection.forward}
        isReady={isReady}
      />
    )

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.status}>Lumina needs the camera.</Text>
        <Pressable style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </Pressable>
      </View>
    )
  }

  if (error != null) {
    return (
      <View style={styles.center}>
        <Text style={styles.status}>Model failed to load</Text>
        <Text style={styles.detail}>{String(error)}</Text>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <Camera
        style={StyleSheet.absoluteFill}
        device="back"
        isActive
        outputs={[frameOutput, photoOutput]}
        constraints={[{ fps: TARGET_FPS }]}
      />

      {/*
        Phase 4 trigger: the whole screen. A blind user cannot find a button, but can
        always tap the glass. Sighted: one tap anywhere. TalkBack: the screen is one
        element, so its double-tap-to-activate works from anywhere too.

        The overlay is nested inside so taps on the debug text bubble up to here;
        the Camera stays a sibling underneath so its own native touch handling is
        never in the path. The depth-spike button still wins its own taps — the
        innermost Pressable gets the touch.

        ponytail: a palm or thumb brushing the glass while walking will trigger a
        read. Harmless (it just speaks), but if it happens in testing, move to a
        long-press or a volume button. See docs/decisions.md 2026-09-27.
      */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => void readNow()}
        disabled={reading}
        accessibilityRole="button"
        accessibilityLabel="Read text"
        accessibilityHint="Takes a photo and reads any text in view aloud"
      >
      {/* Debug overlay. The real user is blind — this exists for us, not them. */}
      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.status}>
          {isReady ? `detecting · ${TARGET_FPS} fps` : `downloading model · ${Math.round(downloadProgress * 100)}%`}
        </Text>
        <Text style={styles.detail}>dropped frames: {dropped}</Text>
        <Text style={styles.detail}>
          path proximity: {proximityLabel} · haptic: {pattern}
        </Text>
        <Text style={styles.detail}>
          {depth.error != null
            ? `depth model failed: ${depth.error.slice(0, 120)}`
            : !depth.isReady
              ? 'depth: loading…'
              : depthStats == null
                ? 'depth: ready, waiting for a frame'
                : depthStats.error != null
                  ? `depth error (falling back to bbox): ${depthStats.error.slice(0, 120)}`
                  : `yolo ${depthStats.yoloMs} ms · depth ${depthStats.depthMs} ms`}
        </Text>
        {depthStats?.zones != null && (
          <Text style={styles.detail}>
            L {depthStats.zones.left.toFixed(1)} m · C {depthStats.zones.centre.toFixed(1)} m · R{' '}
            {depthStats.zones.right.toFixed(1)} m
          </Text>
        )}
        {lastRead != null && (
          <Text style={styles.detail} numberOfLines={3}>
            last read: {lastRead}
          </Text>
        )}
        <Pressable
          style={styles.spikeButton}
          onPress={() => setSpike(true)}
          disabled={!isReady}
        >
          <Text style={styles.buttonText}>
            {isReady ? 'Open depth spike' : 'Open depth spike (wait for model)'}
          </Text>
        </Pressable>
        {labels.length === 0 ? (
          <Text style={styles.detail}>nothing detected</Text>
        ) : (
          labels.map((label, i) => (
            <Text key={`${label}-${i}`} style={styles.label}>
              {label}
            </Text>
          ))
        )}
        <Text style={styles.detail}>
          {reading ? 'reading text…' : 'tap anywhere to read text'}
        </Text>
      </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0F' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#0B0B0F',
  },
  overlay: {
    position: 'absolute',
    top: 48,
    left: 16,
    right: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  status: { color: '#F5F5F7', fontSize: 16, fontWeight: '600' },
  detail: { color: '#9A9AA5', fontSize: 13, marginTop: 4 },
  label: { color: '#7FD1AE', fontSize: 15, marginTop: 2 },
  button: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2B6CB0',
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  spikeButton: {
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: '#3A3A44',
  },
})
