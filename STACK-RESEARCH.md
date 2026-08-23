# Lumina — Model & Stack Research (Aug 2026)

Research pass over the architecture in `lumina.md`. Verified against Hugging Face,
vendor docs, and library docs (Context7). Everything below is what actually exists
and ships *today*, with licenses and prices checked.

---

## TL;DR — the stack I'd build

| Layer | Pick | Why | Cost |
|---|---|---|---|
| Obstacle sensing | **ARCore Depth API / ARKit** (native) | Per-pixel metric depth, hardware-accelerated, free. Detection can't tell you a glass door is 1.2 m away. | ₹0 |
| Object naming | **YOLO26n** via `react-native-executorch` | 2.4M params, 40.9 mAP, NMS-free, already wrapped in one RN hook | ₹0 (AGPL-3.0) |
| Sign / room-number reading | **ML Kit Text Recognition v2** (on-device) | Free, offline, ~4 MB, Latin + Devanagari. Kills ~80% of your VLM calls. | ₹0 |
| Deep scene understanding | **Gemini 2.5 Flash-Lite** (cloud) + **Qwen3.5-2B** (self-host fallback) | Cheapest capable VLM; Qwen3.5-2B is Apache-2.0 and beats it on OCRBench | ₹0 on free tier |
| On-device VLM (offline mode) | **LFM2.5-VL-1.6B** via ExecuTorch | Only VLM that actually runs at usable speed on a phone | ₹0 |
| Spatial memory embeddings | **MegaLoc** (server) / CLIP ViT-B/32 (on-device) | MegaLoc is SOTA visual place recognition, MIT, indoor-validated | ₹0 |
| Pose / dead reckoning | **ARCore VIO + Cloud Anchors** | ~0.02 m/s drift. Raw accelerometer+compass drifts in seconds. | ₹0 |
| Voice out | Native TTS (`expo-speech`) | Zero latency, offline, free | ₹0 |
| Voice in | Native SpeechRecognizer, or Whisper-tiny via ExecuTorch offline | | ₹0 |
| Storage | SQLite on device; Supabase free tier if you need sync | ~200 anchors/route → brute-force cosine is instant | ₹0 |

**Total running cost for the demo and the viva: zero.**

---

## What changed since `lumina.md` was written

Three things in the doc are stale or wrong:

1. **LLaVA-OneVision is obsolete.** It's a 2024 model. Anything in the 2B class today
   (Qwen3.5-2B, LFM2.5-VL, MiniCPM-V-4.6) beats the 7B LLaVA on OCR and scene QA while
   fitting on a phone. Do not put LLaVA in the report — a reviewer will notice.
2. **The doc contradicts itself.** Abstract says "Visionflow" + LLaVA-OneVision; Proposed
   System says YOLOv10 + LLaVA-1.5-7B; Objectives say YOLO26. Pick one. (Fix before submission.)
3. **pgvector is the wrong tool at your scale.** A personal indoor route is ~50–200 visual
   anchors. That's a 200-row dot product — microseconds in SQLite. pgvector also caps its
   HNSW/IVFFlat indexes at 2000 dimensions, and MegaLoc emits 8448-dim descriptors, so
   you'd be forced into PCA or brute force anyway. Brute force it is.

---

## Layer 1 — Edge detection

**YOLO26** is real (launched Jan 2026, first shown at YOLO Vision 2025). Genuinely
edge-first: end-to-end NMS-free inference, DFL removed, ~43% faster on CPU than YOLO11.

| Model | Params | FLOPs | COCO mAP50-95 | CPU ONNX | TensorRT |
|---|---|---|---|---|---|
| YOLO26n | 2.4 M | 5.4 B | 40.9 | 38.9 ms | 1.7 ms |
| YOLO26s | 9.5 M | 20.7 B | 48.6 | 87.2 ms | 2.5 ms |
| YOLO26m | 20.4 M | 68.2 B | 53.1 | 220 ms | 4.7 ms |

Use **YOLO26n**. On a Snapdragon 8-class NPU (ExecuTorch QNN delegate, INT8) expect
12–15 ms — comfortably real-time at 30 fps.

**License warning:** YOLO26 is **AGPL-3.0** or a paid Ultralytics Enterprise license.
Fine for an academic project you publish openly. If Lumina ever ships as a closed app,
swap to **RF-DETR-Nano** (Apache 2.0, ICLR 2026, better mAP/latency on GPU) or
**D-FINE** (Apache 2.0). RF-DETR's transformer backbone is heavy on CPU, so on a
phone-NPU target YOLO26n still wins.

**The thing nobody in your literature survey did:** COCO's 80 classes are a bad fit for
indoor obstacle avoidance. There's no class for "glass door", "wet floor sign", "open
drawer", "step down". Detection tells you *what*, depth tells you *whether you'll hit it*.
Run both, and let depth drive the haptics.

### Depth
- **ARCore Depth API / ARKit** — free, native, metric, GPU-accelerated. Default choice.
- **Depth Anything 3 (metric series)** if you need it on devices without ARCore depth
  support. Heavier; use as fallback, not primary.
- YOLO26 also ships a monocular-depth task — convenient if you want one model for both.

---

## Layer 2 — Sign and room-number reading

This is your headline objective ("room numbers, directional signs, exit signs") and it
does **not** need a VLM.

**Google ML Kit Text Recognition v2** runs fully on-device, free, offline, adds ~4 MB
bundled (or 260 KB per script unbundled). Supports Latin, Devanagari, Chinese, Japanese,
Korean. Wire it in with `react-native-vision-camera-ocr-plus` — a maintained VisionCamera
frame processor for exactly this.

Accuracy notes from the docs: each character needs ≥16×16 px (no gain past 24×24), and
blur is the #1 error source — so gate OCR on a sharpness check rather than throwing every
frame at it.

**Caveat for your context:** ML Kit does *not* cover Kannada. If you want Kannada signage
in Mangaluru, that's a cloud VLM call or a fine-tuned model — worth mentioning as future
work rather than promising it.

**Escalation path:** ML Kit gives you the characters. When you need *meaning* — "which way
does this arrow point", "is this the exit or the fire exit", "is this a men's or women's
restroom pictogram" — that's when you spend a VLM call.

---

## Layer 3 — Vision Language Model

### Cloud (recommended primary)

| Model | Input $/M | Output $/M | Notes |
|---|---|---|---|
| **Gemini 2.5 Flash-Lite** | $0.10 | $0.40 | Free tier: ~1,000 req/day, 15–30 RPM, images included |
| Qwen3.5-9B (DeepInfra) | $0.10 | $0.15 | Open weights, no vendor lock, cheapest output tokens |
| Qwen3.5-122B-A10B | $0.26 | $2.60 | Overkill |

Gemini Flash-Lite's free tier alone covers your entire development, demo, and viva.
Google Pro models left the free tier in April 2026, but Flash and Flash-Lite stayed.

### Open weights (for the "not vendor-locked" story your report needs)

| Model | Params | License | OCRBench | MMMU | Notes |
|---|---|---|---|---|---|
| **Qwen3.5-2B** | 2 B | **Apache 2.0** | **84.5** | 64.2 | Natively multimodal. Best quality/size on the board. |
| LFM2.5-VL-3B | 3.1 B | LFM1.0 | OCRBench-v2 47.5 | MMMU-Pro 30.5 | Built for on-device; GGUF/ONNX/MLX shipped |
| MiniCPM-V-4.6 | ~1 B | check card | — | — | OCR/doc specialist |
| baidu/Unlimited-OCR | 3 B | check card | — | — | 3.1 M downloads, pure OCR |
| PaddleOCR-VL-1.6 | 1.0 B | Apache 2.0 | — | — | Tiny, document-focused |

**Recommendation:** Qwen3.5-2B, Apache 2.0, self-hosted on a serverless GPU (Modal /
RunPod) behind FastAPI. Cite it in the report as the open-weights path; run Gemini
Flash-Lite in the live demo because it's free and faster to call.

### On-device VLM (the genuinely novel bit)

`react-native-executorch` already exposes **LFM2.5-VL-1.6B** as a first-class hook:

```tsx
const llm = useLLM({ model: models.llm.lfm2_5_vl_1_6b() });
await llm.generate([{ role: 'user', content: 'Describe this image.', mediaPath: uri }]);
```

Measured: ~20 tok/s on a Galaxy S26 Ultra, ~3 GB RAM, 32k context, SigLIP2 NaFlex
native-resolution image handling. Slow for narration, fine for a one-shot "what's in
front of me" when the network is down.

**This is a better research contribution than the cloud VLM.** "Graceful degradation to
a fully offline VLM when connectivity fails" is a real gap in the papers you surveyed —
AI Guide Dog is vision-only with no semantic layer, PISHYAR needs a Raspberry Pi 5 and an
OAK-D camera, VisionAI has no memory at all.

---

## Layer 4 — Semantic Spatial Memory

**Do not use CLIP for place recognition.** CLIP is trained for semantics; it will happily
match two different corridors because both contain "a corridor". You need viewpoint- and
illumination-invariant *place* descriptors.

**MegaLoc** (`gberton/MegaLoc`) — MIT license, 0.2 B params, DINOv2-base backbone +
SALAD aggregation, 8448-dim L2-normalized descriptors, 322×322 input. CVPR 2025 Workshop.
State of the art on most VPR datasets **including indoor RGB-D scans** — which is exactly
your setting. 77 k downloads/month.

```python
model = torch.hub.load("gmberton/MegaLoc", "get_trained_model")
descriptors = model(images)          # [N, 8448], L2-normalized
similarities = descriptors @ descriptors.T
```

Alternatives if you want to justify the choice in the report: NetVLAD (baseline),
CosPlace / EigenPlaces (classification-based, ResNet-50), MixVPR, AnyLoc, SALAD.
MegaLoc supersedes all of them and is the honest citation.

**Where to run it:** 0.2 B is ~800 MB fp32. Run it server-side on the anchor-save and
anchor-match calls — you only need it at ~1 Hz, not 30 fps. If you insist on offline,
`react-native-executorch`'s `useImageEmbeddings` with CLIP ViT-B/32 (512-dim) works as a
degraded fallback.

**Storage:** SQLite table of `(route_id, anchor_index, descriptor BLOB, label, pose)`.
Cosine similarity over 200 rows is a dot product. Add pgvector only when you have a real
multi-user cloud with tens of thousands of anchors — and if you do, PCA the 8448 dims
down to ≤2000 first or the index won't build.

---

## Layer 5 — Pose, drift, and "infrastructure-free"

The doc says: "Visual Observation + Accelerometer + Gyroscope + Orientation → Spatial
Estimate". Do not implement that yourself. Raw IMU dead reckoning drifts metres within
seconds; magnetometer heading is unusable indoors because of steel and electrical noise.

**Use ARCore (Android) / ARKit (iOS) VIO.** They already do the sensor fusion, tuned per
device, GPU-accelerated. Benchmarked drift: ARKit ~0.02 m/s relative pose error indoors —
ARKit was the most stable of four proprietary VIO systems in a published comparison.

**ARCore Cloud Anchors** persists an anchor to Google Cloud with an ID that any device can
resolve later. That *is* your "save and recall a route" primitive, and it's still
infrastructure-free in the sense your report means (no BLE beacons, no RFID, no building
modification).

**React Native access:** ViroReact (`@reactvision/react-viro`) exposes ARCore/ARKit
including Cloud Anchors and Geospatial Anchors. It's the only maintained RN AR option.

Architecture that actually holds up:

```
save:   ARCore anchor (metric pose)  +  MegaLoc descriptor (visual fingerprint)  +  voice label
recall: MegaLoc top-k match → confirms which anchor → ARCore VIO gives the vector to it
```

VIO gives precision, MegaLoc gives relocalization after tracking loss. Neither alone is
enough. That pairing is the defensible novelty.

---

## Layer 6 — Voice I/O

**Output:** native platform TTS via `expo-speech`. Free, offline, zero latency, already
matches the user's accessibility voice settings — which matters, because blind users have
strong existing preferences and often run TTS at 2–3× speed. Do not override it.

Only reach for **Kokoro-82M** (Apache 2.0, top of TTS Arena, available as
`models.text_to_speech.kokoro.en_us.heart()` in ExecuTorch) if a reviewer complains about
voice quality. It's a downgrade in latency and a battery cost.

Research-backed latency budget: <300 ms feels instant, >700 ms feels broken. That budget
alone rules out routing routine narration through a cloud VLM.

**Input:** native SpeechRecognizer / iOS Speech for voice commands. For fully offline,
`useSpeechToText` with `whisper_tiny()`, gated by `useVAD` with `fsmn_vad()` so you're not
transcribing silence. Moonshine (27 MB, streaming encoder) is the lighter alternative if
Whisper-tiny is too slow.

---

## Runtime: how the models actually get on the phone

**`react-native-executorch`** (Software Mansion) is the single dependency that covers most
of this. It already ships hooks for everything you need:

| Need | Hook | Model |
|---|---|---|
| Obstacle detection | `useObjectDetection` | `models.object_detection.yolo26n()` |
| On-device VLM | `useLLM` | `models.llm.lfm2_5_vl_1_6b()` |
| Place embeddings | `useImageEmbeddings` | `clip_vit_base_patch32_image()` |
| Speech in | `useSpeechToText` | `whisper_tiny()` |
| Silence gating | `useVAD` | `fsmn_vad()` |
| Speech out | `useTextToSpeech` | `kokoro.en_us.heart()` |

ExecuTorch is Meta's production on-device runtime (it runs AI in Instagram and WhatsApp),
with 12+ hardware backends: XNNPACK (CPU), Qualcomm QNN (Snapdragon NPU), CoreML, Metal,
Vulkan, MediaTek. That's how you get INT8 detection at 12–15 ms on a Snapdragon 8 Elite.

Camera: **react-native-vision-camera** v5 frame processors, which is what feeds frames to
the detector and to ML Kit OCR without a JS round-trip.

`onnxruntime-react-native` is the alternative if you'd rather stay in ONNX. ExecuTorch is
the shorter path because the model zoo is pre-converted.

---

## Backend

You need a server for exactly three things:

1. Hiding the Gemini/Qwen API key (never ship it in the app bundle)
2. Running MegaLoc for anchor embedding + matching
3. Cross-device route sync, if you want it

FastAPI is a fine choice and matches the doc. Deploy on a free-tier host; add a serverless
GPU (Modal has free monthly credits) only if you self-host Qwen3.5-2B.

Supabase free tier gives you Postgres + auth + storage + pgvector in one, which is less
work than FastAPI + a separately managed DB. Either is defensible; pick whichever you can
demo reliably.

**Do not build the backend first.** Every model in the edge layer runs without it.

---

## Build order

Ship each phase as a working thing. Do not integrate at the end.

1. **VisionCamera + `expo-speech`.** Point the camera, say "camera on". Proves the audio
   loop and the permissions dance, which is where RN projects usually die.
2. **YOLO26n via ExecuTorch.** Narrate detections with a rate limiter — announce a class
   at most once every 3 s or the app becomes unusable noise. This alone is a demo.
3. **ARCore depth → haptics.** Distance-mapped vibration. No speech. This is the part
   blind users will actually rely on, and it must never depend on the network.
4. **ML Kit OCR on demand.** "Read that" → OCR the frame → speak it. Covers room numbers
   and exit signs, offline, free.
5. **Gemini Flash-Lite escalation.** "What's around me?" → one frame → one paragraph.
   Cache aggressively; don't stream frames.
6. **Spatial memory.** "Save this as the library door" → ARCore anchor + MegaLoc
   descriptor + label → SQLite. Then "take me to the library door" → match, then guide.
7. **Offline fallback.** LFM2.5-VL-1.6B when the network is gone. This is your novelty
   claim — build it, don't just cite it.

Phases 1–4 are a complete, useful, fully offline assistive app. Phases 5–7 are the
research contribution. If you run out of semester, you still have something that works.

---

## Sources

- [Ultralytics YOLO26 docs](https://docs.ultralytics.com/models/yolo26/) · [YOLO26 launch](https://www.ultralytics.com/blog/ultralytics-yolo26-the-new-standard-for-edge-first-vision-ai) · [why NMS was removed](https://www.ultralytics.com/blog/why-ultralytics-yolo26-removes-nms-and-how-that-changes-deployment)
- [RF-DETR vs YOLO26](https://codersera.com/blog/rf-detr-vs-yolo26-object-detection-comparison-2026/) · [Best object detection models 2026](https://blog.roboflow.com/best-object-detection-models/)
- [Qwen3.5-2B on Hugging Face](https://huggingface.co/Qwen/Qwen3.5-2B) · [LFM2.5-VL-3B](https://huggingface.co/LiquidAI/LFM2.5-VL-3B) · [MegaLoc](https://huggingface.co/gberton/MegaLoc) · [MegaLoc paper (arXiv 2502.17237)](https://arxiv.org/abs/2502.17237)
- [Best local VLMs 2026](https://tinyweights.dev/posts/best-local-vision-language-models-2026/) · [Open-source VLM guide](https://www.bentoml.com/blog/multimodal-ai-a-guide-to-open-source-vision-language-models)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Gemini free tier limits 2026](https://www.aifreeapi.com/en/posts/gemini-api-free-tier-rate-limits) · [Qwen pricing on DeepInfra](https://deepinfra.com/blog/qwen-api-pricing-2026-guide)
- [ML Kit Text Recognition v2](https://developers.google.com/ml-kit/vision/text-recognition/v2) · [Android guide](https://developers.google.com/ml-kit/vision/text-recognition/v2/android)
- [React Native ExecuTorch docs](https://docs.swmansion.com/react-native-executorch/) · [ExecuTorch](https://executorch.ai/) · [on-device benchmarks 2026](https://www.alephzerolabs.com/blog/on-device-ai-2026-sub-20ms)
- [Depth Anything 3](https://github.com/bytedance-seed/depth-anything-3) · [Ultralytics depth task](https://docs.ultralytics.com/tasks/depth)
- [VIO benchmark: ARKit vs ARCore](https://arxiv.org/pdf/2207.06780) · [ARCore navigation for the visually impaired](https://www.techrxiv.org/doi/pdf/10.36227/techrxiv.21897252.v1) · [ViroReact](https://reactvision.xyz/viro-react/)
- [On-device TTS benchmark](https://picovoice.ai/blog/on-device-tts/) · [Open-source STT 2026](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)
