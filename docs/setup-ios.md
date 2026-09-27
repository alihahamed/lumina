# Setup — iPhone (development build via EAS)

Android setup is unchanged: see [`SETUP.md`](../SETUP.md).

Lumina uses native modules (VisionCamera, ExecuTorch, Viro). **Expo Go will not work.** You need a **development build** installed on a physical iPhone (iOS **17+**).

Building iOS binaries requires macOS/Xcode on Apple's side; from Linux you use **EAS Build** in the cloud, then run JavaScript from your laptop with Metro.

---

## 1. Accounts

1. [Expo account](https://expo.dev/signup) (free).
2. **Apple Developer Program** ($99/year) — required to install an internal/ad-hoc dev build on your own iPhone via EAS. A personal Apple ID alone is not enough for device installs through EAS internal distribution.

---

## 2. One-time on your laptop

From the repo root:

```bash
npm install
npx eas-cli login
npx eas-cli build:configure   # links the project on expo.dev; may add projectId to app.json
```

---

## 3. Build the iOS dev client (cloud)

```bash
npm run ios:build
# or: npx eas-cli build --profile development --platform ios
```

Run this in **your own terminal** (not headless CI). The first build must be **interactive** so EAS can create Apple distribution credentials and register your iPhone for internal installs. If you see “couldn't find any credentials suitable for internal distribution”, answer the Apple ID / team prompts when EAS asks.

Register a device before or during setup:

```bash
npx eas-cli device:create
```

- First run: EAS will prompt for Apple credentials (or use `eas credentials` to manage them).
- When the build finishes, open the **install link or QR code** on your iPhone.
- If iOS blocks the app: **Settings → General → VPN & Device Management** → trust the developer profile.

The first app launch downloads **YOLO26n** (~10 MB) from Hugging Face, then caches it. You need internet once; after that, detection works offline.

---

## 4. Daily development (JS hot reload)

After the dev client is on your phone:

```bash
npx expo start --dev-client --tunnel
```

Open the Lumina dev app and scan the QR code (or enter the URL).

Use **`--tunnel`** when your phone is not on the same LAN as your laptop (common on campus Wi‑Fi). Tunnel is slower than LAN but avoids firewall/client isolation issues.

**Rebuild the native iOS app only when** you change `app.json` plugins, native dependencies, or ExecuTorch/VisionCamera versions — not for ordinary TypeScript edits.

---

## 5. What to verify on device

See [`test-checklist.md`](test-checklist.md). At minimum:

1. Camera permission → model download → spoken “Lumina ready”.
2. Furniture in view → directional speech and debug overlay labels.
3. Centre-path proximity → haptic pattern escalates (`far` → `near` → `imminent`).
4. Airplane mode (after first successful launch) → detection still runs.

The **depth spike** uses ARKit via Viro on iOS (not ARCore). Treat measurements as experimental.

---

## 6. Laptop-only checks

```bash
npm run typecheck
npx expo-doctor
```

`npm test` runs narration policy logic; use Node **20.19+** or **22+** if `npm test` fails with “Cannot use import statement outside a module” on older Node builds.

---

## 7. Android unchanged

Colleagues should keep using:

```bash
npm run dev
npx expo run:android
```

No changes to Android `minSdkVersion`, package name, or permissions are required for iOS.
