import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'
import { models, useObjectDetection } from 'react-native-executorch'
import type { Frame } from 'react-native-vision-camera'
import { Camera, useCameraPermission, useFrameOutput } from 'react-native-vision-camera'
import { scheduleOnRN } from 'react-native-worklets'
import DepthSpike from './src/DepthSpike'
import { pulseFor, resetHaptics } from './src/haptics'
import {
  nearestInPath,
  toCandidates,
  type Detected,
  type PulsePattern,
  type ZoneMemory,
} from './src/narrationPolicy'
import { alert, narrate, resetNarrator } from './src/narrator'

// YOLO26n ships as an XNNPACK build, so inference runs on the CPU at roughly
// 100-300 ms a frame. Capping the whole pipeline is cheaper than throttling
// inside the worklet, and the preview only exists for this debug screen anyway.
// ponytail: fixed 8 fps, make it adaptive if slower devices drop too many frames
const TARGET_FPS = 8
const MIN_SCORE = 0.5
const INPUT_SIZE = 384

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const [labels, setLabels] = useState<string[]>([])
  const [dropped, setDropped] = useState(0)
  const [proximity, setProximity] = useState(0)
  const [pattern, setPattern] = useState<PulsePattern>('none')
  // Which zone we last called each label, so boxes jittering on a zone boundary
  // do not flip back and forth and get announced twice.
  const zoneMemory = useRef<ZoneMemory>(new Map())
  // ponytail: spike toggle, delete with src/DepthSpike.tsx once depth is decided
  const [spike, setSpike] = useState(false)

  const detection = useObjectDetection({ model: models.object_detection.yolo26n() })
  const { runOnFrame, isReady, downloadProgress, error } = detection

  useEffect(() => {
    if (!hasPermission) void requestPermission()
  }, [hasPermission, requestPermission])

  useEffect(() => {
    if (isReady) alert('Lumina ready')
    return () => {
      resetNarrator()
      resetHaptics()
    }
  }, [isReady])

  const publish = useCallback((found: Detected[], frameWidth: number, frameHeight: number) => {
    // Ranking, cooldowns and proximity live in narrationPolicy — see docs/decisions.md.
    const candidates = toCandidates(found, frameWidth, frameHeight, zoneMemory.current)
    setLabels(candidates.map((c) => c.text))

    // Haptics first, and unconditionally: this is the safety layer and must not wait
    // on speech, on a name for the obstacle, or on anything off-device.
    const path = nearestInPath(candidates)
    setProximity(path?.proximity ?? 0)
    setPattern(path != null ? pulseFor(path.proximity) : 'none')

    narrate(candidates)
  }, [])

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
        const found = runOnFrame(frame, false, {
          detectionThreshold: MIN_SCORE,
          inputSize: INPUT_SIZE,
        })
        // Rebuild as plain objects — native host objects do not survive the hop to JS.
        // bbox is in frame pixels, so frame.width is what the zones divide up.
        scheduleOnRN(
          publish,
          found.map((d) => ({
            label: String(d.label),
            bbox: { x1: d.bbox.x1, y1: d.bbox.y1, x2: d.bbox.x2, y2: d.bbox.y2 },
          })),
          frame.width,
          frame.height,
        )
      } finally {
        // Not disposing stalls the camera pipeline.
        frame.dispose()
      }
    },
    [runOnFrame, publish],
  )

  const onFrameDropped = useCallback(() => setDropped((n) => n + 1), [])

  // 'rgb' is not optional. ExecuTorch's FrameExtractor accepts only
  // R8G8B8A8 / R8G8B8X8 / R8G8B8 AHardwareBuffers; the default 'native' hands it
  // the camera's YUV (or a vendor-private) format and it throws on every frame.
  const frameOutput = useFrameOutput({ pixelFormat: 'rgb', onFrame, onFrameDropped })

  if (spike) return <DepthSpike onExit={() => setSpike(false)} />

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
        outputs={[frameOutput]}
        constraints={[{ fps: TARGET_FPS }]}
      />

      {/* Debug overlay. The real user is blind — this exists for us, not them. */}
      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.status}>
          {isReady ? `detecting · ${TARGET_FPS} fps` : `downloading model · ${Math.round(downloadProgress * 100)}%`}
        </Text>
        <Text style={styles.detail}>dropped frames: {dropped}</Text>
        <Text style={styles.detail}>
          path proximity: {proximity.toFixed(2)} · haptic: {pattern}
        </Text>
        <Pressable style={styles.spikeButton} onPress={() => setSpike(true)}>
          <Text style={styles.buttonText}>Open depth spike</Text>
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
      </View>
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
