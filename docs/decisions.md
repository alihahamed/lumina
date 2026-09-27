# Decisions

Why things are the way they are. Newest first.

Founding stack decisions live in [`PRD.md`](../PRD.md) section 5 — this file is
everything decided after that. Record what was **rejected**, not just what was chosen.

---

## 2026-09-27 — Phase 5: Gemini 3.1 Flash-Lite with a 3.5 fallback, not the PRD's 2.5; hold to describe

**Model changed from the PRD (section 5, Gemini 2.5 Flash-Lite).** Google's deprecations
page (checked 2026-09-27) says the 2.5 models are now "limited to users who have actively
used them in the past", so a new API key would likely be refused. `gemini-3.5-flash-lite`
(GA July 2026) is the current Flash-Lite and was the first pick. It has a free tier and
takes image input.

**Then measured and reversed** (free tier, 38 calls, 2026-09-27, bicycle test JPEG):

| Model | Calls | Hung (no answer in 8 s, one tried to 45 s) | Answer time when it answered |
|---|---|---|---|
| `gemini-3.5-flash-lite` | 21 | **12** | 2.4–4.4 s |
| `gemini-3.1-flash-lite` | 18 | 0 | 2.1–4.6 s |

Latency is answer-or-hang, not slow, so a long timeout only makes the user wait for
nothing. The backend gives each attempt 8 s, then tries the other model. **3.1 is primary
and 3.5 is the fallback.** 3.1 shuts down May 2027. After that it returns 404, which the
backend treats as "try the next model" (tested with a fake model name), so that date
degrades to 3.5 rather than breaking. Both are overridable with `GEMINI_MODEL` and
`GEMINI_FALLBACK_MODEL`. **Revisit** if 3.5's hang rate drops. It was two months old
when measured.

**Gemini 3 thinks by default,** and thought tokens count against `maxOutputTokens`. The
request sets `thinkingLevel: 'minimal'` and raises the budget from 150 to 400, so a
thinking model cannot spend the whole budget and return nothing. **Verified live**:
both models accept the field.

**Gesture: press and hold anywhere.** Tap was already taken by reading. TalkBack users
get double-tap-and-hold, and both actions are in TalkBack's actions menu through
`accessibilityActions`. **Rejected:** a two-finger tap (TalkBack reserves multi-finger
gestures) and a voice command (no STT yet).

**Dev path without deploying:** `backend/src/dev.ts` serves the same Hono app on the
laptop, and the phone reaches it with `adb reverse tcp:8787 tcp:8787`. Vercel only
matters once someone tests away from the laptop.

**Auth stopgap:** an optional shared token (`LUMINA_APP_TOKEN` / `EXPO_PUBLIC_LUMINA_TOKEN`).
It is baked into the app, so it only stops a leaked URL being used by strangers. The real
fix is a Supabase JWT once auth exists. `ponytail:` at the site.

## 2026-09-27 — Phase 4 OCR: `@react-native-ml-kit/text-recognition`, not ExecuTorch's own

**Chose:** the community `@react-native-ml-kit/text-recognition` package (Google ML Kit
Text Recognition v2, wrapped as a plain RN native module — `src/ocr.ts`, `App.tsx`), a
new dependency. This is the PRD section 5 decision (ML Kit specifically, for Latin +
Devanagari), not something decided fresh here.

**Rejected:** `react-native-executorch`'s own bundled OCR (`useOCR`, `useVerticalOCR`,
already installed, zero new dependency). Worth naming because it's the more obvious
choice on a fresh look — it's already in the project. Did not switch to it silently: the
PRD's ML Kit choice was made for Devanagari support specifically (PRD section 2, local
signage), and nobody has confirmed whether ExecuTorch's bundled model covers that script.
If it turns out to, revisit — one fewer native dependency is worth it — but that is a
decision to open, not assume.

**How it's wired:** VisionCamera's `usePhotoOutput` (a second `CameraOutput` alongside
the existing `frameOutput`, both passed to the one `<Camera>`) captures a still to a
temp file on request; `TextRecognition.recognize(uri)` reads it; the file is deleted
straight after (`expo-file-system`'s new `File` API, SDK 57 — the phone has run low on
storage before, and a photo of someone's surroundings should not sit on disk).

**Confirmed:** typechecks, old-architecture native module (no TurboModule/Codegen spec)
on a `newArchEnabled: true` project — relies on RN's legacy-interop compatibility layer.
**Not yet confirmed:** that the interop layer actually works for this module on device;
needs the native rebuild (`npx expo run:android`) that a plain `npm install` doesn't
trigger, since this adds Android/Java code, not just JS.

**Trigger: the whole screen (changed same day).** The first version was a labelled
button, which a blind user cannot find. Now a transparent full-screen `Pressable` sits over
the camera, with the debug overlay nested inside it so taps on the text bubble up. Sighted
users tap anywhere. With TalkBack the screen is one element, so its double-tap-to-activate
works from anywhere. The startup announcement says "Tap anywhere to read text", because
being told is the only way a blind user learns the gesture exists.

**Rejected:** a volume-button trigger (needs a new native module, since RN cannot see key
events). A voice command ("read that") (no STT pipeline exists yet). A hand-rolled custom
double-tap (it fights TalkBack, which already owns double-tap).

**Known risk:** a palm or thumb brushing the glass while walking will trigger a read.
It is harmless, since it only speaks. If it happens in testing, move to long-press or a
volume button. `ponytail:` at the site.

**Constrains Phase 5:** "tap" is now taken. "What's around me?" will need a different
gesture, such as long-press, or a voice command.

## 2026-09-27 — Depth at 140px is fast enough; it now drives haptics, not the bbox size

**Measured on begoniain:** shrinking the export from 252px to **140px** (Depth Anything's
patch size is 14, so 140 is the smallest clean multiple worth trying) took depth from
**1297 ms to 330 ms** per frame, verified bit-identical to PyTorch first (`verify2.py`).
Combined with YOLO's ~105 ms that is ~435 ms/frame — still above the reflex budget in
PRD section 4, but close enough that riding it as the primary safety signal beats staying
on a heuristic that cannot see a wall at all.

**Chose:** depth now decides the haptic pattern whenever it has loaded and the frame
succeeded (`patternForDepth` in `narrationPolicy.ts`, thresholds 0.6 / 1.2 / 2.5 m —
**guesses**, not measured against a real corridor). The bbox heuristic (`patternFor`,
`nearestInPath`) is the fallback for while the model is still loading or a frame throws,
not the steady state anymore. `haptics.ts`'s `pulseFor` was refactored to take an
already-decided `PulsePattern` rather than compute one from a bbox proximity itself — one
function, one piece of cooldown state, whichever source is live. Calling it from both
bbox and depth in the same frame would have double-buzzed.

**Rejected (for now):** pushing further on speed (112px, int8 quantisation) before
wiring anything up. Decided the pipeline was worth proving end-to-end at 330 ms first;
if 435 ms/frame turns out to visibly lag underfoot, revisit — the options are recorded
in the 2026-09-26 entry below and still apply.

**Confirmed on device:** app does not crash, no ExecuTorch errors in logcat, overlay
reads `path proximity: 2.1 m (depth) · haptic: far` — consistent with the L/C/R readings
and `patternForDepth`'s thresholds. **Not confirmed:** whether 2.1 m was the *true*
distance to anything in frame — no tape measure was used. Depth accuracy against ground
truth is still an open item; see STATUS.md section 5.

## 2026-09-26 — Depth via a custom "segmentation" model; fp32 is too slow

**Chose:** run Depth Anything V2 **Metric-Indoor-Small** through
`SemanticSegmentationModule.fromCustomModel` (`src/useDepth.ts`), not a new library.
`react-native-executorch` 0.9.3 has no depth model, but for a single-channel `[1,1,H,W]`
output the native runtime returns the values **raw** as `FOREGROUND` (no sigmoid or
softmax; `BaseSemanticSegmentation.cpp` `computeResult`, `numChannels == 1`). So a depth
model exported to that contract comes back in metres through the same `runOnFrame`
worklet path YOLO uses. Export: `scripts/export_depth.py`.

**Rejected:**
- `useExecutorchModule` (generic). `forward()` takes JS-side `TensorPtr[]`, no
  `runOnFrame`, so every frame would be copied into JS and resized there. Defeats the
  reason for choosing this stack (PRD section 5).
- Relative-depth Depth Anything V2 (the plain "small"). Outputs disparity with an unknown
  scale per image, so "1 m" is not a number. Metric-Indoor gives metres directly.
- Waiting on an upstream depth model. Blocks Phase 3 with no date.

**Measured on begoniain (2026-09-26, fp32, 252x252, XNNPACK CPU, alongside YOLO):**
YOLO 139 ms, depth **1297 ms** per frame. Far over the reflex budget (PRD section 4), so
**depth cannot drive haptics as exported.** Not yet measured against a real scene: the
preview was black during the run, so the 1.2 m L/C/R reading proves the pipeline, not
accuracy.

**What would change our mind / next options, cheapest first:** smaller input (196 or 140),
run depth every Nth frame and hold the last value, int8 XNNPACK quantisation (~4x smaller,
usually faster), or a different model. If none gets under ~300 ms on this phone, depth
stays an on-demand check and haptics stay on the bbox heuristic.

**Toolchain gotchas** (cost time, not obvious): `executorch` 1.2.0's compiled bindings
need `torch==2.11.0` exactly (pip resolves 2.14 and it fails with an undefined symbol);
`flatc` lives in the venv `bin` and must be on `PATH` when exporting; python3.13 without
the venv package needs `venv --without-pip` then `get-pip.py`. Runtime version inside
`react-native-executorch` 0.9.3 could not be read; the 1.2.0 export loaded fine.

## 2026-09-23 — Depth spike on Redmi Note 8 Pro: rays fail, still-shot YOLO passes

**Device:** Redmi Note 8 Pro (`begoniain`). Logs in [`depth-spike-session.md`](depth-spike-session.md).

**Chose (for Phase 3 next work):** treat **monocular depth on existing VisionCamera
frames** (Depth Anything V2-small → ExecuTorch) as the primary path to real obstacle
distance on phones where Viro hit tests do not return depth. Keep **bbox heuristic**
haptics until that lands.

**Chose (timing):** **on-demand** object naming from a still is fast enough when we have
one — screenshot → `forward()` measured **358–592 ms** total (typical ~400 ms), within the
team’s ~600 ms bar. That does **not** require swapping camera owners during a walk.

**Rejected (on this device, this spike build):** **ARCore/Viro three-ray continuous depth**
for haptics. Every `performARHitTestWithPoint` reading was `depth: null`, `source: "none"`.
Cannot validate walls/glass/doorway via rays; cannot commit to “ARCore holds the camera
permanently + automatic 3-ray buzz” on begoniain from this data.

**Rejected (reconfirmed):** **Swapping** ARCore ↔ VisionCamera while walking. Swap to
camera **1145 ms** on this session (consistent with ~1.2 s measured earlier on A001).

**Rejected for now:** Assuming the August note “ARCore works in software” means **this**
Viro spike path is production-ready without a per-device spike pass.

**Still open:** Run the same spike on **A001** (Android 16). If rays work there, ARCore-first
architecture may remain valid for that hardware while begoniain uses ExecuTorch depth on
VisionCamera. M6 (Cloud Anchors) may still force ARCore on some devices regardless.

**Would change our mind:** Non-null depths with `source: arcore` on begoniain after a
documented retry (tracking init, lighting, permissions); or Depth Anything on CPU proves
too slow on device.

---

## 2026-08-23 — Haptics ship on a proximity heuristic, not real depth

**Chose:** estimate proximity from where a bounding box's *base* sits in the frame, and
drive haptics from the nearest object in the centre zone.

**Rejected:** `useDepthOutput` (VisionCamera v5), ViroReact + ARCore Depth API, and a
monocular depth model — all three for concrete reasons below.

**Why the PRD's plan does not work on this hardware.** `PRD.md` says depth drives the
haptics. It still should. But:

1. **No hardware depth on the test device.** `adb shell dumpsys media.camera` reports
   only `BACKWARD_COMPATIBLE` and `LOGICAL_MULTI_CAMERA` — **no `DEPTH_OUTPUT`**. So
   `useDepthOutput` has no stream to consume. Check this before assuming any device works:

   ```bash
   adb shell dumpsys media.camera | grep -oE "DEPTH_OUTPUT|LOGICAL_MULTI_CAMERA"
   ```

2. **ARCore Depth would work, but fights us for the camera.** ARCore *is* installed and
   its Depth API is ML-based, so it needs no depth hardware. But reaching it from React
   Native means ViroReact, which runs its **own ARCore camera session** — and on Android
   two sessions cannot own the camera at once. Adopting it means ARCore owns the camera
   and YOLO26n is fed from ARCore frames, which ViroReact does not expose. That is a
   re-architecture, not an addition.

3. **No prebuilt depth model.** `react-native-executorch`'s registry has no depth
   category (llm, classification, object_detection, pose, segmentation, style_transfer,
   speech, embeddings, ocr, vad — no depth). Depth Anything would have to be exported to
   ExecuTorch by us.

**The heuristic.** For a forward-facing camera at chest height, an object's base falls
lower in the frame the closer it is. Crucially this is **independent of object size** —
unlike box area, which cannot tell a near chair from a distant sofa. `proximityOf()`
returns `y2 / frameHeight`, clamped.

**Its ceiling, honestly.** It assumes the object rests on the floor and the phone is held
roughly upright. A sign on a wall reads as far away. A phone tilted down reads everything
as close. It is a monotonic ordering, not metres, so it cannot say "two metres ahead".
Marked with a `ponytail:` comment at the site.

**Only the centre zone buzzes.** Things to the side get walked past; buzzing about them
trains the user to ignore the buzz.

**Pulse rate rises with proximity** (1200ms → 250ms) and so does strength (Light →
Medium → Heavy). Two channels carrying one message, so it still reads through a pocket.
A rising rate is understood without being taught.

**The real fix, ranked:**

1. Export Depth Anything V2-small to ExecuTorch and run it as a second model on the
   frames we already have. No second camera session, no ViroReact. Best path.
2. Test on a device with a ToF sensor, where `useDepthOutput` works as originally planned.
3. Re-architect around ARCore. Only worth it if we need Cloud Anchors for M6 anyway —
   revisit then, since M6 may force this decision regardless.

**Would change our mind:** blindfold testing showing the heuristic misjudges obstacles
dangerously. Given it cannot see walls, glass, or steps at all, that is likely — which is
why (1) matters and this is explicitly an interim.

---

## 2026-08-23 — Narration announces changes, not state

**Chose:** rank all detections, speak at most one per frame, key cooldowns on
`label + zone`, back off while an object persists, and enforce a global gap.

**Rejected:** a flat per-label cooldown (what we shipped first), and narrating every
detection.

**Why:** the first version reported *what the camera sees*, continuously. A person
standing still was announced every 3 seconds forever, and five objects in frame
produced five sentences. That is the failure mode that gets assistive apps uninstalled
— the user cannot hear the actual room over the narration and stops trusting it.

The policy now:

| Rule | Effect |
|---|---|
| Key on `label + zone` | A person crossing left→right is news. Standing still is not. |
| Backoff 3s → 6s → 12s | Your own desk chair goes quiet in ~20s instead of repeating forever. |
| Forget after 8s absent | Leaving and returning resets the backoff, so it is announced again. |
| One utterance per frame, ranked | Five objects produce one sentence, not five. |
| Global 2.5s floor | The user keeps the gaps needed to hear traffic and footsteps. |

**Ranking** is box area (proxy for proximity) boosted toward the frame centre (in the
user's path). Deliberately crude — it is replaced by real depth in M3. Box size is a
bad distance proxy: a near chair and a far sofa look identical.

**Three zones, not five.** Under stress nobody can act on "slightly left of centre".

**Rejected for now — audio panning.** Speaking into the ear matching the direction
beats the word "left": blind users localise sound faster than they parse a sentence,
and it frees the words to carry distance instead. Needs a real audio graph rather than
`expo-speech`, so it belongs with M3 alongside depth.

**Would change our mind:** blindfold testing. Every number here (3s, 12s, 2.5s, three
zones) is a guess until someone walks a corridor with it. They are named constants at
the top of `narrationPolicy.ts` for exactly that reason.

---

## 2026-08-23 — `react-native-worklets`, not `react-native-worklets-core`

**Chose:** `react-native-worklets` (Software Mansion) + `react-native-vision-camera-worklets`.

**Rejected:** `react-native-worklets-core` (mrousavy). It was installed first and was wrong.

**Why:** VisionCamera v5's `useFrameOutput` explicitly requires
`react-native-vision-camera-worklets`, which is built on `react-native-worklets`.
`worklets-core` is the v4-era package and provides an incompatible runtime.

The two packages look interchangeable and are not. `worklets-core` exposes
`useRunOnJS` / `useSharedValue`; `react-native-worklets` exposes `scheduleOnRN` /
`runOnJS` and has no shared-value hooks (those live in Reanimated).

**Consequence:** the worklet hops back to JS with `scheduleOnRN(publish, labels)`.
There is no shared value available for worklet-side state — see the fps decision below.

**Would change our mind:** VisionCamera changing its worklets backend again.

---

## 2026-08-23 — Throttle inference with camera fps, not inside the worklet

**Chose:** `constraints={[{ fps: 8 }]}` on the `<Camera>`.

**Rejected:** a frame counter or timestamp check inside the `onFrame` worklet.

**Why:** worklet-side throttling needs mutable state shared into the worklet runtime.
`react-native-worklets` has no shared-value hook (see above), so it would have meant
pulling in Reanimated or `createSynchronizable` for what is a one-line camera constraint.

Capping the whole pipeline is also strictly cheaper — the camera never produces the
frames in the first place, rather than producing and discarding them.

**Cost:** the preview is choppy at 8 fps. Irrelevant here: the preview exists only for
our debug overlay, and the actual user is blind.

**Watch out:** when ARCore lands (M3) it runs its own camera session at its own rate.
This constraint does not apply to it, and the two sessions may contend.

**Would change our mind:** needing a smooth preview for a sighted-assistant mode, or
finding 8 fps too slow to catch obstacles at walking pace. Measure before changing.

---

## 2026-08-23 — Split the policy out of `narrator.ts`

**Chose:** all decision logic in `src/narrationPolicy.ts`, speech in `src/narrator.ts`.
(Originally `rateLimit.ts`; renamed when the module's job grew from "when may we
repeat" to "what do we say and when".)

**Rejected:** one `narrator.ts` file.

**Why:** `narrator.ts` imports `expo-speech`, a native module that cannot load under
plain `node`. Splitting the pure decision function out means the only non-trivial logic
in the narration path is testable with `npm test` and no device, no emulator, no mocking.

This is the *only* reason for the split, and it has paid for itself: the test caught a
real backoff bug (doubling on the first utterance skipped the 3s step, so the sequence
was immediate → 6s → 12s instead of 3s → 6s → 12s) that would have needed a stopwatch
and a corridor to notice otherwise.

Do not add more files on the same logic — if it does not need testing without a device,
it belongs in `narrator.ts`.

---

## 2026-08-23 — Cap detection expectations at CPU speed, not NPU

**Chose:** treat YOLO26n as a ~100–300 ms/frame CPU workload.

**Why:** the weights `models.object_detection.yolo26n()` fetches are an **XNNPACK**
build (`.../n/xnnpack/yolo26_n_xnnpack_fp32.pte`). XNNPACK is a CPU backend. Earlier
planning assumed the Qualcomm QNN NPU delegate and a 12–15 ms figure — that is not what
ships, and any report text quoting the NPU number is wrong.

**Path to the NPU number:** export a QNN build of YOLO26n ourselves and host it, then
pass the URL as `modelSource`. Real work, not a config flag. Not worth it until the CPU
path is proven too slow.

---

## 2026-08-23 — Removed Expo's `LICENSE`; repo is unlicensed for now

**Chose:** delete the file, flag the decision in `README.md`.

**Why:** the scaffold shipped Expo's MIT licence with *Expo's* copyright line. Keeping it
would have asserted Expo's copyright over our work — factually false.

Unlicensed means all rights reserved, which is a safe default while we decide.

**The actual constraint:** YOLO26 is AGPL-3.0. That shapes what we can release. Decide
before the repo gets any outside contributors.

---

## 2026-08-23 — `Frame` typed from VisionCamera, not ExecuTorch

**Chose:** `import type { Frame } from 'react-native-vision-camera'` in `App.tsx`.

**Why:** both libraries export a `Frame` type. ExecuTorch's has `getNativeBuffer()` and
`orientation` but **no `dispose()`**, so typing the `onFrame` parameter from ExecuTorch
made `frame.dispose()` a type error.

VisionCamera's `Frame` is structurally assignable to ExecuTorch's, so `runOnFrame(frame, …)`
accepts it and `dispose()` type-checks. Failing to dispose stalls the camera pipeline, so
this is not cosmetic.
