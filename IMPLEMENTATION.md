# Implementation

Everything that actually exists in this repo, and what each piece does. Kept in step
with the code — if you add something, add it here.

Last updated: **2026-09-22**

Trace of how it all runs at runtime: [`docs/flow.md`](docs/flow.md).
Why it is built this way: [`docs/decisions.md`](docs/decisions.md).

---

## Stack

| Layer | What | Version |
|---|---|---|
| App | Expo + React Native, TypeScript | SDK 57 / RN 0.86 / TS 6.0 |
| Camera | `react-native-vision-camera` | 5.2.3 (Nitro rewrite) |
| On-device ML | `react-native-executorch` | 0.9.3 |
| Detection | YOLO26n, XNNPACK (CPU) build | via ExecuTorch registry |
| Depth | Depth Anything V2 Metric-Indoor, custom `.pte` via ExecuTorch | drives haptics, see `docs/decisions.md` 2026-09-27 |
| OCR | `@react-native-ml-kit/text-recognition` (Google ML Kit) | 2.0.0, on-demand only |
| Cloud VLM | Gemini 3.1 Flash-Lite, 3.5 fallback, via `backend/` | on-demand only |
| Offline VLM | LFM2.5-VL-450M (8da4w), via ExecuTorch `useLLM` | fallback only, 649 MB |
| AR | `@reactvision/react-viro` → ARCore | spike only, not in the main path |
| Speech | `expo-speech` (system TTS) | SDK 57 |
| Vibration | `expo-haptics` | SDK 57 |
| Worklets | `react-native-worklets` + `-vision-camera-worklets` | 5.2.3 |

**Android** is the team’s primary target: `minSdkVersion` 26 — required, see `docs/bug.md`.
**iPhone** dev builds use EAS (`eas.json`, `app.json` `ios` block, iOS 17+); see `docs/setup-ios.md`.

---

## Files

| File | Does |
|---|---|
| `index.ts` | Entry point. Initialises ExecuTorch's resource fetcher **before** the app mounts |
| `App.tsx` | Camera, detection loop, debug overlay, wiring |
| `src/narrationPolicy.ts` | All the decision logic: zones, ranking, cooldowns, proximity. **No native imports** |
| `src/narrationPolicy.test.ts` | Runs under plain `node`. `npm test` |
| `src/narrator.ts` | Speaks. Holds the cooldown state |
| `src/haptics.ts` | Vibrates. Holds the pulse state |
| `src/useDepth.ts` | Loads the custom depth `.pte` via `SemanticSegmentationModule.fromCustomModel`, exposes `runOnFrame`. Drives haptics as of 2026-09-27; model is adb-pushed, not shipped |
| `src/depthZones.ts` | Depth map to left/centre/right nearest-decile metres. Pure, tested by `depthZones.test.ts` |
| `scripts/export_depth.py` | Depth Anything V2 Metric-Indoor-Small to XNNPACK `.pte`. Needs its own Python venv, see `docs/decisions.md` 2026-09-26 |
| `src/useOfflineDescriber.ts` | Phase 7: LFM2.5-VL-450M via `useLLM`. `describeOffline(uri)` is the no-network fallback inside `describeNow` |
| `src/text.ts` | `firstSentences()` for speech, pure, tested by `text.test.ts` |
| `src/describe.ts` | Phase 5: base64 still → backend `/describe` → spoken text. Errors are phrased to be spoken |
| `src/ocr.ts` | On-demand text reading via `@react-native-ml-kit/text-recognition`. See `docs/decisions.md` 2026-09-27 |
| `backend/`, `supabase/migrations/` | M8 Hono proxy (`src/index.ts`, `gemini-3.5-flash-lite`) with a local runner (`src/dev.ts`, `@hono/node-server`, port 8787), and the M7 schema. Neither is deployed |
| `src/DepthSpike.tsx` | **Throwaway spike.** ARCore depth + swap timing. Delete when answered |
| `app.json` | Package id, permissions, `minSdkVersion` 26; iOS bundle id + camera/mic usage strings |
| `eas.json` | EAS Build profiles (`development` = iOS dev client) |
| `docs/setup-ios.md` | iPhone install + Metro tunnel (does not replace `SETUP.md`) |

There is deliberately **no** `babel.config.js` — adding one breaks the bundler. See
`docs/bug.md`.

---

## What runs, in order

### On launch

1. `index.ts` calls `initExecutorch({ resourceFetcher: ExpoResourceFetcher })`. Without
   this, every model fails to load — and it fails at runtime only, so typecheck and the
   bundle both pass.
2. Camera permission requested.
3. YOLO26n downloads from Hugging Face on first run (~10MB), then caches. Overlay shows
   progress.
4. Speaks "Lumina ready".

### Per frame

Camera is capped at **8 fps** and `pixelFormat: 'rgb'` — both mandatory, not tuning.
ExecuTorch only accepts RGB buffers, and YOLO26n is a CPU build costing 100–300ms a frame.

```
onFrame (worklet, camera thread)
  → runOnFrame() runs YOLO26n
  → hands plain objects to the JS thread
  → toCandidates(): label + zone → key, text, score, proximity
  → haptics (first, unconditionally — this is the safety layer)
  → narrate(): at most one utterance
```

---

## Narration

The part that decides whether this is usable. All constants are at the top of
`narrationPolicy.ts` because **every one of them is a guess** awaiting real testing.

| Rule | Value | Why |
|---|---|---|
| Direction | 3 zones by box centre | Under stress nobody can act on "slightly left of centre" |
| Zone hysteresis | 6% of frame width | A box on the boundary jittered and got announced twice |
| Cooldown key | `label + zone` | Crossing zones is news; standing still is not |
| Backoff | 3s → 6s → 12s | A stationary object goes quiet in ~20s |
| Forget | 20s absent | Sweeping past something and back is the *same* object |
| One per frame | ranked | Five objects must not produce five sentences |
| Global floor | 2.5s | The user needs gaps to hear the actual room |

Ranking is box area boosted toward the frame centre — nearest and most in-your-path wins.

**System TTS settings are never overridden.** Blind users run TTS at 2–3× with settings
they chose.

---

## Haptics

Three patterns, deliberately distinct. A continuous rate is not learnable — nobody can
feel 900ms versus 700ms while walking.

| Pattern | Feels like | When |
|---|---|---|
| `far` | one light tap, slow | proximity 0.55–0.7 |
| `near` | **two** medium taps | 0.7–0.85 |
| `imminent` | fast heavy thuds | above 0.85 |

The double tap matters most — a *count* is recognisable where a rate change is not.
Escalating to a stronger pattern skips the wait, so sudden closeness is felt immediately.

Only fires for things **ahead**. Side objects get walked past, and buzzing about them
teaches the user to ignore the buzz.

### Where "proximity" comes from — read this

**It is a heuristic, not a measurement.** It is the bottom edge of the bounding box
divided by frame height: things closer to you sit lower in the frame. That beats box area,
which cannot tell a near chair from a distant sofa.

It assumes objects rest on the floor and the phone is held upright. A sign on a wall reads
as far. A tilted phone reads everything as close. It gives **ordering, not metres**.

Replacing it is the open decision in [`STATUS.md`](STATUS.md) section 5.

---

## Testing

```bash
npm test          # narrationPolicy — pure logic, no device
npm run typecheck
npm run dev       # adb reverse + Metro over USB
```

`narrationPolicy.ts` has no native imports specifically so it can be tested with plain
`node`. That has already paid off — the test caught a backoff bug (doubling on the first
utterance skipped the 3s step) that would otherwise have needed a stopwatch and a corridor.

Device checks, including known blind spots: [`docs/test-checklist.md`](docs/test-checklist.md).

---

## Not built yet

Phases 5–7, and part of 4. Nothing below exists:

- Route saving and recall (CLIP descriptors + Supabase/pgvector, 512-dim)
- Deployed backend. `backend/` (Hono `/describe`) and `supabase/migrations/0001_routes_anchors.sql`
  are written and locally checked but **not deployed and not called by the app**.

Details: `docs/feature.md` (2026-09-26).
