# Decisions

Why things are the way they are. Newest first.

Founding stack decisions live in [`PRD.md`](../PRD.md) section 5 — this file is
everything decided after that. Record what was **rejected**, not just what was chosen.

---

## 2026-09-27 — Spoken "stop", thresholds from latency, and naming walls/doors/stairs

**The too-close warning is spoken now, not only felt** (`tooCloseWarning`,
`narrationPolicy.ts`). "Stop. Chair right in front of you." It speaks on entering the
imminent zone, repeats every 4 s while there, re-arms on backing off, and interrupts
anything being said.

**`DEPTH_IMMINENT_M` 0.6 → 1.0 m, `DEPTH_NEAR_M` 1.2 → 1.6 m, set from latency.** A depth
result is ~0.45 s old when it lands, and speech takes ~0.2 s to start. At ~1.2 m/s walking
that is ~0.8 m travelled, so a warning at 0.6 m arrived after impact. 1.0 m leaves ~0.2 m.
Faster depth, not a bigger number, is the real fix.

**Walls, doors and stairs are named by SegFormer-B0 (ADE20K, 150 classes).** YOLO's COCO
classes have no wall, door or stairs. COCO's 91-id list has a "door" id, but it was never
annotated, so no COCO model finds doors. SegFormer labels every pixel. `nameAhead`
(`src/sceneNames.ts`) takes the centre region and applies ordered rules: stairs ≥10%,
door ≥15%, railing, window, wall ≥40%. Hazards and landmarks come before walls because
they sit inside walls.

- **512 px, not 256.** On two public test photos, a door filling the view was 10% "door"
  at 256 and **42%** at 512. Wooden doors read as "wardrobe" at 256 (24%) but "door" at
  512 (66%). Walls were fine at either size.
- **Off the frame loop.** 512 is ~4x the work, and in the camera worklet it would stall
  depth and haptics exactly when the user is close. Instead, when depth says near or
  imminent, a silent still (`enableShutterSound: false`) is segmented through
  `forward()` on ExecuTorch's own thread, at most every 2 s. A name is trusted for 3 s.
  Near starts at 1.6 m, so the name is normally ready before the 1 m "stop".
- **Detection's name wins over the scene's** (a person in front of a wall is a person).
  "Door ahead" and "stairs ahead" are also narrated as landmarks; walls are not.
- Exported exactly (100% argmax agreement with PyTorch). Bundled in the APK like depth.
- **Licence: NVIDIA Source Code License, non-commercial (research or evaluation) only.**
  Fine for this project, like YOLO's AGPL. The swap if that ever changes is
  EfficientViT-Seg (Apache-2.0, also ADE20K).

**Rejected:** RF-DETR and SSDLite (COCO, no real "door"), and DeepLab, LRASPP and FCN
(21 VOC classes, no wall). Guessing "wall" from depth shape alone was also rejected: a
wardrobe looks the same.

**Not yet measured on the phone:** SegFormer's latency, and how often it names things
correctly in real rooms. Glass doors are the known weak spot.

## 2026-09-27 — Release readiness: hosted depth model, JWT auth, no Viro

So the app works off the laptop and on phones other than begoniain.

- **Depth model bundled inside the APK** (99 MB, via `metro.config.js` + `require()`).
  It was first hosted on the repo's GitHub release `models-v1` and downloaded at first
  launch. On our home network, the phone's DNS kept resolving GitHub's asset CDN to
  `185.199.109.133`, which never answered (TCP stuck in SYN_SENT; the laptop could not
  reach that address either). **Depth is the safety layer, so it must not depend on a
  first-launch download at all.** The release stays as the build-time source:
  `npm run fetch-models` downloads it with a sha256 check into `assets/models/`
  (gitignored; 99 MB in git history would burden every clone). Result: "depth model
  ready" 1 s after launch, no network. APK 188.6 MB. **Rejected:** committing the binary
  to git, and Hugging Face or Supabase Storage (another account or upload, and still a
  first-launch download).
  Licence: upstream says Depth-Anything-V2-**Small** is Apache-2.0. The metric fine-tune
  is not listed separately, so it is credited in the release notes as the Small model.
- **Backend auth is a Supabase JWT, verified locally.** The project signs ES256 and
  publishes its JWKS, so `jose` checks each token with no call to Supabase and no shared
  secret. Tested: no token, garbage and a forged signature → 401; a real anonymous user →
  200. **Rejected:** the shared `LUMINA_APP_TOKEN` (baked into the APK, so extractable),
  and calling `/auth/v1/user` per request (an extra round trip for the same answer).
  **Known gap:** anyone can mint anonymous users with the public key. Supabase
  rate-limits anonymous sign-ups per IP, which bounds it. A per-user daily cap is the next
  step if the free tier is abused (`ponytail:`).
- **Viro and the depth spike removed** (`src/DepthSpike.tsx`, `@reactvision/react-viro`,
  `expo-clipboard`). The spike's question was answered on 2026-09-23 (no ARCore depth on
  begoniain). Viro's plugin also overwrote manifest `<queries>` (`docs/bug.md`). If
  ARCore guidance is ever built, bring ARCore back deliberately.
- **Offline VLM downloads on Wi-Fi only** (`expo-network`), then loads from storage on
  any connection. It is latched for the session, so leaving Wi-Fi never unloads it.
  **Rejected:** an opt-in setting, which a blind user would have to find.
- **Debug overlay hidden in release builds** unless `EXPO_PUBLIC_SHOW_DEBUG=1`.
- **Release APK signed with React Native's public debug keystore** (the template default,
  identical on every machine). Fine for sideloading. A private keystore is needed before any
  distribution. **Known gap:** uninstalling loses the anonymous user, and with it the saved
  places. The fix is Supabase account linking, which is not built.

## 2026-09-27 — Phase 6: recognition first, hold-and-speak, anonymous Supabase users

**Chose — recognition, not guidance.** "Save this as the kitchen" stores a CLIP
descriptor of the current view; "where am I" names the closest saved place when it is
close enough. No turn-by-turn guidance between places. That needs ARCore VIO, which must
own the camera and would switch off detection, depth, OCR and describe. ARCore also
returned no depth on begoniain (2026-09-23). **Rejected for now:** the PRD's full
ARCore + Cloud Anchors design. Revisit on a phone where ARCore tracking is proven.

**Chose — hold-and-speak voice commands** (`src/useVoiceCommand.ts`,
`src/commands.ts`, `expo-speech-recognition` 57.1.0). Hold is the one gesture for
everything spoken: "what's around me", "save this as …", "where am I", "read this".
Tap stays as read-text. A haptic tick, not speech, signals listening, because the mic
would transcribe our own voice. Narration pauses while listening; haptics never do.
**Rejected:** another gesture for saving (clashes with TalkBack, and does not scale).

**Chose — anonymous Supabase sign-in**, with the session kept in a file via
`expo-file-system` (`src/supabase.ts`). **Rejected:** email/password (a blind user should
not have to type credentials), and AsyncStorage (a new native module and another
rebuild, when `expo-file-system` was already in the build). The session must survive
restarts. A new anonymous user each launch would lose every saved place, because RLS
scopes places to the user.

**CLIP descriptor verified against the schema:** the library's int8 CLIP ViT-B/32 image
model outputs `(1, 512)`, already L2-normalised. It was run on the laptop before the
migration was applied, so `vector(512)` + cosine is correct as written.

**Verified against the live project** (2026-09-27, with throwaway users): a save matched
itself at 1.0 and an unrelated vector at 0.04. A second user could not list, match or
insert into the first user's places (403 on insert).

**Threshold `MATCH_THRESHOLD = 0.85` (a guess, `ponytail:`).** On the phone the saved
spot matched at **0.92** and was named. A different, unsaved room was **not** named.
After it was saved as "dining room", it was. The non-match score still needs to be read
from the log to know the margin. If other rooms score close to 0.85, raise it.

## 2026-09-27 — Phase 7: LFM2.5-VL-450M on the phone, only when the cloud fails

**Chose:** `models.llm.lfm2_5_vl_450m()` from react-native-executorch, the PRD's model
family, pre-converted, with no export work. It is a fallback inside `describeNow`: the
cloud goes first, and **any** cloud failure (no network, timeout, server error) falls
through to the phone. `src/useOfflineDescriber.ts`.

**Rejected:**
- **LFM2.5-VL-1.6B**, the PRD's exact pick. It is a 2.4 GB download, and the phone had
  ~2.2 GB free RAM with YOLO and depth loaded.
- **Gemma 4 E2B multimodal**, which the library also ships. It is not the PRD's model,
  and nothing measured says it is better. Try it only if the 450M's quality is not enough.
- **Offline first.** At ~14 s against 2–4 s it is strictly worse whenever there is signal.

**Measured on begoniain (2026-09-27, YOLO and depth running alongside):**

| | |
|---|---|
| Download | 649 MB, once, automatic on first launch (`ponytail:` make opt-in / Wi-Fi only) |
| Load from storage | 4.3–4.5 s |
| Describe, two sentences (28–37 tokens) | **14.4–14.5 s** |
| Describe, one short sentence (6–12 tokens) | 4.1–5.3 s |
| Prompt size | ~297 tokens, most of it the image |
| App memory, all three models loaded | 1.58 GB PSS. 1.69 GB left free on this 6 GB phone |

Time scales with the words written (~0.4 s per token), not with reading the image. If
14 s is too long in testing, ask for one sentence first (it roughly halves the time).
Pausing YOLO and depth during generation is the other lever, but it pauses the safety
layer, so it is not done.

**The prompt matters more than usual at 450M.** The first prompt listed example hazards,
and the model repeated them for a photo of a keyboard ("…facing stairs, a door, or an
obstacle"). A system prompt with no examples ("Only mention things that are clearly
visible. Never guess") described a bedroom and a test JPEG accurately.

**Open:** one run described a bright room as "completely black". That photo was taken
~10 s after launch and not kept, so the cause is unconfirmed. Suspects are an unsettled
exposure at camera start, or the phone facing something dark. If it recurs, suspect
camera warm-up, which would also affect OCR and cloud describe right after launch.

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

**Auth stopgap** (superseded the same day by a Supabase JWT check, see the release-readiness entry): an optional shared token (`LUMINA_APP_TOKEN` / `EXPO_PUBLIC_LUMINA_TOKEN`).
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
