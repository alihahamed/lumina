# Test checklist

Checks that must pass before a phase is called done. Automated checks run anywhere;
device checks need a real ARCore phone, because the emulator has a fake camera and no
usable depth.

Mark a box only when *you* ran it. `[~]` means partly verified — say what's missing.

---

## Automated — run before every commit

```bash
npm test          # rate limiter cooldown logic
npm run typecheck # tsc --noEmit
npx expo-doctor   # environment and dependency sanity
```

- [x] `npm test` passes
- [x] `npm run typecheck` clean
- [x] `npx expo prebuild --platform android` succeeds
- [x] Generated `AndroidManifest.xml` has CAMERA, RECORD_AUDIO, VIBRATE, INTERNET
- [x] `applicationId` is `com.lumina.app`

---

## Phase 1–2 — camera, detection, narration

Ticked items confirmed 2026-08-23 on **A001, Android 16 (API 36)**. Everything still
unticked is genuinely unchecked — the checklist is only worth anything if boxes mean
what they say. Untested on any second device.

### First run
- [x] `npx expo run:android` installs and launches on a physical device
- [x] Camera permission prompt appears; granting it shows the preview
- [ ] **Denying** the permission shows the "Grant camera access" screen, not a crash
- [x] Overlay shows `downloading model · N%` climbing on first launch
- [ ] Speaks "Lumina ready" once the model finishes
- [ ] Second launch skips the download — the model is cached
- [ ] **Airplane mode, second launch:** still works. Nothing in this phase may need network

### Detection
- [x] Point at a chair / person / laptop — the right label appears in the overlay
- [x] Label is spoken
- [ ] Detection survives moving between a bright corridor and a dim one

### Narration cadence — the one that decides if this is usable
- [ ] Hold on one object for 30 s. It is announced roughly every 3 s, **not** every frame
- [ ] Two objects in frame: both get announced, neither starves the other
- [ ] Sweep across five objects quickly — narration does not build a backlog it is still
      reading out after you have stopped
- [ ] With headphones in, output routes correctly
- [ ] Changing the system TTS voice and speed in Android settings **is respected** —
      the app must not override it

### Performance
- [ ] `dropped frames` in the overlay stays low and flat. Climbing steadily means
      detection cannot keep up — lower `fps` or `INPUT_SIZE` in `App.tsx`
- [ ] Phone does not become too hot to hold in 10 minutes
- [ ] Note battery drain over 10 minutes of continuous use. Record the number in
      `feature.md` — the report needs it and nobody will remember later

### Failure cases — test these deliberately
- [ ] Cover the camera entirely: no crash, no nonsense announcements
- [ ] Point at a blank wall: says nothing rather than inventing detections
- [ ] Background the app mid-detection and return: recovers, speech does not double up
- [ ] Lock the screen and unlock: camera resumes
- [ ] Incoming phone call during narration: no crash

### Blindfold test — required before calling the phase done
Do this in pairs. One blindfolded holding the phone, one spotting.

- [ ] Walk a familiar corridor. Is the narration **useful** or just noise?
- [ ] Is it timely enough to react to, or is it describing what you already passed?
- [ ] Would you trust it? Write the honest answer in `feature.md` even if it is no

---

## Phase 3 — haptic obstacle warning

Built, **entirely unverified on device**. The `path proximity` readout in the debug
overlay exists so you can check the heuristic against reality — watch it while you walk.

### Does the signal mean anything
- [ ] Walk toward a chair: `path proximity` rises smoothly toward 1.0
- [ ] Back away: it falls again
- [ ] A near small object reads higher than a far large one (the whole point — box area
      could not tell these apart)
- [ ] Hold the phone tilted down: does everything read as close? **Expected to fail** —
      record how badly, it decides whether tilt compensation is needed

### Haptics
- [ ] Pulses start only inside ~0.55 proximity, not across the room
- [ ] Pulse rate rises noticeably as you approach
- [ ] Strength rises too (Light → Medium → Heavy)
- [ ] An object off to the side does **not** buzz — only things ahead
- [ ] Pulses continue while speech is playing (safety must not wait on narration)
- [ ] **Airplane mode:** haptics still work. This layer may never need the network

### Known blind spots — confirm how bad
- [ ] Walk toward a blank wall. **It will not buzz** — walls have no COCO class and
      there is no depth. Record this; it is the strongest argument for real depth
- [ ] Same for a glass door, a step down, and a doorway
- [ ] A wall-mounted sign should read as far away, not close

### Spoken "stop" and scene names (2026-09-27)
- [x] Walk test toward walls and doors reported okay by hand (2026-09-27, begoniain). The
      log named "door" and "wall" repeatedly, **1.7–2.5 s per naming**
- [ ] Measure the distance at which "Stop" starts speaking, at normal walking pace
- [ ] Does the **first** "Stop" already say "wall"/"door"? Naming takes ~2 s, so it may
      say "something" first and the name only on the repeat
- [ ] Stairs going down, and going up: "stairs ahead" (with a spotter!)
- [ ] A glass door: what does it say? (the known weak spot)
- [ ] Standing still facing a wall: repeats every ~4 s, not constantly
- [ ] A person standing in front of a wall: says "person", not "wall"
- [ ] No shutter sound while walking near things
- [x] SegFormer on the phone, photo capture included: **1.7–2.5 s** (2026-09-27). Slower than
      the ~0.5 s estimated; split capture from inference before optimising

### Blindfold test — required before phase 3 counts as done
- [ ] Can you avoid a chair using haptics alone, with the screen off and sound muted?
- [ ] Does the pulse rate tell you distance, or only presence?
- [ ] Honest answer in `feature.md`, even if it is "not usable yet"

---

## Phase 4 — on-demand text reading (OCR)

Tap by hand. `adb shell input tap` is silently ignored on begoniain (MIUI), see
`feature.md`.

### Does it read
- [x] Button version: point at a printed book, trigger, text is spoken correctly
      (2026-09-27, begoniain, by hand)
- [x] Tap-anywhere version reads text (2026-09-27, begoniain, by hand. Which of the
      three spots were tried was not recorded, so re-check the debug text and the bottom edge)
- [ ] The "Open depth spike" button still opens the spike and does **not** also read
- [ ] Startup says "Lumina ready. Tap anywhere to read text."
- [ ] Nothing readable in view: says "No text found" rather than staying silent
- [ ] A room-number plate or door sign at 1–2 m, not just a book held close. Pass means
      the number comes out right

### Failure cases
- [ ] Tap twice fast: one read, not two overlapping
- [ ] Airplane mode on: still reads (ML Kit is on-device)
- [ ] Dim corridor: note whether it reads or says "No text found"
- [ ] After ten reads, no photos are left in the app's cache (`run-as com.lumina.app ls cache`)
- [ ] Carry the phone for a minute: count the accidental reads from palm or thumb touches

### Blindfold test
- [ ] Screen off in your mind, eyes closed. Can you find and read a door sign using only
      the startup hint and tap-anywhere?

## Phase 5 — "What's around me?" (cloud)

Backend running (`cd backend && npm run dev`) and `adb reverse tcp:8787 tcp:8787` done.

- [x] Hold anywhere: says "Looking", then 2–3 sentences that match the room (2026-09-27,
      begoniain, by hand. Backend logged 4.0 s for the Gemini call)
- [ ] A quick tap still reads text and does **not** also describe
- [ ] Time from letting go to the first spoken word. PRD budget is 1–3 s. The backend alone
      measured 2.1–3.7 s from the laptop (2026-09-27); record the on-phone number here
- [ ] Backend stopped: says "Check the internet connection" within ~18 s, no crash
- [ ] Hold while a read is running: ignored, and nothing overlaps
- [ ] With TalkBack on: double-tap-and-hold describes. Actions menu lists both actions
- [ ] Does the description name hazards that YOLO cannot (stairs, glass, open door)?
      This is the report's argument for the tier

## Phase 7 — describe with no network

Make the cloud unreachable: stop the backend on the laptop (Ctrl+C in `backend/`).
Airplane mode alone does **not** do it in dev, because the phone reaches the laptop
backend over USB.

- [x] Model loads and describes a known JPEG and a live capture accurately
      (2026-09-27, benchmark run, begoniain)
- [x] Hold with the backend stopped goes to the phone model: it answered in 16.6 s
      (49 tokens), no crash (2026-09-27, by hand, from the log)
- [x] …and the description matched the scene (2026-09-27, by hand)
- [ ] Time from letting go to the first described word. The model alone measured ~14 s
- [ ] Nothing in view that is not there (no invented stairs or doors). The failure the
      first prompt had
- [ ] Hold again straight after: no crash, no overlap
- [ ] Hold right after launch: is the photo black? (open question, `decisions.md`)

## Phase 6 — remember places, voice commands

Needs the root `.env` Supabase values and internet. Hold anywhere until the buzz, speak,
then let go.

- [x] "where am I" with nothing saved says "No places are saved yet" (2026-09-27)
- [x] "save this as …" then "where am I" at the same spot names it (0.92, 2026-09-27)
- [x] "where am I" in an unsaved room does **not** name another room (2026-09-27)
- [x] A second room saved ("dining room") is then named there (2026-09-27)
- [ ] The **score** in an unsaved room, read from the log (`place match`). How close to
      0.85? This decides whether the threshold is safe
- [ ] Same spot, different lighting (day and night), still named?
- [ ] Two similar rooms (two bedrooms): never swapped?
- [ ] Mumbled or unknown command: says what it heard and does nothing else
- [ ] Narration is silent while holding; haptics still buzz
- [ ] TalkBack: double-tap-and-hold, speak, the command runs
- [ ] No internet: save and where-am-I fail with a spoken reason, no crash
- [ ] Airplane mode: does voice recognition still work? (Android 11 offline pack)

## Phase 6+ — guidance between places

Not built. Needs ARCore VIO on a phone where it works. Each gets its own section here before it is called
done, and every one of them needs the failure cases and the blindfold test.

**Never test with a real blind user without a sighted spotter present.**

---

## Depth-first frame loop (2026-11-14) — not yet run

Built and unit-tested; `docs/decisions.md` 2026-11-14. Dev build is enough.

- [ ] **Starts at all:** "Lumina ready" is spoken and the overlay shows detections. (The
      only launch after the change never got YOLO ready — find out whether that repeats.)
- [ ] **Faster warning:** two hands-off 6-minute sessions, same scene with something within
      2.5 m, one on the commit before this change and one after, each from a cool phone
      (CPU < 50 °C). Pass: after has a lower p95 "Age of distance at decision" and p95
      "Interval between frames", and "Detection ran on N of M frames" shows N well below M
- [ ] **Walk to a wall from 4 m:** vibration escalates, "Stop" is spoken; overlay labels stop
      updating inside 2.5 m and resume after backing off
- [ ] **Walk to a chair from 4 m:** "Stop. Chair right in front of you." — the name comes from
      the detection seen before 2.5 m. Pass: named, not "Something"
- [ ] **Naming once per approach:** standing 1.2 m from a door for 30 s, `scene ahead` appears in
      `adb logcat` about every 10 s, not every 2 s
- [ ] **Depth off:** with the depth model failing (rename the .pte locally, never commit), boxes
      still drive vibration and narration as before

---

## Evaluation for the IEEE paper (second review)

Each item matches Section VI-F of the revised paper. Tools: `docs/feature.md` 2026-11-14.
**Report only what was run.** If an item is cut short, the paper says so.

Before every item, on the laptop:

```bash
adb logcat -c
adb logcat -s ReactNativeJS:V > run-<item>-<date>.log   # leave running
```

At the end: `node scripts/measure-report.ts run-<item>-<date>.log`. Keep every log file.
They are the evidence behind the numbers.

### (i) Latency — median and 95th percentile

- [ ] Release APK (`npx expo run:android --variant release`), airplane mode, no other apps
      open, battery above 80% and not charging, phone at room temperature, aimed at a fixed scene
- [ ] `bash scripts/device-monitor.sh dev-latency.csv 10` running alongside (USB is fine here)
- [ ] Build with `EXPO_PUBLIC_MEASURE_SECONDS=360` (hands-off: the session starts itself
      and stops after 6 minutes; the first minute is dropped as warm-up). Phone **unlocked**
      and untouched. Or say "start measuring" / "stop measuring" if the camera can stay still
- [ ] `node scripts/measure-report.ts run.log --device dev-latency.csv` also prints T against
      CPU temperature, throttling and clock speed (review comment 3)
- [ ] Three runs from a cold phone, then three straight after, with the phone warm
- [ ] Pass: the report prints the p95 of T and the recomputed Eq. (1) margins. Copy them
      into Table IV, Table VI and Fig. 2. If the cold runs are much faster than the warm
      ones, the September–November difference is thermal; say so in Section VI-A.

### (iii) Depth against a tape measure — do this first

- [ ] Targets: a wall, a door, a chair, a person and a glass panel. Distances: 0.5, 1.0, 1.5,
      2.0, 2.5 and 3.0 m, with the phone at chest height pointing straight at the target
- [ ] At each position: "log distance", hold still until "Sample N …" is spoken, and write
      `N,true_m,target,light` in `truth.csv` (header `sample,true_m,target,light`)
- [ ] Repeat in dim light
- [ ] `node scripts/measure-report.ts run.log --depth-truth truth.csv`
- [ ] Pass: the signed and absolute errors go into Table IV. A **positive** signed error
      (obstacles reported further away than they are) shrinks every margin in Table VI.
      Say that explicitly.

### (iv) Place recognition

- [ ] Save at least 10 places in two buildings, with 3 views each ("save this as <name>"
      three times, turning slightly). Include look-alikes: two corridors, two classrooms of
      the same layout
- [ ] On later visits and on different days: "check place <name>" facing the saved direction
      and turned about 30° either way, in daylight and under artificial light
- [ ] At places that were never saved: "check place unknown"
- [ ] Pass: the report gives the score distributions and the threshold sweep. Pick τ on half
      the visits, then report the recognition and false-recognition rates on the other half.

### (v) Battery and heat

- [ ] Connect over **wireless debugging**, not USB, so the phone is not charging
- [ ] Full charge, fixed screen brightness, app running, `bash scripts/device-monitor.sh dev-battery.csv`
      for 30 minutes. Do this twice
- [ ] `node scripts/measure-report.ts run.log --device dev-battery.csv`
- [ ] Pass: the report shows battery points per hour and the temperature range, with no
      "on power" warning

### (ii) Detection accuracy — not covered by the app logging

Needs about 300 photos labelled for COCO classes, then an evaluation on the laptop
(Ultralytics `val`). There is no tooling for this yet.
