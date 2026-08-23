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

Plus a spatial memory layer: ARCore VIO for precise pose, visual place descriptors
for recognising a saved location after tracking is lost.

## Status

Early. Phase 2 of 7 — camera, YOLO26n detection, and rate-limited narration.

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

```bash
npm install
npx expo prebuild --platform android
npx expo run:android
```

Requires a physical ARCore-certified Android device. See [`SETUP.md`](SETUP.md) —
Expo Go will not work.

## Licensing note

Not yet licensed — all rights reserved by default. Before choosing one, note that
YOLO26 is **AGPL-3.0**, which affects what we can release. See PRD.md section 5.

## Team

Ali Ahmed Syed (4DM23IS002) · Derek Regan Henry (4DM23IS011) ·
Muhammed Aksam (4DM23IS019) · Stelvin Pinto (4DM23IS054)

Guide: Prof. Rooha Razmid Ahamed
