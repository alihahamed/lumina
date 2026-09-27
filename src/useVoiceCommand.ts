import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition'
import { useCallback, useRef, useState } from 'react'

/**
 * Hold-and-speak (Phase 6, docs/decisions.md): `start` when the hold begins, `stop`
 * when it ends. Android's recogniser also ends by itself after a pause, which is what
 * TalkBack's actions-menu path relies on. `onHeard` fires once per session, with ''
 * when nothing was understood.
 */
export function useVoiceCommand(onHeard: (heard: string) => void, onFailed: (why: string) => void) {
  const [listening, setListening] = useState(false)
  const heard = useRef('')
  const failed = useRef<string | null>(null)

  useSpeechRecognitionEvent('start', () => setListening(true))
  useSpeechRecognitionEvent('result', (e) => {
    if (e.isFinal) heard.current = e.results[0]?.transcript ?? ''
  })
  useSpeechRecognitionEvent('error', (e) => {
    // no-speech / speech-timeout just mean silence; the rest are real failures.
    if (e.error !== 'no-speech' && e.error !== 'speech-timeout' && e.error !== 'aborted') {
      failed.current = e.error === 'network' ? 'Voice commands need the internet on this phone.' : 'Could not listen. Try again.'
      console.warn('speech error', e.error, e.message)
    }
  })
  // 'end' always comes last, after a result or an error, so the outcome is decided here.
  useSpeechRecognitionEvent('end', () => {
    setListening(false)
    const why = failed.current
    const text = heard.current
    failed.current = null
    heard.current = ''
    if (why != null) onFailed(why)
    else onHeard(text)
  })

  const start = useCallback(async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    if (!perm.granted) {
      onFailed('Lumina needs the microphone to hear commands.')
      return
    }
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: false,
      continuous: false,
      // Google's advice for short commands: the web_search model, not free_form.
      androidIntentOptions: { EXTRA_LANGUAGE_MODEL: 'web_search' },
    })
  }, [onFailed])

  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), [])

  return { listening, start, stop }
}
