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

## Current session — 2026-08-23

**Overwrite this section next session.**

### Done

- Scaffolded the app; got camera → YOLO26n → speech working on a real device
- Fixed four blocking runtime bugs: missing babel config, missing ExecuTorch resource
  fetcher, minSdk 24 vs HardwareBuffers, wrong pixel format
- Rewrote narration: direction zones, announce-changes-not-state, backoff, ranking,
  global floor. Fixed repeat-announcement bug (zone flicker + short memory)
- Added haptics on a proximity heuristic; replaced an unlearnable sliding pulse rate
  with three distinct patterns
- Built `src/DepthSpike.tsx` to decide the depth architecture

### The live question

**How do we measure distance?** Blocking phase 3 properly and shaping phases 4–7.

Established so far:

- Test phone has **no depth hardware** (`dumpsys media.camera`, no `DEPTH_OUTPUT`)
- ARCore works in software, is installed, and ViroReact exposes `depthValue` via
  `performARHitTestWithPoint`
- Only one library can hold the camera. **Swapping costs ~1.2s each way — measured.**
  Too slow to do while walking
- ViroReact's `takeScreenshot()` returns a file path, and ExecuTorch's `forward()` accepts
  a path — so ARCore could hold the camera permanently and naming could run off a still,
  with no swap at all

Proposed architecture, **not yet confirmed**:

```
ARCore holds the camera permanently
  ├─ three depth rays (left/centre/right) → continuous, automatic haptics
  └─ on request: screenshot → YOLO / OCR / VLM for naming
```

### Next action

Run the spike on device (button in the debug overlay) and record:

- Do the three distances match reality? Does a **glass door** register?
- Does `source` say `arcore`?
- Capture + detect time — under ~600ms settles the architecture

Then write the decision into `docs/decisions.md` either way, and delete `DepthSpike.tsx`.

**If the spike fails:** fall back to converting Depth Anything V2-small to ExecuTorch and
running it beside YOLO on existing frames. No camera conflict, but unproven, and two
models on a CPU may be too slow.

### Unverified

Nobody has run the cadence or blindfold tests. The narration and haptic constants have
never been checked by a human walking a corridor. Battery and heat are unmeasured.
