# Bugs

A start-to-finish trail per bug, so anyone can pick it up cold. Newest first.

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
