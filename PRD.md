# Lumina — Product Requirements Document

**AI-Powered Real-Time Scene Intelligence and Spatial Navigation for the Visually Impaired**

Final year project · Dept. of Information Science & Engineering
Yenepoya Institute of Technology, Moodbidri · Visvesvaraya Technological University

| | |
|---|---|
| **Guide** | Prof. Rooha Razmid Ahamed |
| **Team** | Ali Ahmed Syed (4DM23IS002) · Derek Regan Henry (4DM23IS011) · Muhammed Aksam (4DM23IS019) · Stelvin Pinto (4DM23IS054) |
| **Status** | Pre-implementation — scaffold in progress |
| **Target platform** | Android (ARCore-certified devices) |

---

## 1. Read this first

This document exists so that anyone on the team can open the repo and understand
**what we are building, what we decided, and why** — without having to ask.

If you are picking this up cold, read sections 2, 3, 6, and 10. That's enough to
start contributing. `STACK-RESEARCH.md` in this repo has the full model research
and benchmark tables behind the decisions in section 5.

**One rule:** if you disagree with a decision in section 5, open an issue and argue
it there. Do not silently swap a model or a library — the whole stack is chosen to
fit together, and a local change usually breaks something two layers away.

---

## 2. The problem

A visually impaired person navigating an unfamiliar indoor space — a hospital, a
college block, a railway station — has no reliable technology to help.

- **GPS does not work indoors.** Satellite signals are degraded or absent inside
  buildings. Accuracy collapses from metres to tens of metres, which is worse than
  useless when the question is "is the door on my left or my right".
- **Existing indoor systems need infrastructure.** BLE beacons, RFID tags, Wi-Fi
  fingerprinting and printed markers all require someone to install and maintain
  hardware in the building. Nobody is going to beacon-fit every building in Mangaluru.
- **Object detection alone is not understanding.** Knowing there is "a sign" ahead
  does not tell you it says *Radiology — 2nd Floor*. Knowing there is "a door" does
  not tell you it is the fire exit.
- **Scene-understanding models are too slow to walk with.** A cloud VLM takes
  1–3 seconds per frame. You cannot avoid a wet floor with 3-second-old information.

Nobody has combined fast local obstacle sensing, real semantic understanding, and
personal route memory in one app that runs on a phone the user already owns.

---

## 3. What we are building

A mobile app that acts as a **digital co-pilot**. Point the phone forward, and it:

1. **Warns you about obstacles instantly**, through haptics, using on-device depth
   sensing. Never depends on the network.
2. **Names what is around you** through on-device object detection and spoken narration.
3. **Reads signs and room numbers** on demand, on-device and offline.
4. **Describes the scene in depth** when you ask, using a cloud vision-language model.
5. **Remembers routes.** Say "save this as the library door", and later say "take me
   to the library door" — the app recognises where it is visually and guides you there.
   No beacons, no building modification.

### Non-goals

Being explicit about this so we don't scope-creep ourselves out of a working demo:

- **Not** outdoor navigation. GPS and Google Maps already solve that.
- **Not** a wearable, a cane, or any custom hardware. The phone is the whole device.
- **Not** iOS this semester. ARCore is Android. iOS is future work.
- **Not** multilingual signage. ML Kit gives us Latin and Devanagari; Kannada is
  future work and must be described that way in the report.
- **Not** a replacement for a white cane or guide dog. It is an assistive supplement.
  Say this in the report — it is both true and ethically necessary.

---

## 4. Architecture

Three tiers, split by **latency budget**. This is the core design idea and the thing
to explain in the viva.

```
                        ┌─────────────────────────────┐
   < 50 ms   REFLEX     │  Depth API → haptics        │  never touches network
                        │  YOLO26n   → object names   │  on-device NPU
                        └─────────────────────────────┘
                                     │
                        ┌─────────────────────────────┐
   < 500 ms  READING    │  ML Kit OCR → speak text    │  on-device, offline, free
                        └─────────────────────────────┘
                                     │
                        ┌─────────────────────────────┐
   1–3 s     REASONING  │  Gemini Flash-Lite          │  cloud, user-triggered only
                        │  LFM2.5-VL (offline fallback)│  on-device when no network
                        └─────────────────────────────┘

                        ┌─────────────────────────────┐
             MEMORY     │  ARCore VIO + Cloud Anchors │  where am I, precisely
                        │  CLIP descriptors + pgvector│  which saved place is this
                        └─────────────────────────────┘
```

**Why the split matters:** research on spoken interaction says under 300 ms feels
instantaneous and over 700 ms feels broken. Anything a user's safety depends on has
to live in the top tier. The cloud tier is only ever entered because the user asked
a question, never on a timer.

---

## 5. Stack and decisions

Everything is TypeScript. Every model is **pretrained** — we train nothing and need
no dataset.

| Layer | Choice | License | Why |
|---|---|---|---|
| App | Expo + React Native | MIT | TS, one codebase, config plugins handle native modules |
| Camera | `react-native-vision-camera` v5 | MIT | Frame processors avoid a JS round-trip per frame |
| On-device runtime | `react-native-executorch` | MIT | Ships pre-converted YOLO26n, CLIP, Whisper, VAD, Kokoro as hooks |
| Detection | YOLO26n | **AGPL-3.0** | 2.4M params, 40.9 mAP, NMS-free, 12–15 ms on Snapdragon NPU |
| Depth / AR | `@reactvision/react-viro` → ARCore | MIT | Metric depth, VIO, Cloud Anchors. Expo config plugin |
| OCR | ML Kit Text Recognition v2 | Free SDK | On-device, offline, ~4 MB, Latin + Devanagari |
| Cloud VLM | Gemini 2.5 Flash-Lite | Commercial | Free tier ~1000 req/day covers the whole project |
| Offline VLM | LFM2.5-VL-1.6B | LFM1.0 | Only VLM that runs at usable speed on a phone |
| Place descriptors | CLIP ViT-B/32 (512-dim) | MIT | Works day one. Upgrade path to MegaLoc below |
| Backend | Hono on Vercel | MIT | One endpoint: hide the Gemini key |
| DB | Supabase (Postgres + pgvector) | Apache 2.0 | Free tier, TS client, gives us the DB schema deliverable |
| TTS | Native (`expo-speech`) | — | Zero latency, offline, respects the user's own voice settings |
| STT | Native SpeechRecognizer | — | Whisper-tiny via ExecuTorch as offline fallback |

### Decisions we already made — do not silently re-open these

**YOLO26n is AGPL-3.0.** Fine for an open academic project. If Lumina ever ships as
a closed product, swap to RF-DETR-Nano (Apache 2.0). Not a problem now; know that it exists.

**Descriptors are fixed at 512 dimensions.** pgvector stores up to 16,000 dims but its
HNSW and IVFFlat indexes cap at **2,000** (`halfvec` reaches 4,000). MegaLoc — the
state-of-the-art place recognition model, MIT licensed, validated indoors — emits
**8,448** dims and therefore cannot be indexed. So we ship CLIP at 512 first, and if
place matching proves too weak we export MegaLoc to ONNX and PCA it down to 512.
**The schema never changes when the model does.** That is the whole point of pinning 512.

**No LangChain.** Its `VectorStore` API is shaped around `Document { pageContent, metadata }`
— text chunks for RAG. We store image descriptors with no text content, and would be
inventing a fake `pageContent` to satisfy an interface we don't want. The entire retrieval
is one SQL function and one `supabase.rpc()` call. See section 7.

**Embeddings are computed on-device, not server-side.** Keeps the backend pure TypeScript
(MegaLoc is PyTorch and would force a Python service), and means route imagery never
leaves the phone. Good privacy story for the report.

**We do not hand-roll sensor fusion.** `lumina.md` originally proposed
`accelerometer + gyroscope + orientation → spatial estimate`. Integrating raw IMU drifts
metres within seconds, and the magnetometer is unusable indoors because of steel and
wiring. ARCore's VIO already does this properly, tuned per device — measured drift around
0.02 m/s. Use it.

**Detection does not drive the haptics, depth does.** COCO's 80 classes contain no
"glass door", "wet floor sign", "step down", or "open drawer". Detection tells you *what*
is there; depth tells you *whether you are about to walk into it*.

---

## 6. Modules

| # | Module | Owner | Depends on |
|---|---|---|---|
| M1 | Camera + frame pipeline + narration engine | — | — |
| M2 | Edge detection (YOLO26n) + rate-limited speech | — | M1 |
| M3 | Depth → haptic obstacle warning | — | M1 |
| M4 | On-demand OCR (ML Kit) | — | M1 |
| M5 | Cloud VLM escalation + offline VLM fallback | — | M1, M8 |
| M6 | Spatial memory: save/recall anchors | — | M1, M3, M7 |
| M7 | Supabase schema, RLS, match function | — | — |
| M8 | Hono backend (Gemini key proxy) | — | — |
| M9 | Debug overlay + video replay harness | — | M1 |

Fill in owners at the first team meeting. M7, M8, M9 need no phone and can be built
on a laptop — assign those to whoever has the weaker device.

**M9 is the productivity unlock.** It feeds recorded video through the same pipeline as
the live camera, so everyone can iterate on thresholds and narration logic at a desk
instead of walking the corridor forty times. These are **test fixtures, not training
data** — we train nothing. Build M9 early.

### Narration engine (M1) — the thing that decides if this is usable

Getting this wrong makes the app unbearable, and it is not obvious from a demo video.

- Rate-limit per object class. Announce a class at most once every ~3 s.
- Suppress repeats. "Chair, chair, chair, chair" is why people uninstall assistive apps.
- Priority queue: obstacle warnings interrupt narration; narration never interrupts
  a user-requested answer.
- Never override the user's system TTS voice or rate. Blind users run TTS at 2–3× and
  have strong existing preferences.

---

## 7. Data model

```sql
create table routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  created_at timestamptz default now()
);

create table anchors (
  id uuid primary key default gen_random_uuid(),
  route_id uuid references routes on delete cascade not null,
  seq int not null,
  label text,                    -- "library door", spoken by the user
  ar_anchor_id text,             -- ARCore Cloud Anchor id
  pose jsonb,                    -- {x,y,z,qx,qy,qz,qw} from VIO
  descriptor vector(512) not null -- CLIP ViT-B/32, L2-normalized
);

create index on anchors using hnsw (descriptor vector_cosine_ops);
```

Retrieval, in full:

```sql
create function match_anchors(query vector(512), route uuid, k int)
returns table (id uuid, label text, ar_anchor_id text, similarity float)
language sql stable as $$
  select id, label, ar_anchor_id, 1 - (descriptor <=> query)
  from anchors where route_id = route
  order by descriptor <=> query limit k;
$$;
```

```ts
const { data } = await supabase.rpc('match_anchors', {
  query: descriptor, route: routeId, k: 5
})
```

That is the entire spatial memory system. Enable RLS on both tables so a user only
ever sees their own routes.

---

## 8. Build order

Ship each phase as something that runs. Do not integrate at the end — that is how
final year projects die in week eleven.

| Phase | Deliverable | Why this order |
|---|---|---|
| 1 | Camera preview + TTS says "camera ready" | Proves permissions and the audio loop, where RN projects usually die |
| 2 | YOLO26n narrating detections, rate-limited | This alone is a demo |
| 3 | Depth → haptics | The part a blind user actually relies on. Must work offline |
| 4 | "Read that" → ML Kit OCR → speech | Covers room numbers and exit signs, offline, free |
| 5 | "What's around me?" → Gemini Flash-Lite | One frame, one paragraph. Cache hard |
| 6 | Save/recall a route | The research contribution |
| 7 | Offline VLM fallback | The novelty claim — build it, don't just cite it |

**Phases 1–4 are a complete, useful, fully offline assistive app.** If the semester
runs out at phase 4, we still submit something that works. Phases 5–7 are the research
contribution on top.

---

## 9. Testing

We are all sighted. We will unconsciously compensate — glancing at the screen, slowing
at doorways, holding the phone at a flattering angle.

- **Blindfold testing, in pairs.** One blindfolded with the phone, one spotting. This is
  the standard method in the field and it is how you discover the narration is 400 ms late.
- **Test the failure cases deliberately:** cover the camera, kill Wi-Fi mid-route, walk a
  saved route backwards, point at a blank wall until VIO loses tracking. That is where an
  assistive app hurts someone, and it is what the viva panel will ask about.
- **Record fixture clips** for the M9 replay harness: bright corridor, dim corridor,
  stairs, glass door, signposted junction. Same input every run, so you know whether a
  change actually helped.
- **Never ship a build to a real blind user** without a sighted spotter present.

---

## 10. Getting set up

Full command sequence is in `SETUP.md`. Short version:

**Phone:** enable Developer options and USB debugging, then install *Google Play Services
for AR* from the Play Store. Confirm your device is on the
[ARCore supported devices list](https://developers.google.com/ar/devices) — you need
Depth API support, which is a subset of ARCore support.

**Laptop:** JDK 17, Android SDK + NDK, Node.

```bash
npx expo prebuild --platform android
npx expo run:android      # once, ~10 min
npx expo start --dev-client   # every time after; JS hot-reloads in ~1s
```

**Expo Go will not work.** VisionCamera, ExecuTorch and ViroReact are native modules and
Expo Go ships a fixed binary that cannot load them. You need a development build. Everyone
hits this once — don't lose a day to it.

Model weights download and cache on first launch, so the first run needs internet and will
pause for a moment. It is not hung. Everything after that is offline.

---

## 11. Open questions

- Which of our phones are ARCore Depth API certified? **Check before anything else.**
- Haptic vocabulary: how do we encode distance and direction in vibration without
  overwhelming the user? Needs real user testing, not guessing.
- Cloud Anchor persistence: ARCore Cloud Anchors expire (default 1 day, extendable to 365).
  Confirm the ceiling and decide whether route memory survives long enough to be useful.
- Fallback when VIO loses tracking mid-route — how do we recover gracefully and tell the
  user what happened, rather than going silent?
- Battery. Camera + NPU + AR continuously is brutal. Measure it, report it honestly.

---

## 12. Reference

- `STACK-RESEARCH.md` — full model research, benchmarks, licenses, pricing, sources
- `lumina.md` — the original project proposal. **Superseded** on models and DB schema;
  keep for the abstract, literature survey, and problem statement only.

**Known errors in `lumina.md`, to fix before submission:**
1. LLaVA-OneVision is a 2024 model, obsolete. Any 2B VLM today beats 7B LLaVA on OCR
   and fits on a phone. A reviewer will catch this.
2. The document contradicts itself — Abstract says "Visionflow" + LLaVA-OneVision,
   Proposed System says YOLOv10 + LLaVA-1.5-7B, Objectives say YOLO26. Pick one name
   (Lumina) and one model set (this PRD).
3. pgvector is proposed without noting its 2,000-dim index cap, which is exactly the
   constraint that shapes our schema.
