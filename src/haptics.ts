import * as Haptics from 'expo-haptics'
import { pulseIntervalFor } from './narrationPolicy'

let lastPulseAt = -Infinity

/**
 * Buzzes for something in the user's path, faster the closer it is.
 *
 * This is the layer a blind user actually relies on, so it must never depend on the
 * network, on speech finishing, or on the object having a name — a glass door has no
 * COCO class but is still a wall.
 *
 * @returns whether a pulse was actually fired.
 */
export function pulseFor(proximity: number, now: number = Date.now()): boolean {
  const interval = pulseIntervalFor(proximity)
  if (interval == null) return false
  if (now - lastPulseAt < interval) return false

  lastPulseAt = now
  // Strength rises with proximity as well as rate — two channels carrying the same
  // message, so it still reads through a pocket or a glove.
  const style =
    proximity > 0.85
      ? Haptics.ImpactFeedbackStyle.Heavy
      : proximity > 0.7
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light

  void Haptics.impactAsync(style)
  return true
}

export function resetHaptics(): void {
  lastPulseAt = -Infinity
}
