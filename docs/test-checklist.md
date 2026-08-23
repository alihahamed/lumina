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

### Blindfold test — required before phase 3 counts as done
- [ ] Can you avoid a chair using haptics alone, with the screen off and sound muted?
- [ ] Does the pulse rate tell you distance, or only presence?
- [ ] Honest answer in `feature.md`, even if it is "not usable yet"

---

## Phase 4+ — add sections as phases land

OCR, cloud VLM, spatial memory. Each gets its own section here before it is called
done, and every one of them needs the failure cases and the blindfold test.

**Never test with a real blind user without a sighted spotter present.**
