import * as Haptics from 'expo-haptics'
import { intervalFor, patternFor, type PulsePattern } from './narrationPolicy'

let lastPulseAt = -Infinity
let lastPattern: PulsePattern = 'none'

/**
 * Buzzes for something in the user's path.
 *
 * Three deliberately different feels, so they can be told apart while walking and
 * learned in about a minute:
 *
 * | Pattern    | Feels like            | Meaning              |
 * |------------|-----------------------|----------------------|
 * | `far`      | one light tap, slow   | something's coming up |
 * | `near`     | two medium taps       | close, pay attention  |
 * | `imminent` | fast heavy thuds      | stop                  |
 *
 * The double-tap is the important one: a *count* is recognisable where a small
 * change in rate is not.
 *
 * This is the layer a blind user actually relies on, so it must never depend on the
 * network, on speech finishing, or on the obstacle having a name — a glass door has
 * no COCO class but is still a wall.
 *
 * @returns the pattern fired, or 'none'.
 */
export function pulseFor(proximity: number, now: number = Date.now()): PulsePattern {
  const pattern = patternFor(proximity)
  const interval = intervalFor(pattern)
  if (interval == null) {
    lastPattern = 'none'
    return 'none'
  }

  // Escalation is urgent — let a step up in severity through immediately rather than
  // waiting out the gentler pattern's interval.
  const escalated = pattern !== lastPattern && severity(pattern) > severity(lastPattern)
  if (!escalated && now - lastPulseAt < interval) return 'none'

  lastPulseAt = now
  lastPattern = pattern

  if (pattern === 'far') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  } else if (pattern === 'near') {
    // Two taps. A count reads clearly where a rate change does not.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setTimeout(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 120)
  } else {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
  }

  return pattern
}

function severity(pattern: PulsePattern): number {
  return { none: 0, far: 1, near: 2, imminent: 3 }[pattern]
}

export function resetHaptics(): void {
  lastPulseAt = -Infinity
  lastPattern = 'none'
}
