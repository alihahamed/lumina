import * as Speech from 'expo-speech'
import { shouldAnnounce } from './rateLimit'

/**
 * `alert` interrupts whatever is being said. `info` is chatter and is dropped
 * whenever something is already speaking — a stale "chair" helps nobody.
 */
export type Priority = 'alert' | 'info'

const seen = new Map<string, number>()
let speaking = false

/**
 * Speaks `text` unless `key` is still in its cooldown window.
 *
 * Deliberately passes no voice, rate or pitch: blind users run their system TTS
 * at 2–3x with settings they chose, and overriding that makes the app worse.
 *
 * @returns whether anything was actually spoken.
 */
export function announce(key: string, text: string, priority: Priority = 'info'): boolean {
  if (priority === 'info' && speaking) return false
  if (!shouldAnnounce(key, Date.now(), seen)) return false

  if (priority === 'alert') Speech.stop()

  speaking = true
  const done = () => {
    speaking = false
  }
  Speech.speak(text, { onDone: done, onStopped: done, onError: done })
  return true
}

/** Clears cooldowns and stops speech. Call when a session ends. */
export function resetNarrator(): void {
  seen.clear()
  speaking = false
  Speech.stop()
}
