import { useCallback, useEffect, useState } from 'react'
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'
import { models, useObjectDetection } from 'react-native-executorch'
import type { Frame } from 'react-native-vision-camera'
import { Camera, useCameraPermission, useFrameOutput } from 'react-native-vision-camera'
import { scheduleOnRN } from 'react-native-worklets'
import { announce, resetNarrator } from './src/narrator'

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

  const detection = useObjectDetection({ model: models.object_detection.yolo26n() })
  const { runOnFrame, isReady, downloadProgress, error } = detection

  useEffect(() => {
    if (!hasPermission) void requestPermission()
  }, [hasPermission, requestPermission])

  useEffect(() => {
    if (isReady) announce('ready', 'Lumina ready', 'alert')
    return resetNarrator
  }, [isReady])

  const publish = useCallback((found: string[]) => {
    setLabels(found)
    for (const label of found) {
      announce(label, `${label.toLowerCase().replace(/_/g, ' ')} ahead`)
    }
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
        scheduleOnRN(publish, found.map((d) => String(d.label)))
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
      <View style={styles.overlay} pointerEvents="none">
        <Text style={styles.status}>
          {isReady ? `detecting · ${TARGET_FPS} fps` : `downloading model · ${Math.round(downloadProgress * 100)}%`}
        </Text>
        <Text style={styles.detail}>dropped frames: {dropped}</Text>
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
})
