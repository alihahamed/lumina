import { useEffect, useMemo, useState } from 'react'
import { SemanticSegmentationModule } from 'react-native-executorch'

// The library has no depth model, but its segmentation runtime passes a single-channel
// [1,1,H,W] output through untouched as the FOREGROUND buffer (no sigmoid, no softmax;
// see BaseSemanticSegmentation.cpp computeResult, numChannels == 1). So a depth model
// exported to that contract comes back as raw metres, through the same runOnFrame path
// YOLO uses. Export script and rationale: docs/decisions.md.
const Labels = { FOREGROUND: 0, BACKGROUND: 1 } as const

// ponytail: model was adb-pushed into the app's private dir for the benchmark.
// Replace with a hosted URL (like the YOLO weights) once the model is chosen.
// 140px, not the 252px first tried: that measured 1297ms/frame on begoniain, far over
// budget. See docs/decisions.md 2026-09-26 and 2026-09-27.
const MODEL = 'file:///data/user/0/com.lumina.app/files/depth140.pte'

// Depth Anything expects ImageNet normalisation, applied by the native runtime.
const NORM_MEAN: [number, number, number] = [0.485, 0.456, 0.406]
const NORM_STD: [number, number, number] = [0.229, 0.224, 0.225]

type Module = Awaited<ReturnType<typeof SemanticSegmentationModule.fromCustomModel<typeof Labels>>>

// Longer than one depth call (~330-390 ms on begoniain) with margin for a slow frame.
const DELETE_GRACE_MS = 1500

export function useDepth() {
  const [instance, setInstance] = useState<Module | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let loaded: Module | null = null
    SemanticSegmentationModule.fromCustomModel(MODEL, {
      labelMap: Labels,
      preprocessorConfig: { normMean: NORM_MEAN, normStd: NORM_STD },
    })
      .then((mod) => {
        if (!active) {
          mod.delete() // never reached a frame, safe to free now
          return
        }
        loaded = mod
        setInstance(mod)
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
      // Stop handing it frames first (runOnFrame goes null, onFrame rebinds), then
      // free it once any call already in flight on the camera thread has finished.
      // Deleting immediately segfaulted twice mid-call — docs/bug.md 2026-09-27.
      // ponytail: covers unmount and Fast Refresh, not a full JS runtime teardown,
      // where this timer never fires; a native-side guard in the library would.
      setInstance(null)
      const toFree = loaded
      if (toFree != null) setTimeout(() => toFree.delete(), DELETE_GRACE_MS)
    }
  }, [])

  const runOnFrame = useMemo(() => (instance ? instance.runOnFrame : null), [instance])
  return { runOnFrame, isReady: instance != null, error }
}
