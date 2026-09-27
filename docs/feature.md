# Features

A start-to-finish trail for each thing built, written so someone who was not involved
can pick it up cold. Newest first.

---

## 2026-09-27 — Phase 7: describe with no network (on-phone VLM)

**Status:** the model works on device. It described a bedroom and a known test JPEG
accurately (benchmark run, 2026-09-27). The fallback path was then run by hand with the
backend stopped: 16.6 s, no crash. **Whether that description matched the room was not
reported.** See `test-checklist.md` Phase 7.
**Covers:** `PRD.md` section 8 phase 7, module M5 (offline half).
**Files:** `src/useOfflineDescriber.ts`, `src/text.ts` (+ `text.test.ts`), `App.tsx`
(`describeNow`'s catch, the "offline vlm" overlay line).

### What it does

Hold anywhere. The cloud describe runs as before. If it fails for any reason, the app says
"No connection. Describing on the phone, this takes a moment", runs LFM2.5-VL-450M on the
same photo, and speaks the first two complete sentences (`firstSentences`). A 30 s timer
calls `interrupt()`, because the library has no max-tokens setting.

### How to pick this up

- **First launch downloads 649 MB** on the phone's network. The overlay shows the
  progress. It is cached after that, and later launches load in ~4.5 s.
- Numbers, rejected options and the prompt lesson are in `docs/decisions.md`.
- **Do not add example words to the prompt.** At 450M the model repeats them.

### Shortcuts, on purpose

- Automatic 649 MB download on first launch. Must become opt-in and Wi-Fi-only before
  real users. `ponytail:` in `App.tsx`.
- The model stays loaded all session (~1.6 GB total app RAM). Loading on demand would add
  ~4.5 s to an already ~14 s wait.

## 2026-09-27 — Phase 5: "What's around me?" (cloud scene description)

**Status:** the backend works against real Gemini. 8/8 calls answered in 2.1–3.7 s on
the final config, with sensible hazard-first descriptions. Model choice and measurements
are in `docs/decisions.md`. The app shows the new hint on device. **Confirmed on the phone by
hand:** hold anywhere described the room correctly (Gemini 4.0 s).
**Covers:** `PRD.md` section 8 phase 5, module M5 (cloud half) and M8.
**Files:** `src/describe.ts`, `App.tsx` (`withStill`, `describeNow`, `onLongPress`,
`accessibilityActions`), `backend/src/index.ts`, `backend/src/dev.ts`, `backend/.env.example`.

### What it does

Press and hold anywhere. The app says "Looking", takes the same HD still as OCR, sends it
as base64 to `POST /describe`, and speaks the 2–3 sentence answer with `alert()`. The
photo is deleted afterwards. OCR and describe share `withStill`, so only one runs at a
time and they never fight over the photo output.

Failures are spoken in words the user can act on (`DescribeError`): "Check the internet
connection", "That took too long", or "Could not describe that". An offline fallback is
Phase 7.

### Run it locally

```bash
cp backend/.env.example backend/.env    # paste GEMINI_API_KEY
cd backend && npm install && npm run dev  # http://localhost:8787
# root `npm run dev` forwards 8787 as well as 8081. After a replug, rerun it or:
adb reverse tcp:8787 tcp:8787
```

The app defaults to `http://localhost:8787`. For a deployed backend, set
`EXPO_PUBLIC_DESCRIBE_URL` (and `EXPO_PUBLIC_LUMINA_TOKEN` if the server sets one) in a
root `.env`, then restart Metro. `EXPO_PUBLIC_` values are baked in at bundle time.

### Shortcuts, on purpose

- **No caching**, although the PRD says "cache hard". Each hold is one call. The free
  tier covers testing. Add caching if usage grows.
- **Auth is a shared token**, see `docs/decisions.md`.
- **The Vercel entry point is still unverified.**

## 2026-09-27 — Phase 4: on-demand text reading (ML Kit OCR)

**Status:** **working on device** (begoniain, 2026-09-27). A teammate pointed it at a
book and it read the text aloud correctly. Trigger changed later that day from a button to
tap-anywhere. That change is typechecked and the layout was checked by screenshot, but the
tap-anywhere trigger was then **confirmed by hand** the same day. See `test-checklist.md`.
**Covers:** `PRD.md` section 8 phase 4, module M4.
**Files:** `src/ocr.ts`, `App.tsx` ("Phase 4" additions — `usePhotoOutput`, `readNow`,
the `readButton`), `package.json` (`@react-native-ml-kit/text-recognition`).

### What it does

Tapping the "Read text" button takes a still photo (`usePhotoOutput`, a second
`CameraOutput` running alongside the existing `frameOutput` on the same `<Camera>`),
runs it through Google ML Kit's on-device text recognition, and speaks the result with
`alert()` — the interrupt-and-speak-now path, not the rate-limited narration queue,
because a user-requested answer must never wait behind ambient chatter. The temp photo
is deleted immediately after, successful or not.

### Why this package, not what's already installed

`react-native-executorch` already ships OCR hooks (`useOCR`, `useVerticalOCR`) — zero new
dependency. Used the PRD's actual choice instead (`@react-native-ml-kit/text-recognition`,
Google ML Kit) because the PRD picked ML Kit specifically for Devanagari support (local
signage), and nobody has checked whether ExecuTorch's bundled model covers that script.
Full reasoning and what would change this: `docs/decisions.md` 2026-09-27.

### How it was built

1. Checked the package is still maintained and RN-0.86-compatible before installing —
   last published 2025-09, no Expo config plugin needed (plain autolinked native module,
   like VisionCamera and ExecuTorch, not like Viro).
2. It is an **old-architecture** native module (`ReactContextBaseJavaModule`, accessed via
   `NativeModules`, no Codegen spec) on a `newArchEnabled: true` project — relies on RN's
   legacy-interop layer. Confirmed it typechecks; **on-device behaviour is the real test**,
   see below.
3. `usePhotoOutput({ targetResolution: CommonResolutions.HD_4_3 })` — not the 4K default,
   plenty for a sign, far less to capture and process.
4. `capturePhotoToFile` returns a bare filesystem path, not a `file://` URI — both ML
   Kit's `recognize()` and `expo-file-system`'s new `File` class (SDK 57) need the prefix
   added by hand.
5. Deletes the temp photo in a `finally`, whether or not OCR succeeded — this phone has
   run out of storage before, and a photo of someone's surroundings should not linger.

### How to pick this up / verify

This needed `npx expo run:android`, not just a Metro reload — it adds Android/Java code,
`npm install` alone does not link it. Once built: tap **Read text** in front of printed
text and confirm it's spoken aloud; check `adb logcat` for the interop layer actually
resolving `NativeModules.TextRecognition` if it silently does nothing.

### Shortcuts, on purpose

- **Trigger is tap-anywhere**, not a button. See `docs/decisions.md` for what was
  rejected. A stray palm touch will trigger a read. `ponytail:` at the site.
- **adb cannot drive this on begoniain.** MIUI silently drops `adb shell input tap` unless
  Developer options → "USB debugging (Security settings)" is on, which needs a Mi account.
  The command reports success anyway. Test taps by hand.
- No language/script selection exposed yet — always recognises Latin. Devanagari needs a
  `TextRecognitionScript.DEVANAGARI` argument threaded through once it matters for testing.

## 2026-09-26 — M7 Supabase schema and M8 Gemini proxy (written, not deployed)

**Status:** code written and locally checked. **Nothing is deployed, no client calls
either yet.** Phase 5 (cloud VLM) and Phase 6 (route memory) still need the app side.
**Covers:** `PRD.md` modules M7 and M8.
**Files:** `supabase/migrations/0001_routes_anchors.sql`, `backend/src/index.ts`,
`backend/package.json`, `backend/tsconfig.json`

### What it does

- **M7.** `routes` and `anchors` tables, `vector(512)` descriptor with an HNSW cosine
  index, RLS on both, and `match_anchors()`. Schema is `PRD.md` section 7 verbatim plus the
  RLS policies and `user_id default auth.uid()` so the client never has to send it.
  `match_anchors` is left as security invoker on purpose so RLS covers it.
- **M8.** Hono app with `GET /health` and `POST /describe {image: base64 JPEG}` that calls
  `gemini-2.5-flash-lite` and returns `{text}`. The prompt is fixed server-side so the
  endpoint cannot be used as a general Gemini proxy. Image capped at 4M base64 chars.
  Gemini's error body is never forwarded.

### How to pick it up

1. Create a Supabase project, run the migration in the SQL editor.
2. `cd backend && npm install`, set `GEMINI_API_KEY`, deploy to Vercel.
3. App side: downsize a frame to about 768px JPEG, base64 it, POST to `/describe`, speak `text`.

### How it was checked

`npm run typecheck` in `backend/` and at the root. `/describe` exercised with Hono's
`app.request` for missing image (400), non-JSON (400), oversize (413), no key (500). **Not
checked:** the SQL against a real Postgres, the live Gemini call, the Vercel deploy.

### Shortcuts

- **No auth or rate limit on `/describe`.** Anyone with the URL spends our free tier.
  Fine for development, must be fixed (Supabase JWT check, per-user limit) before any demo
  URL is shared. `ponytail:` comment sits on the route in `backend/src/index.ts`.
- Vercel entrypoint shape is unverified. Hono's default export works on Workers; on
  Vercel it may need `hono/vercel`'s `handle()` wrapper.

---

## Phases 1–2 — Camera, detection, narration

**Status:** working on device (A001, Android 16, 2026-08-23). Detects objects and
narrates them aloud. Cadence, thermals and battery not yet measured — see
`test-checklist.md`.
**Covers:** `PRD.md` section 8 phases 1 and 2. Modules M1 and M2.
**Files:** `App.tsx`, `src/narrator.ts`, `src/rateLimit.ts`, `src/rateLimit.test.ts`,
`app.json`

### What it does

Opens the back camera, runs YOLO26n on the frames on-device, and speaks the name of
each detected object — rate-limited so it does not repeat itself into uselessness. A
debug overlay shows detections, dropped frames, and model download progress.

### How it was built

1. **Scaffold.** `create-expo-app` with `blank-typescript` → Expo SDK 57, RN 0.86,
   React 19.2, TS 6.0. Merged into the existing docs repo rather than nesting an app
   folder.

2. **Dependencies.** `react-native-vision-camera` v5, `react-native-executorch` 0.9.3,
   `expo-dev-client`, `expo-speech`, `expo-haptics`.
   VisionCamera v5 needs `react-native-nitro-modules` and `react-native-nitro-image` as
   peer deps — they are not installed automatically and the build fails without them.
   Worklets took two attempts; see `decisions.md`.

3. **Config.** `app.json` sets package `com.lumina.app` and the CAMERA / RECORD_AUDIO /
   VIBRATE permissions. Neither VisionCamera nor ExecuTorch ships an Expo config plugin,
   so permissions go straight in `android.permissions`. **No `babel.config.js`** —
   `babel-preset-expo` applies `react-native-worklets/plugin` on its own whenever the
   package is installed. Adding one broke the bundler; see `bug.md` 2026-08-23.

4. **Narration.** Split into a pure cooldown check (`rateLimit.ts`) and the speech call
   (`narrator.ts`) so the logic is testable without a device.

5. **Detection loop.** `useFrameOutput` worklet → `runOnFrame` → `scheduleOnRN` back to
   JS. Traced in full in `flow.md`.

### Decisions made along the way

All in `decisions.md`, dated 2026-08-23. The two that will surprise you: worklets
package choice, and throttling via camera fps.

### Verified so far

- `npm test` — cooldown logic passes
- `npm run typecheck` — clean
- `npx expo prebuild --platform android` — succeeds; generated manifest carries the
  right permissions and `applicationId com.lumina.app`
- **On device:** builds, installs, launches, downloads YOLO26n, detects objects and
  speaks their labels

Getting there took four runtime bugs that no static check could catch — missing
resource fetcher, minSdk 24 vs HardwareBuffers, wrong pixel format, and a stray
`babel.config.js`. All in `bug.md`. Worth reading before wiring up the next model:
three of the four were config, not code.

**Still unverified:** narration cadence over a long session, dropped-frame rate,
thermals, battery, every failure case, and the blindfold test. Those decide whether
this is *usable*, not merely working — see `test-checklist.md`.

### Known gaps

- Narration says `"{label} ahead"` for every detection regardless of position in frame.
  "Ahead" is a guess — nothing yet reads the bounding box. Fix when depth lands (M3),
  since direction and distance belong together.
- No haptics yet despite `expo-haptics` being installed. That is M3.
- Labels are raw COCO class names, underscores replaced with spaces. `potted_plant`
  becomes "potted plant"; good enough, but COCO's vocabulary is not an indoor
  vocabulary — see `PRD.md` on why depth, not detection, drives obstacle warnings.
- `isMirrored` is hardcoded `false` in the `runOnFrame` call. Correct for the back
  camera, wrong if a front-camera mode is ever added.

### Next

Phase 3: depth → haptics. Check `useDepthOutput` in VisionCamera v5 before pulling in
ViroReact — it may make this a second output on the existing camera session.
