# Handoff

**For an AI agent starting a fresh session on this repo.** Read this first, then
`STATUS.md`. Overwrite the "Current session" section at the end of every working session.

---

## Read in this order

1. **This file** — where things stand right now
2. [`STATUS.md`](STATUS.md) — what exists, what is open, the plan
3. [`CLAUDE.md`](CLAUDE.md) — **which doc to write to after changing code.** Not optional
4. [`IMPLEMENTATION.md`](IMPLEMENTATION.md) — what is built
5. [`docs/decisions.md`](docs/decisions.md) — before proposing anything, check it was not
   already rejected

Do not read `lumina.md` for technical guidance. It is the original proposal and its
model and schema choices are superseded — see `STATUS.md` section 9.

---

## Things that will waste your time if you assume otherwise

**VisionCamera v5 is a total API rewrite.** No `useFrameProcessor`, no `runAtTargetFps`,
no `frameProcessor` prop. It is Nitro-based with outputs: `useCamera`, `useFrameOutput`,
`usePreviewOutput`, `useDepthOutput`. Almost everything written about VisionCamera online
is v4 and will not compile. **Read the installed `.d.ts` files.**

**Check the installed package, not your memory.** Two APIs in this repo differ from their
published docs — ExecuTorch's model config shape, and VisionCamera's worklets package.
Both cost a cycle.

**Read the device log before theorising.** Four runtime bugs so far, three of them
configuration rather than code, all passing typecheck and bundling cleanly:

```bash
adb logcat -d | grep -iE "executorch|ReactNativeJS"
```

Guessing before reading has been the single biggest time sink in this project. One bug was
misdiagnosed twice because the on-screen error was truncated and the log was not checked.

**These are load-bearing, not style.** Changing any of them breaks the app at runtime
while every static check still passes:

| Setting | Where | Breaks if changed |
|---|---|---|
| `pixelFormat: 'rgb'` | `App.tsx` frame output | ExecuTorch only accepts RGB buffers |
| `minSdkVersion: 26` | `app.json` | `getNativeBuffer` throws on every frame |
| `initExecutorch(...)` before mount | `index.ts` | Every model fails to load |
| No `babel.config.js` | repo root | Metro cannot build a transformer |

---

## Environment

Arch Linux, **fish** shell (not bash — `~/.bashrc` advice does nothing). Physical Android
device required; the emulator has a fake camera and no NPU.

```bash
npm run dev              # adb reverse + Metro over USB. Use this, not bare expo start
npx expo run:android     # only when native code or app.json plugins change
npm test && npm run typecheck
```

`ufw` is active and blocks port 8081, which is why `npm run dev` tunnels over USB.
`adb reverse` does not survive a replug — that is what the script re-runs.

**The test phone is low on storage.** Installs have failed with "not enough space".
Uninstalling `com.lumina.app` frees room; a rebuild needs ~250MB headroom.

---

## Working agreements

- **Do not swap a model or library** without checking `docs/decisions.md` and opening the
  question first. The stack is chosen to fit together.
- **Write down what you did**, in the one file that matches the situation. `CLAUDE.md`
  has the table. One situation, one file.
- **Do not tick a box in `test-checklist.md` you did not personally run.** The checklist
  is worthless if boxes are optimistic — four people rely on it.
- **Constants in `narrationPolicy.ts` are guesses**, not tuned values. Say so when you
  touch them.
- Non-trivial logic leaves one runnable check behind. `narrationPolicy.ts` has no native
  imports precisely so it is testable under plain `node`. Keep it that way.

---

## Current session — 2026-09-27

**Overwrite this section next session.**

### Done

- **Depth now drives haptics.** Re-exported Depth Anything V2 Metric-Indoor at 140px
  (down from 252px): 1297 ms → **330 ms/frame**, verified bit-identical to PyTorch.
  `patternForDepth` (`narrationPolicy.ts`) decides the buzz pattern from the centre
  zone's metres whenever depth is loaded and healthy; the old bbox heuristic
  (`patternFor`/`nearestInPath`) is now only the fallback. `haptics.ts pulseFor` takes
  an already-decided pattern so only one source ever fires it. Confirmed on device: no
  crash, overlay reads `2.1 m (depth) · haptic: far` consistently. See
  `docs/decisions.md` 2026-09-27.
- Fixed narration never saying "on your right" (2026-09-26 work, `App.tsx onFrame`
  portrait/landscape mix-up). **Confirmed on a real object this session.**
- Fixed the depth-driven buzz firing on almost every frame near a threshold: added
  `stablePatternForDepth` (hysteresis, same idea as `zoneOf`'s zone margin). Confirmed on
  device: steady reading gives occasional pulses, not continuous ones.
- **Phase 4 OCR works on device.** `src/ocr.ts` (`@react-native-ml-kit/text-recognition`) plus
  VisionCamera `usePhotoOutput`. Read a book correctly. The trigger is **tap anywhere**
  (a full-screen `Pressable`), and startup announces it. Tap-anywhere confirmed by hand. See `docs/test-checklist.md` Phase 4.
- **Phase 5 built.** Hold anywhere → `src/describe.ts` → local backend → Gemini
  3.1 Flash-Lite, falling back to 3.5 (not 2.5; measured, see `docs/decisions.md`). Needs `backend/.env` with
  `GEMINI_API_KEY`, `npm run dev` in `backend/`, and `adb reverse tcp:8787 tcp:8787`.
  Backend verified against real Gemini, 2–4 s. Hold gesture confirmed on the phone.
- **Phase 7 built.** `src/useOfflineDescriber.ts`: LFM2.5-VL-450M, used only when the
  cloud describe fails. ~14 s for two sentences, 649 MB first-launch download, ~1.6 GB
  app RAM. The fallback ran by hand (backend stopped): 16.6 s, no crash. The description matched the scene.
- **Phase 6 (recognition) built and working.** Hold anywhere and speak. "save this as …",
  "where am I", "what's around me" and "read this" are all voice commands
  (`expo-speech-recognition`). Places are CLIP descriptors in Supabase, anonymous users,
  `MATCH_THRESHOLD` 0.85 (a guess). The saved spot matched at 0.92 and an unsaved room was
  not named. Root `.env` holds the Supabase URL and publishable key.
- **Release readiness (2026-09-27):** depth model hosted on the GitHub release `models-v1`;
  backend requires a Supabase JWT when `SUPABASE_URL` is set; Viro and the depth spike are
  removed; the offline VLM downloads on Wi-Fi only; the debug overlay is hidden in release
  builds. APK: `npx expo run:android --variant release` (see `SETUP.md` §5). The backend is
  deployed at `https://lumina-backend-pink.vercel.app` (Vercel account `derzzzhenry-4646`).
- **adb cannot tap on begoniain.** MIUI drops `input tap` silently. Test UI by hand.
- M7 Supabase migration and M8 Hono `/describe` written, not deployed (`docs/feature.md`).

### The live question, and a new risk

**Is 2.1 m actually 2.1 m?** No tape measure has been used yet. Point the phone at a
doorway or wall at a known distance and check the overlay's L/C/R numbers, and check that
walking toward a wall actually escalates far → near → imminent.

**Update:** a second crash, and both hit the process being torn down by a reload. The
cause was a teardown race. `useDepth` now defers `delete()` by 1.5 s. **10 reloads by hand
afterwards, no crash.** See `docs/bug.md`.

**Original note — a native crash happened once, on a relaunch, in the depth path** — `SIGSEGV` inside
ExecuTorch's `Method::outputs_size()`, called from the custom segmentation `execute()`.
Full trace and hypotheses: `docs/bug.md` 2026-09-27. Root cause is **not confirmed** — it
ran crash-free for several minutes both before and after this one occurrence. This is not
catchable from JS. **Do not demo this to anyone, or treat it as safe, until this is
understood or reproduced enough to rule out.** This matters more than the accuracy
question: a wrong number is a bad warning, a crash is no warning and takes the fallback
down with it.

~435 ms/frame combined (yolo + depth) is still above the reflex budget in PRD section 4.
If it visibly lags underfoot, the next moves are 112px, int8 quantisation, or depth every
Nth frame holding the last value — options recorded in `docs/decisions.md`.

The depth model is hosted on the GitHub release `models-v1` and downloads on first launch. Export toolchain lives in a scratchpad venv that will be gone; the
recipe and its traps are in `scripts/export_depth.py` and `docs/decisions.md`.

### Decided, not done (2026-09-27)

- **Gemini key:** it appeared in a chat transcript. The owner chose not to rotate it
  (free tier, no billing). Rotate it if usage looks odd in AI Studio.
- **Backend deploy:** done, with Supabase JWT auth. See `SETUP.md` §4.
- **Phase 6 gesture:** hold becomes **hold-and-speak voice commands** ("what's around me",
  "save this as …", "where am I"). Tap stays as read-text. Chosen over adding another
  gesture, which clashes with TalkBack and does not scale.

### Unverified

Depth accuracy against ground truth. Cadence and blindfold
tests, battery and heat. `/describe` against live Gemini, the SQL against real Postgres.
Nothing committed.
