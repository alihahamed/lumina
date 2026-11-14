# Lumina

**AI-powered real-time scene intelligence and spatial navigation for the visually impaired.**

A phone-only indoor navigation aid. Point the camera forward and Lumina warns you
about obstacles through haptics, names what is around you, reads room numbers and
signs, describes the scene when you ask, and remembers routes you have walked
before — with no beacons, no RFID, and no modification to the building.

Final year project · Dept. of Information Science & Engineering
Yenepoya Institute of Technology, Moodbidri · Visvesvaraya Technological University

---

## Why

GPS does not work indoors. Every alternative that does — BLE beacons, RFID, Wi-Fi
fingerprinting — needs hardware installed and maintained in the building, which
means it will never exist in most of the places people actually need it.

Lumina uses only the sensors already in the user's phone.

## How

Three tiers, split by latency budget:

| Budget | Tier | Runs |
|---|---|---|
| < 50 ms | Depth → haptics, object detection → speech | On-device, never touches the network |
| < 500 ms | OCR for signs and room numbers | On-device, offline |
| 1–3 s | Vision-language scene description | Cloud, only when the user asks |

Plus a spatial memory layer: CLIP place descriptors to recognise a saved location, and
route memory built from steps and turns (phone motion sensors) with a view saved every
few steps. ARCore was dropped because its depth is unavailable on our test phones. See
[`docs/decisions.md`](docs/decisions.md) (2026-11-12).

## Status

All seven phases are built. What runs on a real phone, offline:

- Depth-driven vibration for anything in your path, and a spoken "Stop" when it is close
- Objects named with direction ("chair on your left"), plus walls, doors and stairs
- Reading signs and room numbers (ML Kit OCR)
- "What's around me": Gemini in the cloud, with an on-phone VLM fallback
- Saving places and recognising them later

Not yet validated on a phone: **route memory** ("take me to the library"), and depth
readings checked against a tape measure. Measurement logging for the paper's evaluation
was added on 2026-11-14. Details and open items: [`STATUS.md`](STATUS.md).

## Using it

Hold anywhere on the screen until it buzzes, speak, then let go.

| Say | What happens |
|---|---|
| "what's around me" | Describes the scene |
| "read this" | Reads text in front of the camera |
| "save this as the kitchen" / "where am I" | Saves or recognises a place |
| "start route to the library" … "end route" | Records a walk |
| "take me to the library" | Guides you along a recorded route |
| "stop" | Silences speech |
| "show logs" / "hide logs" | Toggles the debug overlay |

Testers only: "start measuring", "stop measuring", "log distance", "check place …".
See [`docs/feature.md`](docs/feature.md).

## Docs

| File | What's in it |
|---|---|
| [`STATUS.md`](STATUS.md) | Where the project is, what is open, what is next. **Start here.** |
| [`IMPLEMENTATION.md`](IMPLEMENTATION.md) | What is actually built, and what each piece does |
| [`HANDOFF.md`](HANDOFF.md) | Session context for an AI agent picking this up cold |
| [`PRD.md`](PRD.md) | Architecture, stack decisions and the reasoning behind them |
| [`SETUP.md`](SETUP.md) | Getting it running on an Android device |
| [`STACK-RESEARCH.md`](STACK-RESEARCH.md) | Model research — benchmarks, licenses, pricing, sources |
| [`AGENTS.md`](AGENTS.md) | Conventions for anyone (or anything) writing code here |
| [`docs/decisions.md`](docs/decisions.md) | Why things are the way they are, and what we rejected |
| [`docs/flow.md`](docs/flow.md) | How execution actually moves through the code |
| [`docs/feature.md`](docs/feature.md) | Start-to-finish trail per feature |
| [`docs/bug.md`](docs/bug.md) | Start-to-finish trail per bug |
| [`docs/test-checklist.md`](docs/test-checklist.md) | What must pass before a phase is done |

## Quick start

Needs a physical Android phone over USB. Expo Go will not work. Full guide:
[`SETUP.md`](SETUP.md).

```bash
npm install
npm run fetch-models                   # depth + SegFormer models into assets/models/ (gitignored)
# create .env and backend/.env — see "Environment variables" below
npx expo prebuild --platform android
npx expo run:android                   # first build ~10 min
```

Then, every session, in two terminals:

```bash
cd backend && npm install && npm run dev   # scene description backend on :8787
npm run dev                                # adb reverse + Metro
```

Checks: `npm test` and `npm run typecheck`.

## Environment variables

Two files, both gitignored. Ask a teammate for the team's values, or create your own.

**Root `.env` — the app.** Every `EXPO_PUBLIC_` value is built into the APK and anyone
with the APK can read it, so **only public values go here**. Changing it needs a rebuild.

| Variable | Required | Value |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | `https://<project>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase publishable key (`sb_publishable_...`). Public by design; row-level security protects the data |
| `EXPO_PUBLIC_DESCRIBE_URL` | Release APKs | Deployed backend, `https://...`. Unset = laptop backend over USB |
| `EXPO_PUBLIC_SHOW_DEBUG` | No | `1` shows the debug overlay in release builds |
| `EXPO_PUBLIC_MEASURE_SECONDS` | No | e.g. `360` for a hands-off measurement session |

**`backend/.env` — the server.** Copy [`backend/.env.example`](backend/.env.example).

| Variable | Required | Value |
|---|---|---|
| `GEMINI_API_KEY` | Yes | **Secret.** Get your own free key at https://aistudio.google.com/apikey |
| `SUPABASE_URL` | When deployed | Same URL as above. Only signed-in Lumina users can then call `/describe`. Leave unset locally |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | No | Override the default models |
| `PORT` | No | Local port, default `8787` |

Keep it safe:

- Never put the Gemini key in an `EXPO_PUBLIC_` variable. It would ship inside the APK.
- No Supabase service-role or secret key is needed anywhere. Do not add one.
- The deployed backend reads its secrets from Vercel's env settings
  (`npx vercel env add GEMINI_API_KEY production`), not from a file.
- `backend/.env.local` is created per machine by the Vercel CLI. Do not share it.
- Share values through a password manager or a direct message, never the repo or a
  group chat.

**Supabase, once per project:** run `supabase/migrations/0001_routes_anchors.sql` in the
SQL Editor, then Authentication → Sign In / Providers → **Allow anonymous sign-ins** →
**Save changes**. Without it, saving a place fails with `anonymous_provider_disabled`.

## Licensing note

Not yet licensed — all rights reserved by default. Before choosing one, note that
YOLO26 is **AGPL-3.0**, which affects what we can release. See PRD.md section 5.

## Team

Ali Ahmed Syed (4DM23IS002) · Derek Regan Henry (4DM23IS011) ·
Muhammed Aksam (4DM23IS019) · Stelvin Pinto (4DM23IS054)

Guide: Prof. Rooha Razmid Ahamed
