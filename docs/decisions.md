# Decisions

Why things are the way they are. Newest first.

Founding stack decisions live in [`PRD.md`](../PRD.md) section 5 — this file is
everything decided after that. Record what was **rejected**, not just what was chosen.

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

## 2026-08-23 — Split `rateLimit.ts` out of `narrator.ts`

**Chose:** cooldown logic in `src/rateLimit.ts`, speech in `src/narrator.ts`.

**Rejected:** one `narrator.ts` file.

**Why:** `narrator.ts` imports `expo-speech`, a native module that cannot load under
plain `node`. Splitting the pure decision function out means the only non-trivial logic
in the narration path is testable with `npm test` and no device, no emulator, no mocking.

This is the *only* reason for the split. Do not add more files on the same logic —
if it does not need testing without a device, it belongs in `narrator.ts`.

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
