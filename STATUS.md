# Lumina — Where We Are

**For the team.** Read this before touching anything. It is the single page that says
what exists, what was decided, what is still open, and what happens next.

Last updated: **2026-08-23**

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

Everything above works with **airplane mode on**.

Detail: [`IMPLEMENTATION.md`](IMPLEMENTATION.md).

---

## 3. What does not work yet

Be honest about this in the report. It is the gap that matters:

**The app cannot see walls, glass doors, steps, or doorways.**

YOLO26n knows 80 things from the COCO dataset — person, chair, laptop, bottle. Indoors,
the things that actually hurt you are not in that list. There is no "door", no "stairs",
no "glass panel", no "step down".

Right now the app names furniture continuously but would let you walk into a wall.

Fixing that is the single most important thing left, and section 5 is about how.

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

**How do we measure distance?** Everything in section 3 depends on this, and it is not
settled. We are mid-experiment.

### What we found

| | |
|---|---|
| Phone has no depth sensor | `adb shell dumpsys media.camera` reports no `DEPTH_OUTPUT` |
| ARCore can do it in software | Already installed, works without special hardware |
| But only one library can hold the camera | ARCore and VisionCamera cannot both have it |
| Swapping costs **~1.2 seconds each way** | Measured. Too slow to swap while walking |
| ARCore can take a screenshot instead | And ExecuTorch can run YOLO on a saved image |

### The architecture this points to

```
ARCore holds the camera. Permanently. Never lets go.
  ├─ three depth rays (left / centre / right), 4x a second, continuous
  │     → vibration + brief speech. Works on walls and glass. Never asked for.
  └─ user asks "what's around me?" → screenshot → YOLO / OCR / cloud VLM
        → object names, sign reading, scene description
```

Obstacle warnings stay **continuous and automatic**. Only the object's *name* becomes
something you ask for. That is the correct way round: knowing something is there matters
more than knowing what it is called.

### Still to measure before we commit

Run `src/DepthSpike.tsx` (button in the debug overlay) and record:

- [ ] Do the three distances match reality? Point at a wall you can measure
- [ ] Does it read a **glass door**? YOLO cannot see one at all
- [ ] In a doorway, do left/right read close while centre reads far?
- [ ] Does `source` say `arcore`?
- [ ] Capture + detect time. Under ~600ms and this architecture is settled

**If the spike fails**, the fallback is converting Depth Anything V2-small to ExecuTorch
and running it alongside YOLO on the frames we already have. No camera conflict, but the
conversion is unproven work and two models on a CPU may be too slow.

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
| 3 | Obstacle warning via vibration | done on a **heuristic**; real depth pending section 5 |
| 4 | Read signs and room numbers on demand (ML Kit, offline, free) | not started |
| 5 | "What's around me?" via cloud VLM (Gemini free tier) | not started |
| 6 | Save and recall routes | not started |
| 7 | Offline VLM fallback when there is no network | not started |

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
