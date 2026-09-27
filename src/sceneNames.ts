// What is straight ahead, in a word, from a segmentation map. Names the things COCO
// detection cannot: walls, doors, stairs. No native imports, so it runs under plain
// `node` (see sceneNames.test.ts).
import { ADE20K } from './ade20kLabels.ts'

export type SceneName = 'stairs' | 'door' | 'railing' | 'window' | 'wall'

/**
 * Checked in this order; the first whose classes cover at least `share` of the centre
 * region wins. Hazards and landmarks come before walls and need less area, because a
 * door or a step is usually surrounded by wall. Shares are guesses, set from two test
 * photos (a door filling the centre was 42% "door" at 512 px). docs/decisions.md.
 *
 * Not ADE20K "glass" (147): that is a drinking glass. Glass doors come out as door or
 * windowpane.
 */
export const SCENE_RULES: readonly { name: SceneName; classes: readonly number[]; share: number }[] = [
  { name: 'stairs', classes: [ADE20K.STAIRS, ADE20K.STAIRWAY, ADE20K.STEP, ADE20K.ESCALATOR], share: 0.1 },
  { name: 'door', classes: [ADE20K.DOOR, ADE20K.SCREEN_DOOR], share: 0.15 },
  { name: 'railing', classes: [ADE20K.RAILING, ADE20K.BANNISTER], share: 0.15 },
  { name: 'window', classes: [ADE20K.WINDOWPANE], share: 0.25 },
  { name: 'wall', classes: [ADE20K.WALL, ADE20K.COLUMN], share: 0.4 },
]

// Same centre region as depthZones: the middle third, below the ceiling, above the feet.
const ROW_FROM = 0.3
const ROW_TO = 0.9

/**
 * @param argmax per-pixel class index, row-major, `width` x `height`, upright.
 * @returns the name of what fills the centre, or null when nothing is clear enough.
 */
export function nameAhead(argmax: ArrayLike<number>, width: number, height: number): SceneName | null {
  const r0 = Math.floor(height * ROW_FROM)
  const r1 = Math.ceil(height * ROW_TO)
  const c0 = Math.floor(width / 3)
  const c1 = Math.floor((width * 2) / 3)
  const counts = new Map<number, number>()
  let n = 0
  for (let y = r0; y < r1; y++) {
    for (let x = c0; x < c1; x++) {
      const cls = argmax[y * width + x]
      counts.set(cls, (counts.get(cls) ?? 0) + 1)
      n++
    }
  }
  if (n === 0) return null
  for (const rule of SCENE_RULES) {
    let hits = 0
    for (const cls of rule.classes) hits += counts.get(cls) ?? 0
    if (hits / n >= rule.share) return rule.name
  }
  return null
}
