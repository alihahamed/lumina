import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition'
import { useNetworkState } from 'expo-network'
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
  const network = useNetworkState()

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
    // A throw here means no 'end' event, and the caller's narration pause never lifts.
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
      if (!perm.granted) {
        onFailed('Lumina needs the microphone to hear commands.')
        return
      }
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: false,
        continuous: false,
        // Offline, the network recogniser fails, and voice is the only way to reach the
        // Phase 7 offline describer. On-device needs Android 13+ and the English pack.
        // ponytail: unverified on device; docs/test-checklist.md
        requiresOnDeviceRecognition:
          network.isInternetReachable === false && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
        // Google's advice for short commands: the web_search model, not free_form.
        androidIntentOptions: { EXTRA_LANGUAGE_MODEL: 'web_search' },
      })
    } catch (e) {
      console.warn('speech start failed', e)
      onFailed('Could not listen. Try again.')
    }
  }, [onFailed, network.isInternetReachable])

  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), [])

  return { listening, start, stop }
}
