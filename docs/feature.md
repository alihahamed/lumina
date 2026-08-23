# Features

A start-to-finish trail for each thing built, written so someone who was not involved
can pick it up cold. Newest first.

---

## Phases 1–2 — Camera, detection, narration

**Status:** built, not yet run on a device.
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

**Not verified:** anything requiring the device. See `test-checklist.md`.

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
