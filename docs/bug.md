# Bugs

A start-to-finish trail per bug, so anyone can pick it up cold. Newest first.

## 2026-08-23 — Same object announced repeatedly as it enters and leaves frame

**Status:** fixed
**Files:** `src/narrationPolicy.ts`, `App.tsx`

### Symptom

Reported from device use: the voice repeats the same object over and over while
walking, even though the backoff was supposed to stop that.

### Root cause

Two separate causes, both defeating the backoff by making the same object look like a
*different* object:

1. **Zone boundary flicker.** The announcement key is `label + zone`, and zones split
   the frame in exact thirds. A box sitting near the one-third line jitters a few
   pixels frame to frame, so it flipped between `chair|ahead` and
   `chair|on your left`. Two keys, two fresh cooldowns, announced on every flip.

2. **`FORGET_MS` was 8s.** Sweeping the camera past something and back takes a couple
   of seconds, but any object out of view for 8s was deleted and treated as brand new
   on return. Walking down a corridor re-announced everything constantly.

The backoff itself worked correctly. Both bugs bypassed it.

### Fix

**Hysteresis on zone boundaries.** `zoneOf` now takes the previous zone and shifts the
boundaries to favour it by `ZONE_MARGIN` (6% of frame width). A box must move
decisively before we call it a change. `App.tsx` holds the per-label memory in a ref.

**`FORGET_MS` 8s → 20s.** Long enough that a sweep and return is the *same* object.

### How we know it's fixed

A test simulates a box straddling the zone line for 40 frames and asserts it speaks
at most 4 times; before the fix it spoke on nearly every flip.

### Anything still open

The `ZONE_MARGIN` of 6% and the 20s memory are guesses, like every other constant in
this file. Confirm while walking a corridor.

---

## 2026-08-23 — Haptic patterns not distinguishable

**Status:** fixed (design change, unverified on device)
**Files:** `src/haptics.ts`, `src/narrationPolicy.ts`

### Symptom

Reported from device use: the buzzing conveyed nothing — no sense of how close
anything was.

### Root cause

The pulse rate slid continuously with distance (1200ms → 250ms) and strength rose with
it. **Nobody can tell 900ms from 700ms while walking.** A continuously varying rate is
not learnable, so every buzz felt the same and carried one bit of information: something
is there.

### Fix

Three discrete patterns that feel obviously different:

| Pattern | Feels like | Meaning |
|---|---|---|
| `far` | one light tap, slow | something coming up |
| `near` | **two** medium taps | close, pay attention |
| `imminent` | fast heavy thuds | stop |

The double-tap is the important one — a *count* is recognisable where a small change in
rate is not. Escalation to a more severe pattern also bypasses the interval, so getting
suddenly closer is felt immediately rather than after the gentler pattern's gap.

The debug overlay now shows which pattern is firing, so it can be checked against
what the hand feels.

### Anything still open

Unverified by a human. And the input is still the proximity *heuristic* — the patterns
can only be as good as the distance estimate feeding them, which is the whole reason
for the ARCore depth spike.

---

## 2026-08-23 — `getNativeBuffer()`: "HardwareBuffers require minSdk 26 or higher!"

**Status:** fixed
**Files:** `app.json`, `package.json`

### Symptom

App launched and the model loaded, then this threw on every frame, from
`frame.getNativeBuffer()` inside ExecuTorch's `runOnFrame`. No detections.

```
Frame.getNativeBuffer(...): java.lang.RuntimeException:
  HardwareBuffers require minSdk 26 or higher!
    at com.margelo.nitro.camera.utils.NativeBufferHelper.getHardwareBufferPointer(Native Method)
    at com.margelo.nitro.camera.extensions.ImageProxy_getNativeBufferKt.getNativeBuffer
    at com.margelo.nitro.camera.hybrids.instances.HybridFrame.getNativeBuffer(HybridFrame.kt:75)
    ...
```

Pulled with `adb logcat -d | grep -iE "executorch|ReactNativeJS"`. **Do this first** —
the on-screen error was truncated and the earlier guess (below) was made without it.

### Root cause

The app declared **minSdk 24**, Expo's default. VisionCamera's `getHardwareBufferPointer`
is a JNI native method, and the NDK only exposes the `AHardwareBuffer_*` API at
`__ANDROID_API__ >= 26`. Built against 24, it compiles to a stub that throws.

This is a **compile-time** constraint, not a device one — the test device is API 36
(Android 16), thirteen releases past the requirement. Raising minSdk changes what the
NDK compiles, which is why no device is new enough to work around it.

`react-native-executorch` already declares `RnExecutorch_minSdkVersion=26`. Only the app
was still at 24, and the app's value is what the NDK compiles VisionCamera's C++ against.

### Fix

```json
["expo-build-properties", { "android": { "minSdkVersion": 26 } }]
```

Then `npx expo prebuild --platform android` and a full rebuild. Confirmed in the
generated `android/gradle.properties`: `android.minSdkVersion=26`.

minSdk 26 is Android 8.0 (2017). `PRD.md` targets Android 12+, so this costs nothing.

### How we know it's fixed

Confirmed on device (A001, Android 16). The exception stops and detections appear in
the overlay after a rebuild with minSdk 26.

### Anything still open

Nothing. But note the diagnosis pattern: a runtime error whose text names a *build*
setting will not be fixed by changing devices or JS.

---

## 2026-08-23 — Frame output must be `pixelFormat: 'rgb'`

**Status:** fixed (latent — found by reading source, never observed)

**Files:** `App.tsx`

### Symptom

None observed. This was misdiagnosed as the cause of the `getNativeBuffer` error above,
before the real log was read. The `'rgb'` change is kept because it is independently
correct, and would have thrown as soon as the minSdk fix let buffers through.

### Root cause

`useFrameOutput` defaults to `pixelFormat: 'native'`, and we never overrode it.

`'native'` means "whatever the camera produces with zero conversion" — on Android that
is YUV, or a vendor-specific private format. It is the right choice for GPU consumers
like Skia, which take the buffer straight as a texture.

ExecuTorch is not a GPU consumer. It reads pixels on the CPU, and
`common/rnexecutorch/utils/FrameExtractor.cpp:75-87` accepts exactly three formats:

```cpp
if (desc.format == AHARDWAREBUFFER_FORMAT_R8G8B8A8_UNORM) { ... }
else if (desc.format == AHARDWAREBUFFER_FORMAT_R8G8B8X8_UNORM) { ... }
else if (desc.format == AHARDWAREBUFFER_FORMAT_R8G8B8_UNORM) { ... }
else throw RnExecutorchError(PlatformNotSupported,
                             "Unsupported AHardwareBuffer format: %u");
```

All three are RGB. A YUV buffer hits the `else` and throws — once per frame.

The VisionCamera docs do warn about this (`pixel-formats-map.mdx`: "'native' … might
also be a RAW format or a vendor-specific private format"), and note that LiteRT-style
consumers should stream `'rgb'` directly. That guidance was read and not applied.

### Fix

```ts
useFrameOutput({ pixelFormat: 'rgb', onFrame, onFrameDropped })
```

JS-only change — no rebuild, Metro reload is enough.

### How we know it's fixed

Confirmed on device (A001, Android 16) — detections appear and are spoken, so the
frame path reaches ExecuTorch with a buffer it accepts.

### Anything still open

`'rgb'` always requires a conversion from the camera's native YUV and uses noticeably
more memory and bandwidth than `'yuv'` would. That is the price of ExecuTorch's CPU
path and is not negotiable while we use `runOnFrame`.

**If `dropped frames` climbs**, this is a contributing cost — reduce
`targetResolution` on `useFrameOutput` before touching `fps` or `INPUT_SIZE`, since
the conversion scales with frame size.

**Anyone editing `useFrameOutput` must keep `pixelFormat: 'rgb'`.** Removing it
reintroduces this bug, and it fails at runtime only — typecheck and the bundle both pass.

---

## 2026-08-23 — "ResourceFetcher adapter is not initialized"

**Status:** fixed
**Files:** `index.ts`, `package.json`

### Symptom

App launched and bundled cleanly (`Android Bundled 3947ms index.ts (1078 modules)`),
then logged at runtime:

```
ERROR [React Native ExecuTorch] ResourceFetcher adapter is not initialized.
Please call initExecutorch({ resourceFetcher: ... }) with a valid adapter, e.g.,
from react-native-executorch-expo-resource-fetcher or
react-native-executorch-bare-resource-fetcher.
```

No detections, no model download.

### Root cause

`react-native-executorch` does not fetch model weights itself. It downloads `.pte` files
at runtime from Hugging Face, and delegates every file operation to a **resource fetcher
adapter** that the app must supply — the library ships none by default, because Expo and
bare React Native need different filesystem implementations.

We called `useObjectDetection` without ever calling `initExecutorch`, so there was no
adapter to fetch `yolo26_n_xnnpack_fp32.pte` with.

Missed when wiring the model up: `initExecutorch` is exported from the package root and
was visible in `index.d.ts`, but the hook API works fine in TypeScript without it. The
failure is runtime-only, which is why typecheck and the bundle both passed.

### Fix

Installed `react-native-executorch-expo-resource-fetcher` and its peers
(`expo-asset`, `expo-file-system`), then initialised in `index.ts` **before**
`registerRootComponent`:

```ts
initExecutorch({ resourceFetcher: ExpoResourceFetcher })
```

Entry point rather than `App.tsx` because it must run before any ExecuTorch hook
mounts. Use the `expo` adapter, not `bare` — we are an Expo project.

**Required a native rebuild.** `expo-file-system` and `expo-asset` both ship Android
native code and were not in the previous build's autolinking manifest, so
`npx expo start` alone was not enough.

### How we know it's fixed

Overlay progresses past `downloading model · N%` and speaks "Lumina ready".
Second launch skips the download — proving the fetcher also cached to disk.

### Anything still open

Nothing. Note for later phases: every additional ExecuTorch model (CLIP, Whisper,
Kokoro, the offline VLM) goes through this same adapter. It is initialised once and
covers all of them.

---

## 2026-08-23 — Metro can't bundle: "Cannot find module 'babel-preset-expo'"

**Status:** fixed
**Files:** `babel.config.js` (deleted)

### Symptom

`npx expo run:android` built and installed the APK fine, and launched it on the device
(`A001`). The app then failed to load any JS. Metro printed:

```
Failed to construct transformer:  Error: Cannot find module 'babel-preset-expo'
Require stack:
- node_modules/@babel/core/lib/config/files/plugins.js
...
```

The native build succeeding while the JS bundle fails is the tell: this is a Metro/Babel
problem, not a Gradle one.

### Root cause

We added a `babel.config.js` that the Expo template did not ship:

```js
presets: ['babel-preset-expo'],
plugins: ['react-native-worklets/plugin'],
```

Two things wrong with it:

1. **`babel-preset-expo` is not resolvable from the project root.** npm did not hoist it —
   it lives at `node_modules/expo/node_modules/babel-preset-expo`, because it is a
   dependency of `expo`, not of ours. A root-level `babel.config.js` referencing it by
   bare name cannot find it.

2. **The file was never needed.** `@expo/metro-config` applies `babel-preset-expo`
   itself, resolving it from expo's own tree. And `babel-preset-expo` **automatically
   adds `react-native-worklets/plugin` whenever that package is installed** —
   see `node_modules/expo/node_modules/babel-preset-expo/build/configs/expo.js:107-113`:

   ```js
   // Automatically add worklets or reanimated plugin when package is installed.
   if (options.worklets !== false && options.reanimated !== false) {
       const workletsPluginPath = resolveModule(api, 'react-native-worklets/plugin');
       if (workletsPluginPath) plugins.push([require(workletsPluginPath)]);
   }
   ```

   The config was re-declaring, badly, what Expo already does.

The underlying mistake was assuming SDK 57 needs a `babel.config.js` for worklets, the
way older Expo + Reanimated setups did. The template shipping without one was the clue,
and it was missed.

### Fix

Deleted `babel.config.js`. No replacement.

### How we know it's fixed

```bash
npx expo export --platform android
# Android Bundled 8133ms index.ts (951 modules)
```

And the worklet still compiles — transforming `App.tsx` through `babel-preset-expo`
with no custom config produces `__workletHash`, `__initData`, `__stackDetails` and
`_closure`. That matters: if the plugin had silently stopped being applied, the bundle
would still build and `useFrameOutput` would crash at runtime instead.

### Anything still open

Nothing. But the general lesson is in `decisions.md` under the same date: prefer Expo's
defaults over re-declaring them, and check whether the template omitted a config file
on purpose.

---

## Format

Copy this. Fill in every heading — the value of this file is in **Root cause**, which
is the part people skip.

```markdown
## YYYY-MM-DD — One-line summary

**Status:** open | fixed
**Files:** the ones actually changed

### Symptom
What was observed. Device, Android version, and the exact steps to reproduce.
Paste the real error or logcat line, not a paraphrase.

### Root cause
Why it actually happened. Not "the value was null" — *why* it was null, and which
function was responsible for it not being.

### Fix
What changed and where. If it was fixed in a shared function rather than at the call
site, say so and list the other callers that were also broken.

### How we know it's fixed
The check that fails if this regresses. Add it to `test-checklist.md` if it needs a
human or a device.

### Anything still open
Related things noticed but not fixed. Better here than forgotten.
```

## Before you write an entry

Fix the root cause, not the symptom. Grep every caller of the function you are about
to change — one guard in the shared function is a smaller diff than a guard in each
caller, and patching only the path you noticed leaves the sibling paths broken.

If the fix was a deliberate stopgap, mark it with a `ponytail:` comment at the site
naming the ceiling and the upgrade path, and say so in the entry.
