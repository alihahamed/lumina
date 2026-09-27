# Lumina — Where We Are

**For the team.** Read this before touching anything. It is the single page that says
what exists, what was decided, what is still open, and what happens next.

Last updated: **2026-09-27**

---

## 1. What Lumina is, in one paragraph

A phone app that helps a blind person move around indoors. It warns about obstacles
through vibration, says what is around them, reads room numbers and signs, and remembers
routes they have walked before. No beacons, no RFID, no changes to the building — just
the phone. GPS does not work indoors, and everything that does needs hardware installed
in the building, which is why most places have nothing.

Full reasoning: [`PRD.md`](PRD.md). Model research: [`STACK-RESEARCH.md`](STACK-RESEARCH.md).

---

## 2. What works right now

Running on a real phone (A001, Android 16):

- Camera runs, YOLO26n detects objects **on-device**, no internet needed
- It speaks what it sees, **with direction** — "chair on your left"
- It shuts up sensibly: same object goes quiet after a few announcements, one sentence
  at a time, never more than one utterance every 2.5s
- Phone vibrates for things in your path, three distinct patterns by closeness
- Debug overlay showing detections, dropped frames, proximity, haptic pattern
- **Hold and speak**: "what's around me" (cloud, offline fallback), "save this as …",
  "where am I" (as of 2026-09-27)
- **Tap anywhere on the screen to read text aloud** (ML Kit OCR, on-device), as of
  2026-09-27 on begoniain

Everything above works with **airplane mode on**.

Detail: [`IMPLEMENTATION.md`](IMPLEMENTATION.md).

---

## 3. What does not work yet

Be honest about this in the report. It is the gap that matters:

**The app cannot yet be *trusted* to see walls, glass doors, steps, or doorways.**

YOLO26n knows 80 things from the COCO dataset — person, chair, laptop, bottle. Indoors,
the things that actually hurt you are not in that list. There is no "door", no "stairs",
no "glass panel", no "step down".

As of **2026-09-27**, on **Derek's Redmi Note 8 Pro (begoniain)** — not A001, not yet
retested there — a monocular depth model drives the haptic buzz instead of object size,
which in principle covers a wall or glass door regardless of what YOLO can name. **But no
one has checked a depth reading against a real, measured distance.** Until that happens,
treat the numbers as unverified, not as a working safety feature. Detail: section 5,
`docs/decisions.md` (2026-09-27 entry).

---

## 4. The decisions that shaped everything

Full list with rejected alternatives: [`docs/decisions.md`](docs/decisions.md). The four
that matter most:

**Depth, not detection, must drive safety.** Detection tells you *what* something is.
Depth tells you *whether you will hit it*. A glass door has no name YOLO knows but is
still a wall. This is why section 3 is a blocker and not a nice-to-have.

**Announce changes, not state.** The first version reported everything the camera saw,
continuously. A person standing still was announced every 3 seconds forever. That is the
failure mode that gets assistive apps uninstalled — the user cannot hear the actual room
over the narration and stops trusting it. Now: announce when something is new or has
moved, back off while it persists, one sentence at a time, hard 2.5s floor.

**Everything on-device by default.** The cloud VLM is only ever entered because the user
asked a question, never on a timer. Anything a person's safety depends on runs locally.

**Do not hand-roll sensor fusion.** The original proposal said "accelerometer + gyroscope
+ orientation → position". Raw IMU drifts metres in seconds, and the compass is useless
indoors because of steel and wiring. ARCore already does this properly.

---

## 5. The one big open decision

**How do we measure distance?** Monocular depth is now wired into haptics on Derek's
**Redmi Note 8 Pro**, as of **2026-09-27** — full detail in
[`docs/depth-spike-session.md`](docs/depth-spike-session.md) and
[`docs/decisions.md`](docs/decisions.md) (2026-09-23, 2026-09-26, 2026-09-27 entries).
**What is still open is whether the numbers are correct** — nobody has checked a depth
reading against a tape measure yet.

### What we found

| | |
|---|---|
| Phone has no depth sensor | `dumpsys media.camera` — no `DEPTH_OUTPUT` on begoniain |
| Viro ARCore hit tests on begoniain | **No depth** — all rays `null`, `source: none` (2026-09-23 spike) |
| Swapping camera owners | **~1.1–1.2 s** — too slow while walking (reconfirmed 1145 ms) |
| Screenshot → YOLO on still | **358–592 ms** — viable for **on-demand** naming, not continuous |
| Only one library can hold the camera | Still true — no swap during walk |

### Architecture — where we are now

**On begoniain (and until A001 proves otherwise):**

- **Haptics:** driven by **Depth Anything V2 Metric-Indoor (140px) on VisionCamera
  frames** via ExecuTorch (`src/useDepth.ts`, `src/depthZones.ts`), as of 2026-09-27.
  330 ms/frame for depth, ~435 ms/frame combined with YOLO — above the reflex budget in
  PRD section 4 but running end-to-end. The bbox heuristic is now only the fallback for
  while the model is loading or a frame errors.
  **Accuracy against real distances is unconfirmed** — this is the next thing to check,
  not more speed work, unless the combined latency turns out to be felt underfoot.
  A native crash (SIGSEGV) at reload was traced to a teardown race and fixed (10 reloads
  by hand, no crash, 2026-09-27). See `docs/bug.md`.
- **On-demand labels:** still-shot → YOLO timing is acceptable when we add a trigger.
- The ARCore / Viro spike is **removed** (2026-09-27). Its findings stay in
  `docs/depth-spike-session.md`. ARCore returns only if guidance between places is built.

### Spike checklist (begoniain)

- [x] Capture + detect under ~600 ms (2026-09-23; see session doc table)
- [x] Swap cost measured (1145 ms to camera, 2026-09-23)
- [x] Depth Anything on VisionCamera frames proven on device (2026-09-27, see above)
- [ ] Three distances match reality — **still unchecked, no tape measure used yet**
- [ ] Glass door — not tested
- [ ] Doorway left/right/centre — not tested
- [ ] `source` says `arcore` — **no** (`none`, 2026-09-23; superseded by the depth model)

**Next:** check depth readings against real, measured distances (tape measure, a doorway,
a glass door). If the ~435 ms/frame combined latency is felt while walking, revisit speed
(112px, int8 quantisation, depth every Nth frame) — see `docs/decisions.md` 2026-09-27.


---

## 6. Other things still open

- **Licence.** The repo has none, so it is "all rights reserved" by default. YOLO26 is
  AGPL-3.0, which constrains what we can release. Decide before outside contributors.
- **Kannada signage.** ML Kit does Latin and Devanagari, not Kannada. Future work in the
  report — do not promise it.
- **Battery and heat.** Camera plus a neural network running continuously is brutal.
  Nobody has measured it. The report needs a real number.
- **Cloud Anchor lifetime.** ARCore Cloud Anchors expire (default 1 day, up to 365).
  Confirm before designing route memory around them.
- **Every constant is a guess.** 3s backoff, 2.5s floor, three zones, the haptic
  thresholds — all invented, none validated by a human walking a corridor.

---

## 7. Plan

| Phase | What | State |
|---|---|---|
| 1 | Camera + speech | done |
| 2 | Object detection + narration | done, on device |
| 3 | Obstacle warning via vibration | depth wired to haptics on begoniain (2026-09-27); **accuracy unconfirmed**, see section 5 |
| 4 | Read signs and room numbers on demand (ML Kit, offline, free) | **working on device** (read a book, 2026-09-27); tap-anywhere trigger, checklist open |
| 5 | "What's around me?" via cloud VLM (Gemini free tier) | built; backend answers in 2–4 s via Gemini 3.1 Flash-Lite (3.5 fallback). **works on the phone** (2026-09-27) |
| 6 | Save and recall routes | **recognition works on the phone** (save by voice, "where am I"). Guidance between places not built |
| 7 | Offline VLM fallback when there is no network | **model works on the phone** (LFM2.5-VL-450M, ~14 s); fallback works by hand and matched the scene (16.6 s) |

**Phases 1–4 are a complete, useful, fully offline app.** If the semester runs out there,
we still submit something that works. Phases 5–7 are the research contribution.

---

## 8. How to work on this

Setup, including the traps: [`SETUP.md`](SETUP.md). Short version:

```bash
npm run dev              # tunnels Metro over USB and starts it
npx expo run:android     # only when native code changes
```

**Expo Go will not work** — this needs a development build.

Before every commit:

```bash
npm test          # narration policy logic
npm run typecheck
```

**When you change something, write it down** — but only in the file that fits the
situation. The rules are in [`CLAUDE.md`](CLAUDE.md). One situation, one file. Do not
copy the same note into four places.

Four runtime bugs have blocked this project so far and **three were configuration, not
code** — all passed typecheck and bundled cleanly. When something fails on device, read
the actual error first:

```bash
adb logcat -d | grep -iE "executorch|ReactNativeJS"
```

Guessing before reading the log has cost us more time than any other single thing.

---

## 9. Corrections to the original proposal

`lumina.md` is the original submission. Keep it for the abstract, literature survey and
problem statement. These parts are wrong and must be fixed before the final report:

1. **LLaVA-OneVision is obsolete** — a 2024 model. Any 2B model today beats the 7B LLaVA
   on OCR and fits on a phone.
2. **The document contradicts itself** — the abstract says "Visionflow" and
   LLaVA-OneVision, the proposed system says YOLOv10 and LLaVA-1.5-7B, the objectives say
   YOLO26. Pick one name and one model set.
3. **pgvector's index caps at 2000 dimensions**, which is exactly the constraint that
   shapes our schema. Not mentioned.
4. **Do not quote NPU speed figures.** YOLO26n ships as a CPU build. Real figure is
   100–300ms per frame, not the 12–15ms an NPU would give.
