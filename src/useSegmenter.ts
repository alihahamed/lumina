import { useCallback, useEffect, useState } from 'react'
import { SemanticSegmentationModule } from 'react-native-executorch'
import { ADE20K } from './ade20kLabels'
import { nameAhead, type SceneName } from './sceneNames'

/**
 * SegFormer-B0 (ADE20K, 150 classes) at 512 px, bundled like the depth model
 * (`npm run fetch-models`). Names what depth only measures: wall, door, stairs.
 *
 * Runs on a still photo through `forward()`, on ExecuTorch's own thread, never in the
 * camera frame loop: at 512 px it is ~4x the work of 256, and in the frame loop it
 * would stall depth and haptics exactly when the user is close to something. 512, not
 * 256, because 256 missed doors (10% vs 42% of a door filling the view).
 * Licence: NVIDIA non-commercial. docs/decisions.md 2026-09-27.
 */
const MODEL = require('../assets/models/segformer_b0_ade20k_512.pte')
const NORM_MEAN: [number, number, number] = [0.485, 0.456, 0.406]
const NORM_STD: [number, number, number] = [0.229, 0.224, 0.225]
// Same reasoning as useDepth: never free a model under a call still running on it.
const DELETE_GRACE_MS = 3000

type Module = Awaited<ReturnType<typeof SemanticSegmentationModule.fromCustomModel<typeof ADE20K>>>

export function useSegmenter() {
  const [instance, setInstance] = useState<Module | null>(null)

  useEffect(() => {
    let active = true
    let loaded: Module | null = null
    SemanticSegmentationModule.fromCustomModel(MODEL, {
      labelMap: ADE20K,
      preprocessorConfig: { normMean: NORM_MEAN, normStd: NORM_STD },
    })
      .then((mod) => {
        if (!active) {
          mod.delete()
          return
        }
        loaded = mod
        setInstance(mod)
        console.log('segmentation model ready')
      })
      .catch((e) => console.warn('segmentation model failed', e))
    return () => {
      active = false
      setInstance(null)
      const toFree = loaded
      if (toFree != null) setTimeout(() => toFree.delete(), DELETE_GRACE_MS)
    }
  }, [])

  /** What fills the centre of the photo at `uri`, or null. */
  const nameFromPhoto = useCallback(
    async (uri: string): Promise<SceneName | null> => {
      if (instance == null) return null
      // Ask for one class buffer only: an empty list returns all 150, ~10 MB of copying.
      const r = await instance.forward(uri, ['WALL'], false)
      const side = Math.round(Math.sqrt(r.ARGMAX.length))
      return nameAhead(r.ARGMAX, side, side)
    },
    [instance],
  )

  return { nameFromPhoto, isReady: instance != null }
}
