# Depth spike session — Step 1 (distance architecture)

Run on a physical phone with **Google Play Services for AR** installed. Open the main app → debug overlay → **Open depth spike**.

After each scenario, tap **Copy readings to clipboard**. You should see green text:
`Copied. Also saved on phone: …` — the app should **not** close.

Paste from clipboard into **Results** below (or chat). If copy fails, use laptop logcat (see **Verify export**).

## Preflight (laptop)

```bash
adb devices                    # must show device
adb shell pm list packages | grep ar.core
adb shell dumpsys media.camera | grep -oE 'DEPTH_OUTPUT|LOGICAL_MULTI_CAMERA'
```

## Verify export (laptop)

With USB debugging and Metro/`npm run dev` running:

```bash
adb logcat -d -s ReactNativeJS | grep DepthSpike | tail -5
adb shell run-as com.lumina.app cat files/depth-spike-last.json
```

## On-phone protocol (~15 min)

| # | Scenario | What to record |
|---|----------|----------------|
| 1 | **Wall** ~1–2 m away | left / centre / right metres; `source` |
| 2 | **Glass** | Three rays on glass/window |
| 3 | **Doorway** | left/right close, centre farther? |
| 4 | **Capture & detect** | total ms, object count |
| 5 | **Swap** (optional) | swap → arcore / swap → camera ms |

---

## Results — 2026-09-23 (Derek)

### Device

- **Model:** Redmi Note 8 Pro (`begoniain`)
- **ARCore package:** installed
- **Camera `DEPTH_OUTPUT`:** no (software depth via ARCore only)
- **Source:** Metro logcat `[DepthSpike]` after **Copy readings**

### Summary

| Check | Result |
|-------|--------|
| Three-ray depth (`source: arcore`, non-null m) | **Fail** — all rays `null`, `source: "none"` on every arcore log |
| Glass / doorway (distinct ray pattern) | **Not observed** — no depth data to evaluate |
| Capture + detect total &lt; ~600 ms | **Pass** — 358–592 ms across runs |
| Camera swap while walking | **Reject** — swap → camera **1145 ms** (swap → arcore not measured this session) |

### Capture + detect runs (arcore mode)

| at (UTC) | capture ms | detect ms | total ms | found |
|----------|------------|-----------|----------|-------|
| 14:56:02 | 223 | 369 | 592 | 0 |
| 14:56:24 | 159 | 278 | 437 | 1 |
| 14:56:34 | 159 | 278 | 437 | 1 |
| 14:56:54 | 200 | 292 | 492 | 1 |
| 15:01:18 | 166 | 210 | 376 | 1 |
| 15:01:43 | 144 | 214 | 358 | 0 |

Scenarios were not labelled per wall/glass/doorway in the app; logs are grouped as repeated **Capture & detect** while in arcore mode with no hit-test depth.

### Swap (camera mode)

| at (UTC) | swap → camera ms | swap → arcore ms |
|----------|------------------|------------------|
| 15:03:02–15:03:07 | **1145** | null (swap back not completed or not timed) |

### Representative log (depth failed, capture OK)

```json
{
  "mode": "arcore",
  "reading": {
    "left": { "depth": null, "source": "none" },
    "centre": { "depth": null, "source": "none" },
    "right": { "depth": null, "source": "none" }
  },
  "shot": { "capture": 166, "detect": 210, "found": 1 },
  "shotError": null
}
```

## Decision (this session)

- [x] **Not committed (on this device):** ARCore owns camera + continuous 3-ray depth → haptics — hit tests returned no depth.
- [x] **Confirmed:** Screenshot → YOLO timing is viable for **on-demand** naming (~400 ms typical).
- [x] **Confirmed:** Camera owner swap remains too slow for walking (~1.1 s).
- [ ] **Next engineering path:** Depth Anything V2-small → ExecuTorch on VisionCamera frames (see [`docs/decisions.md`](decisions.md) 2026-09-23).
- [ ] **Optional:** Re-run spike on team phone **A001** before closing ARCore depth globally.

Conclusion copied to [`docs/decisions.md`](decisions.md). [`STATUS.md`](../STATUS.md) §5 updated.
