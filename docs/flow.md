# Execution flow

How control actually moves through the app. Update whenever a new entry point, file,
or call chain appears.

---

## Startup → first spoken word

```
index.ts
  ├─ initExecutorch({ resourceFetcher: ExpoResourceFetcher })
  │    MUST run before any ExecuTorch hook mounts. ExecuTorch downloads model
  │    weights at runtime and ships no fetcher of its own — without this every
  │    model fails to load at runtime, while typecheck and the bundle both pass.
  │    Initialised once here; covers every model added in later phases.
  │
  └─ registerRootComponent(App)          from expo

App.tsx  App()
  ├─ useCameraPermission()               react-native-vision-camera
  │    └─ effect: requestPermission() if not granted
  │         → renders the "Grant camera access" screen until authorized
  │
  ├─ useObjectDetection({ model: models.object_detection.yolo26n() })
  │    react-native-executorch
  │    ├─ downloads yolo26_n_xnnpack_fp32.pte from Hugging Face on first run,
  │    │  then caches it — downloadProgress drives the overlay text
  │    └─ exposes runOnFrame, null until isReady
  │
  ├─ effect on isReady → alert('Lumina ready')   interrupts, bypasses the policy
  │
  └─ useFrameOutput({ onFrame, onFrameDropped })
       └─ returns frameOutput, passed to <Camera outputs={[frameOutput]}>
```

`<Camera>` internally creates its own preview output and merges ours:
`useCamera({ outputs: [previewOutput, ...outputs] })`.

---

## Per-frame path (the hot loop)

Runs on VisionCamera's frame thread, **not** the JS thread.

```
camera pipeline
  └─ App.tsx  onFrame(frame)              'worklet' — frame thread
       ├─ runOnFrame == null?  → frame.dispose(); return
       │    (true only while the model is still downloading)
       │
       ├─ runOnFrame(frame, false, { detectionThreshold, inputSize })
       │    ExecuTorch reads frame.getNativeBuffer() and runs YOLO26n
       │    synchronously. Returns Detection[] — blocks this thread.
       │
       ├─ scheduleOnRN(publish, plainDetections, frame.width)
       │    react-native-worklets — hops to the JS thread, fire-and-forget.
       │    bbox is rebuilt as a plain object: native host objects do not
       │    survive the hop. frame.width must be read before dispose().
       │
       └─ finally: frame.dispose()        MUST happen or the pipeline stalls

App.tsx  publish(found, frameWidth)         JS thread
  ├─ toCandidates(found, frameWidth)        → src/narrationPolicy.ts
  │    per detection: label + zone → key, text, score
  │    zoneOf() splits the frame in thirds by bbox centre-x
  │    score = area × (2 − offCentre) — nearer and more central ranks higher
  ├─ setLabels(...)                         → debug overlay re-renders
  └─ narrate(candidates)                    → src/narrator.ts

src/narrator.ts  narrate(candidates)
  └─ selectAnnouncement(candidates, now, tracks, lastSpokeAt, !speaking)
       │                                    → src/narrationPolicy.ts
       ├─ prune tracks unseen for FORGET_MS (8s) — a returning object is new again
       ├─ mark every visible key as seen — happens even when nothing is spoken,
       │  so an object in view during a long utterance is not wrongly forgotten
       ├─ !canSpeak (already speaking)? → null. Chatter never queues behind chatter.
       ├─ within GLOBAL_MIN_GAP_MS (2.5s) of the last utterance? → null
       └─ highest score first, first key whose delayFor(spoken) has elapsed wins
            delayFor: 3s → 6s → 12s, capped. At most ONE per frame.

  └─ Speech.speak(pick.text, { onDone/onStopped/onError → speaking = false })
```

### Three rate limits, doing different jobs

They stack, and all three are needed:

- **`fps: 8` camera constraint** — how often detection *runs*. Protects the CPU.
- **`GLOBAL_MIN_GAP_MS` (2.5s)** — how often *anything at all* is spoken. Protects the
  user's ability to hear the room, however crowded the scene.
- **`delayFor(spoken)` per key** — how often *this particular object in this zone* is
  repeated. Backs off so a stationary object goes quiet.

At 8 fps a chair in view produces 8 detections a second, one utterance immediately,
then at +3s, +9s, +21s, and every 12s after. Remove any one of the three and the app
breaks in a different way.

---

## Backpressure

`useFrameOutput` defaults to `dropFramesWhileBusy: true`. If `runOnFrame` takes longer
than the frame interval, the pipeline drops frames rather than queueing them and fires
`onFrameDropped` → `setDropped(n => n + 1)`, shown in the overlay.

A climbing dropped count means detection cannot keep up: lower `fps`, lower `INPUT_SIZE`
(384 → the model also accepts 512 and 640, so smaller is the only direction), or reduce
`targetResolution` on `useFrameOutput`.

---

## Not wired up yet

Phases 3–7 from `PRD.md` section 8. When they land, extend this file rather than
starting a new one:

- **M3 depth → haptics.** VisionCamera v5 ships `useDepthOutput`, which may make this a
  second output on the same `<Camera>` rather than a separate ARCore session. Check
  before reaching for ViroReact.
- **M4 OCR** — a user-triggered single-frame path, not part of this hot loop.
- **M5 cloud VLM** — user-triggered, goes out through the Hono endpoint.
- **M6 spatial memory** — CLIP embedding per anchor, then `supabase.rpc('match_anchors')`.
