# Implementation

Everything that actually exists in this repo, and what each piece does. Kept in step
with the code — if you add something, add it here.

Last updated: **2026-08-23**

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
| AR / depth | `@reactvision/react-viro` → ARCore | spike only, not in the main path |
| Speech | `expo-speech` (system TTS) | SDK 57 |
| Vibration | `expo-haptics` | SDK 57 |
| Worklets | `react-native-worklets` + `-vision-camera-worklets` | 5.2.3 |

Android only. `minSdkVersion` 26 — required, see `docs/bug.md`.

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
| `src/DepthSpike.tsx` | **Throwaway spike.** ARCore depth + swap timing. Delete when answered |
| `app.json` | Package id, permissions, `minSdkVersion` 26 |

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

Phases 4–7. Nothing below exists:

- Sign and room-number reading (ML Kit, on-device, free)
- Cloud VLM scene description (Gemini Flash-Lite free tier)
- Route saving and recall (CLIP descriptors + Supabase/pgvector, 512-dim)
- Offline VLM fallback (LFM2.5-VL-1.6B via ExecuTorch)
- Any backend at all

The Supabase schema is drafted in `PRD.md` section 7 but nothing is deployed.
