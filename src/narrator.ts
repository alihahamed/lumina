import * as Speech from 'expo-speech'
import { type Candidate, selectAnnouncement, type Tracks } from './narrationPolicy'

const tracks: Tracks = new Map()
let lastSpokeAt = -Infinity
let speaking = false

const finished = () => {
  speaking = false
}

/**
 * Feeds this frame's candidates to the policy and speaks at most one of them.
 *
 * Deliberately passes no voice, rate or pitch: blind users run their system TTS at
 * 2-3x with settings they chose, and overriding that makes the app worse.
 *
 * @returns what was said, or null for silence.
 */
export function narrate(candidates: Candidate[], now: number = Date.now()): string | null {
  const pick = selectAnnouncement(candidates, now, tracks, lastSpokeAt, !speaking)
  if (pick == null) return null

  lastSpokeAt = now
  speaking = true
  Speech.speak(pick.text, { onDone: finished, onStopped: finished, onError: finished })
  return pick.text
}

/**
 * Interrupts whatever is being said. For things the user must hear now — obstacle
 * warnings, state changes — never for narration.
 */
export function alert(text: string, now: number = Date.now()): void {
  Speech.stop()
  lastSpokeAt = now
  speaking = true
  Speech.speak(text, { onDone: finished, onStopped: finished, onError: finished })
}

/** Clears all cooldowns and stops speech. Call when a session ends. */
export function resetNarrator(): void {
  tracks.clear()
  lastSpokeAt = -Infinity
  speaking = false
  Speech.stop()
}
