import { File } from 'expo-file-system'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'
import { models, useImageEmbeddings, useObjectDetection } from 'react-native-executorch'
import type { Frame } from 'react-native-vision-camera'
import {
  Camera,
  CommonResolutions,
  useCameraPermission,
  useFrameOutput,
  usePhotoOutput,
} from 'react-native-vision-camera'
import { scheduleOnRN } from 'react-native-worklets'
import { zoneDepths } from './src/depthZones'
import { useDepth } from './src/useDepth'
import { useOfflineDescriber } from './src/useOfflineDescriber'
import { useSegmenter } from './src/useSegmenter'
import type { SceneName } from './src/sceneNames'
import { pulseFor, resetHaptics } from './src/haptics'
import {
  nearestInPath,
  patternFor,
  shouldDetect,
  stablePatternForDepth,
  tooCloseWarning,
  type Candidate,
  type CloseWarning,
  toCandidates,
  type Detected,
  type PulsePattern,
  type ZoneMemory,
} from './src/narrationPolicy'
import type { ZoneDepths } from './src/depthZones'
import { alert, narrate, observeSpeech, resetNarrator, setNarrationPaused } from './src/narrator'
import { readText } from './src/ocr'
import { DescribeError, describeScene } from './src/describe'
import * as Haptics from 'expo-haptics'
import { parseCommand } from './src/commands'
import { matchPlace, savePlace } from './src/places'
import { MATCH_THRESHOLD } from './src/placeMatch'
import {
  depthSample,
  isMeasuring,
  nextSampleNumber,
  recordDepthSample,
  recordFrame,
  recordPlaceQuery,
  recordSpeech,
  spokenSummary,
  startMeasuring,
  stopMeasuring,
} from './src/measure'
import { useVoiceCommand } from './src/useVoiceCommand'

// YOLO26n ships as an XNNPACK build, so inference runs on the CPU at roughly
// 100-300 ms a frame. Capping the whole pipeline is cheaper than throttling
// inside the worklet, and the preview only exists for this debug screen anyway.
// ponytail: fixed 8 fps, make it adaptive if slower devices drop too many frames
const TARGET_FPS = 8
const MIN_SCORE = 0.5
const INPUT_SIZE = 384

// Starting state of the debug overlay; "show logs" / "hide logs" toggles it at runtime.
const SHOW_DEBUG = __DEV__ || process.env.EXPO_PUBLIC_SHOW_DEBUG === '1'

// Naming what is ahead (wall, door, stairs) runs once when depth says something is
// within reach, then at most this often while it stays there; the name is trusted for
// as long, and forgotten when the user backs out of the near bands. Was 2 s, which kept
// segmentation running about half the time near a wall and slowed depth (decisions.md
// 2026-11-14).
const NAME_EVERY_MS = 10000
const NAME_FRESH_MS = 10000
// How long the last detection may name a "Stop" while detection is skipped.
const DETECTION_FRESH_MS = 3000

// "log distance" (evaluation only): the median of this many consecutive centre-zone
// readings, about 5 s at the measured 1-2 frames per second.
const DEPTH_SAMPLE_FRAMES = 10

// Evaluation only: a hands-off latency session of this many seconds starts by itself
// once both models are loaded. The protocol wants the phone untouched on a fixed scene,
// and "start measuring" needs a hold on the screen, which moves the camera. Unset (0) in
// every normal build. Set it when starting Metro or building a measurement APK:
//   EXPO_PUBLIC_MEASURE_SECONDS=360 npx expo start --dev-client --localhost --clear
const MEASURE_SECONDS = Number(process.env.EXPO_PUBLIC_MEASURE_SECONDS ?? 0)

type Busy = 'reading' | 'describing' | 'saving' | 'locating'

type DepthStats = {
  yoloMs: number
  depthMs: number
  zones: ZoneDepths | null
  error: string | null
}

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const [labels, setLabels] = useState<string[]>([])
  const [dropped, setDropped] = useState(0)
  const [proximityLabel, setProximityLabel] = useState('0.00 (bbox)')
  const [pattern, setPattern] = useState<PulsePattern>('none')
  // Which zone we last called each label, so boxes jittering on a zone boundary
  // do not flip back and forth and get announced twice.
  const zoneMemory = useRef<ZoneMemory>(new Map())
  // Last depth-driven pattern, so a noisy reading near a threshold does not flip
  // back and forth every frame — see stablePatternForDepth and docs/bug.md 2026-09-27.
  const lastDepthPattern = useRef<PulsePattern>('none')
  // Spoken "stop" state, so it speaks on arrival and repeats only every few seconds.
  const closeWarning = useRef<CloseWarning>({ active: false, lastAt: 0 })
  // Evaluation (src/measure.ts): which frame triggered the last "stop", so its speech
  // start can be timed from the frame; and a "log distance" sample being collected.
  const lastWarningFrame = useRef<{ text: string; t0: number } | null>(null)
  const depthSampling = useRef<ZoneDepths[] | null>(null)
  // Depth-first frames (onFrame): the safety half of the current frame, completed by
  // publishDetections; and the last detection result, for naming a "Stop" while
  // detection is skipped inside the warning bands.
  const pendingFrame = useRef<{
    t0: number
    depthMs: number
    depthZones: ZoneDepths | null
    depthError: string | null
    publishedAt: number
    hapticAt: number | null
  } | null>(null)
  const lastDetections = useRef<{ candidates: Candidate[]; at: number } | null>(null)
  const [measuring, setMeasuring] = useState(false)

  const detection = useObjectDetection({ model: models.object_detection.yolo26n() })
  const { runOnFrame, isReady, downloadProgress, error } = detection
  // Depth drives haptics whenever it loads and stays healthy; see `publishSafety` below.
  const depth = useDepth()
  const depthRun = depth.runOnFrame
  const [depthStats, setDepthStats] = useState<DepthStats | null>(null)

  // Phase 4: on-demand OCR (PRD section 4, "READING" tier). HD_4_3, not the 4K
  // default — legible enough for a sign, far less to capture and hand to ML Kit.
  const photoOutput = usePhotoOutput({ targetResolution: CommonResolutions.HD_4_3 })
  // Phase 7: on-phone fallback when the cloud describe fails. 649 MB download on
  // first launch — ponytail: make that opt-in and Wi-Fi-only before real users.
  const offline = useOfflineDescriber()
  // One on-demand request at a time: OCR and describe share the one photo output.
  const [busy, setBusy] = useState<Busy | null>(null)
  const busyRef = useRef<Busy | null>(null)
  busyRef.current = busy
  // Debug overlay, for demos to sighted people. Off in release unless the build or a
  // "show logs" voice command turns it on.
  const [showDebug, setShowDebug] = useState(SHOW_DEBUG)
  const [sceneStat, setSceneStat] = useState<{ name: SceneName | null; ms: number } | null>(null)
  const [lastWarning, setLastWarning] = useState<string | null>(null)

  // Scene naming (wall / door / stairs): a silent still, segmented off the frame loop.
  const segmenter = useSegmenter()
  const sceneName = useRef<{ name: SceneName | null; at: number } | null>(null)
  const naming = useRef<Promise<void> | null>(null)
  const lastNamingAt = useRef(0)
  const nameAheadNow = async () => {
    if (!segmenter.isReady) return
    const t0 = Date.now()
    let uri: string | null = null
    try {
      // No shutter sound: this fires every couple of seconds near obstacles.
      const file = await photoOutput.capturePhotoToFile({ enableShutterSound: false }, {})
      uri = file.filePath.startsWith('file://') ? file.filePath : `file://${file.filePath}`
      const name = await segmenter.nameFromPhoto(uri)
      sceneName.current = { name, at: Date.now() }
      setSceneStat({ name, ms: Date.now() - t0 })
      console.log('scene ahead', name, Date.now() - t0, 'ms')
    } catch (e) {
      console.warn('scene naming failed', e)
    } finally {
      if (uri != null) {
        try {
          new File(uri).delete()
        } catch {
          // best-effort cleanup
        }
      }
    }
  }
  // The publish callbacks have no deps (they run per frame from the worklet), so naming reaches the latest
  // closure through a ref rather than a stale one.
  const nameAheadRef = useRef(nameAheadNow)
  nameAheadRef.current = nameAheadNow
  // Debug only, like depthStats — lets us confirm a result without needing to hear
  // the phone's TTS. ponytail: delete once both have been verified a few times.
  const [lastResult, setLastResult] = useState<string | null>(null)

  /**
   * Takes a still, hands it to `work`, speaks what comes back, and deletes the photo
   * whatever happens. Shared by Phase 4 (read) and Phase 5 (describe).
   */
  const withStill = useCallback(
    async (
      kind: Busy,
      start: string,
      work: (uri: string) => Promise<string>,
      fallback: string,
    ) => {
      if (busy != null) return
      setBusy(kind)
      alert(start)
      let uri: string | null = null
      try {
        // A background scene-naming still may be mid-capture; one capture at a time.
        await naming.current
        const file = await photoOutput.capturePhotoToFile({}, {})
        uri = file.filePath.startsWith('file://') ? file.filePath : `file://${file.filePath}`
        const spoken = await work(uri)
        setLastResult(`${kind}: ${spoken}`)
        alert(spoken)
      } catch (e) {
        const spoken = e instanceof DescribeError ? e.spoken : fallback
        setLastResult(`${kind} error: ${String(e).slice(0, 200)}`)
        alert(spoken)
        console.warn(`${kind} failed`, e)
      } finally {
        // Never leave a photo of the user's surroundings sitting on disk — privacy,
        // and this phone has run low on storage before (HANDOFF.md).
        if (uri != null) {
          try {
            new File(uri).delete()
          } catch {
            // best-effort cleanup; a leftover temp file is not worth surfacing
          }
        }
        setBusy(null)
      }
    },
    [photoOutput, busy],
  )

  const readNow = useCallback(
    () =>
      withStill(
        'reading',
        'Reading',
        async (uri) => {
          const text = await readText(uri)
          return text.length > 0 ? text : 'No text found'
        },
        'Could not read that',
      ),
    [withStill],
  )

  // Phase 5: cloud scene description, only ever because the user asked (PRD section 4).
  // Cloud first (better, 2-4 s); on any failure, the on-phone model (Phase 7).
  const describeNow = useCallback(
    () =>
      withStill(
        'describing',
        'Looking',
        async (uri) => {
          try {
            return await describeScene(uri)
          } catch (cloudError) {
            if (!offline.isReady) {
              if (offline.waitingForWifi)
                throw new DescribeError(
                  'No connection. Offline description downloads the next time the phone is on Wi-Fi.',
                )
              throw cloudError
            }
            // Minutes of silence would read as a hang; say what is happening.
            alert('No connection. Describing on the phone, this takes a moment.')
            const r = await offline.describeOffline(uri)
            console.log('offline describe', r.ms, 'ms', r.tokens, 'tokens')
            return r.text.length > 0 ? r.text : 'Could not describe that.'
          }
        },
        'Could not describe that',
      ),
    [withStill, offline],
  )

  // Phase 6: place memory, recognition first (docs/decisions.md). CLIP ViT-B/32 int8,
  // 512 numbers, L2-normalised — measured to match the schema's vector(512).
  const clip = useImageEmbeddings({ model: models.image_embedding.clip_vit_base_patch32_image() })

  const saveNow = useCallback(
    (label: string) =>
      withStill(
        'saving',
        'Saving',
        async (uri) => {
          if (!clip.isReady) return 'Place memory is still loading. Try again in a moment.'
          await savePlace(label, await clip.forward(uri))
          return `Saved as ${label}.`
        },
        'Could not save that place. Check the internet connection.',
      ),
    [withStill, clip],
  )

  /**
   * "Where am I". `truth` is only given by "check place …" during the evaluation: the
   * place the tester knows they are at (null: a place that was never saved). Every
   * query is logged with all its candidates so the threshold can be chosen from data.
   */
  const whereNow = useCallback(
    (truth?: string | null) =>
      withStill(
        'locating',
        'Checking',
        async (uri) => {
          if (!clip.isReady) return 'Place memory is still loading. Try again in a moment.'
          const { match, top, candidates } = await matchPlace(await clip.forward(uri))
          recordPlaceQuery({ at: Date.now(), truth, threshold: MATCH_THRESHOLD, candidates })
          // The top similarity even when it misses, so the threshold can be tuned.
          console.log('place match', JSON.stringify(top))
          // A tester also hears the score; a user never does.
          const score = truth !== undefined && top != null ? ` Score ${top.similarity.toFixed(2)}.` : ''
          if (match != null) return `You're at ${match.label}.${score}`
          return top == null ? 'No places are saved yet.' : `I don't recognise this place.${score}`
        },
        'Could not check. Check the internet connection.',
      ),
    [withStill, clip],
  )

  // Evaluation sessions (src/measure.ts). Spoken by a sighted tester, never by a user.
  const startMeasurement = useCallback(() => {
    startMeasuring()
    observeSpeech((kind, text, calledAt, startedAt) => {
      const w = lastWarningFrame.current
      const isWarning = kind === 'alert' && w != null && w.text === text
      recordSpeech({
        kind: isWarning ? 'warning' : kind,
        calledAt,
        startedAt,
        frameT0: isWarning && w != null ? w.t0 : null,
      })
    })
    setMeasuring(true)
    alert('Measuring. Say stop measuring when done.')
  }, [])
  const stopMeasurement = useCallback(() => {
    observeSpeech(null)
    const report = stopMeasuring()
    setMeasuring(false)
    const spoken = spokenSummary(report)
    setLastResult(`measurement: ${spoken}`)
    alert(spoken)
  }, [])

  useEffect(() => {
    if (!(MEASURE_SECONDS > 0) || !isReady || !depth.isReady) return
    startMeasurement()
    const timer = setTimeout(stopMeasurement, MEASURE_SECONDS * 1000)
    return () => {
      clearTimeout(timer)
      if (isMeasuring()) stopMeasurement()
    }
  }, [isReady, depth.isReady, startMeasurement, stopMeasurement])

  // Hold-and-speak: what was heard becomes one of the actions above.
  const runCommand = useCallback(
    (heard: string) => {
      setNarrationPaused(false)
      const cmd = parseCommand(heard)
      setLastResult(`heard: "${heard}" → ${cmd.kind}`)
      switch (cmd.kind) {
        case 'describe':
          return void describeNow()
        case 'read':
          return void readNow()
        case 'save':
          return void saveNow(cmd.label)
        case 'whereami':
          return void whereNow()
        case 'checkPlace':
          return void whereNow(cmd.truth)
        case 'measureStart':
          return startMeasurement()
        case 'measureStop':
          return isMeasuring() ? stopMeasurement() : alert('Not measuring.')
        case 'logDistance':
          if (!depth.isReady) return alert('Depth is not ready yet.')
          depthSampling.current = []
          return alert('Hold still.')
        case 'showLogs':
          setShowDebug(true)
          return alert('Logs shown.')
        case 'hideLogs':
          setShowDebug(false)
          return alert('Logs hidden.')
        case 'unknown':
          return alert(
            heard.trim() === ''
              ? "I didn't catch that."
              : `I heard ${cmd.heard}. Say what's around me, save this as a name, or where am I.`,
          )
      }
    },
    [describeNow, readNow, saveNow, whereNow, startMeasurement, stopMeasurement, depth.isReady],
  )
  const voiceFailed = useCallback((why: string) => {
    setNarrationPaused(false)
    alert(why)
  }, [])
  const voice = useVoiceCommand(runCommand, voiceFailed)
  const holding = useRef(false)

  const startListening = useCallback(() => {
    // A tick, not a spoken prompt: the mic would transcribe our own voice.
    setNarrationPaused(true)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    void voice.start()
  }, [voice])


  useEffect(() => {
    if (!hasPermission) void requestPermission()
  }, [hasPermission, requestPermission])

  useEffect(() => {
    // The only way a blind user learns the screen is a button is being told so.
    if (isReady)
      alert(
        "Lumina ready. Tap anywhere to read text. Hold anywhere and speak: what's around me, save this as a name, or where am I.",
      )
    return () => {
      resetNarrator()
      resetHaptics()
      lastDepthPattern.current = 'none'
    }
  }, [isReady])

  /**
   * The safety decision for one frame: vibration, naming what is ahead, spoken "Stop".
   * Runs exactly once per frame — from `publishSafety` when depth is healthy, otherwise
   * from `publishDetections` with the box heuristic — so `pulseFor` is never called
   * twice for one frame. Returns when a vibration was dispatched, or null.
   * Uses only refs, setters and module functions, so the [] callbacks below can hold it.
   */
  const decide = (thisPattern: PulsePattern, t0: number): number | null => {
    // Haptics first, and unconditionally: this is the safety layer and must not wait
    // on speech, on a name for the obstacle, or on anything off-device.
    const fired = pulseFor(thisPattern)
    const hapticAt = fired !== 'none' ? Date.now() : null
    setPattern(fired)

    // Something within reach: find out what it is, in the background. Once per approach,
    // not every 2 s: segmentation shares the CPU with depth, and running it continuously
    // made 130 of 135 slow frames (>600 ms) on 2026-11-14 — exactly while the user is
    // near something. Leaving the near bands re-arms it and forgets the old name.
    const now = Date.now()
    if (thisPattern === 'none' || thisPattern === 'far') {
      lastNamingAt.current = 0
      sceneName.current = null
    } else if (
      naming.current == null &&
      busyRef.current == null &&
      now - lastNamingAt.current > NAME_EVERY_MS
    ) {
      lastNamingAt.current = now
      naming.current = nameAheadRef.current().finally(() => {
        naming.current = null
      })
    }
    const scene =
      sceneName.current != null && now - sceneName.current.at < NAME_FRESH_MS ? sceneName.current.name : null

    // Too close: say so, and what it is. Detection's name first (a person in front of
    // a wall is a person), then the scene's. Detection is skipped inside the warning
    // bands (shouldDetect), so its name is the last one seen, if recent. Interrupts
    // narration and any read-out — this is the one message that must never wait.
    const recent = lastDetections.current
    const ahead =
      recent != null && now - recent.at < DETECTION_FRESH_MS ? nearestInPath(recent.candidates) : null
    const aheadName = ahead != null ? ahead.key.split('|')[0] : null
    const warning = tooCloseWarning(thisPattern, aheadName ?? scene, closeWarning.current, now)
    if (warning != null) {
      lastWarningFrame.current = { text: warning, t0 }
      alert(warning)
      setLastWarning(warning)
      console.log('warning', warning)
    }
    return hapticAt
  }

  // Depth's result for a frame, scheduled from the worklet BEFORE detection runs on it.
  const publishSafety = useCallback(
    (depthMs: number, depthZones: ZoneDepths | null, depthError: string | null, t0: number) => {
      const publishedAt = Date.now()
      let hapticAt: number | null = null
      // Depth decides when it is ready and healthy — PRD section 5: depth, not
      // detection, must drive safety, a glass door has no COCO class. Without it,
      // publishDetections falls back to the box heuristic for this frame.
      if (depthZones != null) {
        const thisPattern = stablePatternForDepth(depthZones.centre, lastDepthPattern.current)
        lastDepthPattern.current = thisPattern
        setProximityLabel(`${depthZones.centre.toFixed(1)} m (depth)`)
        hapticAt = decide(thisPattern, t0)
      }
      pendingFrame.current = { t0, depthMs, depthZones, depthError, publishedAt, hapticAt }

      const sampling = depthSampling.current
      if (sampling != null && depthZones != null) {
        sampling.push(depthZones)
        if (sampling.length >= DEPTH_SAMPLE_FRAMES) {
          depthSampling.current = null
          const s = depthSample(nextSampleNumber(), Date.now(), sampling)
          recordDepthSample(s)
          setLastResult(`depth sample ${s.sample}: centre ${s.centreM.toFixed(2)} m`)
          alert(`Sample ${s.sample}. ${s.centreM.toFixed(2)} metres ahead.`)
        }
      }
    },
    [],
  )

  // The end of a frame: detection's result (null when it was skipped), narration, and
  // the box fallback when depth had nothing. Always runs after publishSafety for the
  // same frame, since both are queued in order onto the JS thread.
  const publishDetections = useCallback(
    (found: Detected[] | null, frameWidth: number, frameHeight: number, yoloMs: number, t0: number) => {
      const p = pendingFrame.current != null && pendingFrame.current.t0 === t0 ? pendingFrame.current : null
      let publishedAt = p?.publishedAt ?? Date.now()
      let hapticAt = p?.hapticAt ?? null

      // Ranking, cooldowns and proximity live in narrationPolicy — see docs/decisions.md.
      const candidates = found != null ? toCandidates(found, frameWidth, frameHeight, zoneMemory.current) : []
      if (found != null) {
        setLabels(candidates.map((c) => c.text))
        lastDetections.current = { candidates, at: Date.now() }
      }

      if (p?.depthZones == null) {
        // Fallback while depth is loading or throws, not the steady state.
        const path = nearestInPath(candidates)
        setProximityLabel(path != null ? `${path.proximity.toFixed(2)} (bbox)` : '0.00 (bbox)')
        publishedAt = Date.now()
        hapticAt = decide(path != null ? patternFor(path.proximity) : 'none', t0)
      }

      const depthMs = p?.depthMs ?? -1
      setDepthStats({ yoloMs, depthMs, zones: p?.depthZones ?? null, error: p?.depthError ?? null })
      // Evaluation (src/measure.ts): a no-op unless a session is running.
      recordFrame({ t0, yoloMs, depthMs, publishedAt, hapticAt, centreM: p?.depthZones?.centre ?? null })

      // Doors and stairs are landmarks as well as obstacles: announce them like any
      // detected object, with the same cooldowns. Walls are everywhere, so not them.
      const now = Date.now()
      const scene =
        sceneName.current != null && now - sceneName.current.at < NAME_FRESH_MS ? sceneName.current.name : null
      if (scene === 'door' || scene === 'stairs') {
        candidates.push({ key: `${scene}|ahead`, text: `${scene} ahead`, score: 1, zone: 'ahead', proximity: 0 })
      }
      if (found != null || candidates.length > 0) narrate(candidates)
    },
    [],
  )

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet'
      // Rebound by useFrameOutput whenever runOnFrame changes, so this is null
      // only until the model finishes downloading.
      if (runOnFrame == null) {
        frame.dispose()
        return
      }
      try {
        const t0 = Date.now()

        // Depth first, and its warning is sent before detection starts: no warning
        // depends on detection, so it must not wait ~100-700 ms for it. Depth failure
        // must never take detection or haptics down with it — the safety result is
        // still published, with depthZones null, and detection's boxes take over.
        let depthMs = -1
        let depthZones: ZoneDepths | null = null
        let depthError: string | null = null
        if (depthRun != null) {
          try {
            const t1 = Date.now()
            // resizeToInput=false: keep the model's own 140x140 grid, far cheaper than
            // resizing to the full frame just to read three numbers.
            const map = depthRun(frame, false, ['FOREGROUND'], false).FOREGROUND
            const side = Math.round(Math.sqrt(map.length))
            depthZones = zoneDepths(map, side, side)
            depthMs = Date.now() - t1
          } catch (e) {
            depthError = String(e)
          }
        }
        scheduleOnRN(publishSafety, depthMs, depthZones, depthError, t0)

        // Detection only when nothing is within the warning bands — see shouldDetect.
        let yoloMs = -1
        let found: Detected[] | null = null
        if (shouldDetect(depthZones != null ? depthZones.centre : null)) {
          const t1 = Date.now()
          // Rebuild as plain objects — native host objects do not survive the hop to JS.
          // The buffer is sensor-native landscape (e.g. 640x480) but ExecuTorch returns
          // bboxes already rotated to portrait screen space (0-480 wide, 0-640 tall).
          // Dividing by frame.width put the 'on your right' zone past every possible x,
          // so right was never announced. The app is portrait-locked (app.json), so
          // portrait width is the short side.
          // ponytail: assumes portrait; derive from frame.orientation if we ever unlock
          found = runOnFrame(frame, false, {
            detectionThreshold: MIN_SCORE,
            inputSize: INPUT_SIZE,
          }).map((d) => ({
            label: String(d.label),
            bbox: { x1: d.bbox.x1, y1: d.bbox.y1, x2: d.bbox.x2, y2: d.bbox.y2 },
          }))
          yoloMs = Date.now() - t1
        }
        scheduleOnRN(
          publishDetections,
          found,
          Math.min(frame.width, frame.height),
          Math.max(frame.width, frame.height),
          yoloMs,
          t0,
        )
      } finally {
        // Not disposing stalls the camera pipeline.
        frame.dispose()
      }
    },
    [runOnFrame, publishSafety, publishDetections, depthRun],
  )

  const onFrameDropped = useCallback(() => setDropped((n) => n + 1), [])

  // 'rgb' is not optional. ExecuTorch's FrameExtractor accepts only
  // R8G8B8A8 / R8G8B8X8 / R8G8B8 AHardwareBuffers; the default 'native' hands it
  // the camera's YUV (or a vendor-private) format and it throws on every frame.
  const frameOutput = useFrameOutput({ pixelFormat: 'rgb', onFrame, onFrameDropped })

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.status}>Lumina needs the camera.</Text>
        <Pressable style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </Pressable>
      </View>
    )
  }

  if (error != null) {
    return (
      <View style={styles.center}>
        <Text style={styles.status}>Model failed to load</Text>
        <Text style={styles.detail}>{String(error)}</Text>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <Camera
        style={StyleSheet.absoluteFill}
        device="back"
        isActive
        outputs={[frameOutput, photoOutput]}
        constraints={[{ fps: TARGET_FPS }]}
      />

      {/*
        On-demand triggers: the whole screen. A blind user cannot find a button, but can
        always touch the glass.
          tap anywhere        → read text (Phase 4)
          hold and speak      → a voice command (Phase 6): "what's around me",
                                "save this as …", "where am I", "read this"
        TalkBack: the screen is one element. Double-tap reads, double-tap-and-hold
        listens, and both are also in its actions menu (accessibilityActions); from
        the menu, listening ends by itself after a pause.

        The overlay is nested inside so touches on the debug text bubble up to here;
        the Camera stays a sibling underneath so its own native touch handling is
        never in the path.

        ponytail: a palm or thumb brushing the glass while walking will trigger a
        read. Harmless (it just speaks), but if it happens in testing, move reading to
        a volume button. See docs/decisions.md 2026-09-27.
      */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => void readNow()}
        onLongPress={() => {
          holding.current = true
          startListening()
        }}
        onPressOut={() => {
          // Letting go ends the command. A plain tap never set `holding`.
          if (holding.current) voice.stop()
          holding.current = false
        }}
        disabled={busy != null}
        accessibilityRole="button"
        accessibilityLabel="Lumina camera"
        accessibilityHint="Double tap to read text. Double tap and hold, then speak a command."
        accessibilityActions={[
          { name: 'activate', label: 'Read text' },
          { name: 'longpress', label: 'Speak a command' },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'activate') void readNow()
          else if (e.nativeEvent.actionName === 'longpress') startListening()
        }}
      >
      {/* Debug overlay. The real user is blind — this exists for us, not them. Hidden in
          release builds unless EXPO_PUBLIC_SHOW_DEBUG=1 (e.g. for the viva demo). */}
      {showDebug && (
      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.status}>
          {isReady ? `detecting · ${TARGET_FPS} fps` : `downloading model · ${Math.round(downloadProgress * 100)}%`}
        </Text>
        <Text style={styles.detail}>dropped frames: {dropped}</Text>
        {measuring && <Text style={styles.warning}>measuring · say "stop measuring" to finish</Text>}
        <Text style={styles.detail}>
          path proximity: {proximityLabel} · haptic: {pattern}
        </Text>
        <Text style={styles.detail}>
          {depth.error != null
            ? `depth model failed: ${depth.error.slice(0, 120)}`
            : !depth.isReady
              ? 'depth: loading…'
              : depthStats == null
                ? 'depth: ready, waiting for a frame'
                : depthStats.error != null
                  ? `depth error (falling back to bbox): ${depthStats.error.slice(0, 120)}`
                  : `yolo ${depthStats.yoloMs} ms · depth ${depthStats.depthMs} ms`}
        </Text>
        {depthStats?.zones != null && (
          <Text style={styles.detail}>
            L {depthStats.zones.left.toFixed(1)} m · C {depthStats.zones.centre.toFixed(1)} m · R{' '}
            {depthStats.zones.right.toFixed(1)} m
          </Text>
        )}
        <Text style={styles.detail}>
          {offline.error != null
            ? `offline vlm failed: ${String(offline.error).slice(0, 100)}`
            : offline.isReady
              ? `offline vlm ready · loaded in ${((offline.loadMs ?? 0) / 1000).toFixed(1)} s`
              : offline.waitingForWifi
                ? 'offline vlm: waiting for Wi-Fi to download'
                : `offline vlm downloading · ${Math.round(offline.downloadProgress * 100)}%`}
        </Text>
        <Text style={styles.detail}>
          {sceneStat == null
            ? `scene: ${segmenter.isReady ? 'waits until something is within 1.6 m' : 'loading…'}`
            : `scene ahead: ${sceneStat.name ?? 'nothing clear'} · ${(sceneStat.ms / 1000).toFixed(1)} s`}
        </Text>
        {lastWarning != null && (
          <Text style={styles.warning} numberOfLines={2}>
            last warning: {lastWarning}
          </Text>
        )}
        {lastResult != null && (
          <Text style={styles.detail} numberOfLines={4}>
            last {lastResult}
          </Text>
        )}
        {labels.length === 0 ? (
          <Text style={styles.detail}>nothing detected</Text>
        ) : (
          labels.map((label, i) => (
            <Text key={`${label}-${i}`} style={styles.label}>
              {label}
            </Text>
          ))
        )}
        <Text style={styles.detail}>
          {voice.listening ? 'listening…' : busy != null ? `${busy}…` : 'tap: read text · hold: speak a command'}
        </Text>
      </View>
      )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0F' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#0B0B0F',
  },
  overlay: {
    position: 'absolute',
    top: 48,
    left: 16,
    right: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  status: { color: '#F5F5F7', fontSize: 16, fontWeight: '600' },
  detail: { color: '#9A9AA5', fontSize: 13, marginTop: 4 },
  label: { color: '#7FD1AE', fontSize: 15, marginTop: 2 },
  warning: { color: '#FFB86B', fontSize: 14, fontWeight: '600', marginTop: 4 },
  button: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2B6CB0',
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
})
