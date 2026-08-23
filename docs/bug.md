# Bugs

A start-to-finish trail per bug, so anyone can pick it up cold. Newest first.

## 2026-08-23 — `frame.getNativeBuffer()` throws on every frame

**Status:** fixed
**Files:** `App.tsx`

### Symptom

App launched, model loaded, then a long error thrown from the frame path on every
single frame, originating at `frame.getNativeBuffer()` inside ExecuTorch's
`runOnFrame`. No detections.

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

Detections appear in the debug overlay and are spoken. The error stops.

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
