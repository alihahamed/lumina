import { useCallback, useEffect, useRef, useState } from 'react'
import { File, Paths } from 'expo-file-system'
import { NetworkStateType, useNetworkState } from 'expo-network'
import { models, useLLM } from 'react-native-executorch'
import { firstSentences } from './text'

/**
 * Phase 7: scene description with no network, on the phone (PRD section 4, the
 * offline half of the REASONING tier). Used only when the cloud path fails — see
 * `describeNow` in App.tsx.
 *
 * LFM2.5-VL-450M, the PRD's model family, pre-converted in react-native-executorch.
 * Not the 1.6B: that is a 2.4 GB download and the phone has ~2.2 GB free with
 * YOLO and depth already loaded. The 450M is 649 MB. docs/decisions.md 2026-09-27.
 *
 * The first download only starts on Wi-Fi; no setting to find for a blind user, and no
 * surprise 649 MB on mobile data.
 */
const MODEL = models.llm.lfm2_5_vl_450m()

/**
 * No example hazards in the prompt. The first version listed "stairs, a door, or an
 * obstacle" and the 450M model echoed them back for a photo of a keyboard: "A blind
 * person indoors is facing stairs, a door, or an obstacle." A false "stairs" is worse
 * than silence. This one described a bedroom and a test JPEG accurately on the phone.
 * docs/decisions.md 2026-09-27.
 */
const MESSAGES = [
  {
    role: 'system' as const,
    content:
      'You describe photos for a blind person. Only mention things that are clearly ' +
      'visible. Never guess.',
  },
  { role: 'user' as const, content: 'Describe this photo in two short sentences.' },
]

// The library has no max-tokens setting, so bound it by time. Past this the user has
// waited long enough; whatever was generated so far is spoken.
const MAX_GENERATE_MS = 30_000

// Written once the model has loaded, so later launches load it from storage on any
// connection. Before that, the 649 MB download waits for Wi-Fi.
const downloadedFlag = () => new File(Paths.document, 'offline-vlm-downloaded')

export function useOfflineDescriber() {
  const network = useNetworkState()
  // Latched: once allowed, stays allowed for the session. If it flipped back, leaving
  // Wi-Fi would unload the model — exactly when offline description is needed.
  const [allowed, setAllowed] = useState(() => {
    try {
      return downloadedFlag().exists
    } catch {
      return false
    }
  })
  useEffect(() => {
    if (!allowed && network.type === NetworkStateType.WIFI) setAllowed(true)
  }, [allowed, network.type])

  const llm = useLLM({ model: MODEL, preventLoad: !allowed })
  const [loadMs, setLoadMs] = useState<number | null>(null)
  const mountedAt = useRef(Date.now())

  useEffect(() => {
    if (llm.isReady && loadMs == null) {
      const ms = Date.now() - mountedAt.current
      setLoadMs(ms)
      try {
        const flag = downloadedFlag()
        if (!flag.exists) flag.write('1')
      } catch {
        // Without the flag the next launch just waits for Wi-Fi again; not worth failing over.
      }
    }
  }, [llm.isReady, loadMs])

  const { generate, interrupt, isReady } = llm

  /** @returns spoken text plus timing, for the debug overlay and the benchmark. */
  const describeOffline = useCallback(
    async (
      uri: string,
    ): Promise<{ text: string; raw: string; ms: number; tokens: number; promptTokens: number }> => {
      if (!isReady) throw new Error('offline model not ready')
      // The image rides on the user message.
      const withImage = MESSAGES.map((m) => (m.role === 'user' ? { ...m, mediaPath: uri } : m))
      const t0 = Date.now()
      const timer = setTimeout(interrupt, MAX_GENERATE_MS)
      try {
        const raw = await generate(withImage)
        return {
          text: firstSentences(raw, 2),
          raw,
          ms: Date.now() - t0,
          tokens: llm.getGeneratedTokenCount(),
          promptTokens: llm.getPromptTokenCount(),
        }
      } finally {
        clearTimeout(timer)
      }
    },
    [generate, interrupt, isReady, llm],
  )

  return {
    describeOffline,
    isReady,
    /** Not downloaded yet, and not on Wi-Fi: the download is waiting. */
    waitingForWifi: !allowed,
    downloadProgress: llm.downloadProgress,
    error: llm.error,
    loadMs,
  }
}
