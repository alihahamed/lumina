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
  ├─ effect on isReady → announce('ready', 'Lumina ready', 'alert')
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
       ├─ scheduleOnRN(publish, labels)   react-native-worklets
       │    hops to the JS thread, fire-and-forget
       │
       └─ finally: frame.dispose()        MUST happen or the pipeline stalls

App.tsx  publish(labels)                   JS thread
  ├─ setLabels(labels)                     → debug overlay re-renders
  └─ for each label:
       announce(label, `${label} ahead`)

src/narrator.ts  announce(key, text, priority)
  ├─ priority 'info' && speaking?  → drop. Chatter never queues.
  ├─ shouldAnnounce(key, Date.now(), seen)  → src/rateLimit.ts
  │    false if this key spoke within COOLDOWN_MS (3000)
  │    on true it records now in `seen`, which is what starts the next cooldown
  ├─ priority 'alert'? → Speech.stop() first
  └─ Speech.speak(text, { onDone/onStopped/onError → speaking = false })
```

### Two rate limits, doing different jobs

They stack, and both are needed:

- **`fps: 8` camera constraint** — how often detection *runs*. Protects the CPU.
- **`COOLDOWN_MS` per label** — how often a given label is *spoken*. Protects the user.

At 8 fps a chair in view produces 8 detections a second but one utterance every 3
seconds. Removing either one makes the app unusable in a different way.

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
