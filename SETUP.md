# Setup

Android only. You need a physical phone — the emulator has a fake camera, no NPU,
and no usable depth data, so none of what Lumina does can be tested on it.

---

## 1. Your phone

1. **Enable Developer options** — Settings → About phone → tap *Build number* seven times.
2. **Turn on USB debugging** (Settings → System → Developer options).
   Turn on *Wireless debugging* too if you're on Android 11+, so you aren't tethered
   while walking around.
3. **Make sure the Google app is installed and up to date.** Voice commands use
   Android's speech recogniser, which is Google's on most phones.

ARCore is **not** needed any more. Depth comes from a model on camera frames, not
ARCore, and the ARCore spike (Viro) was removed. See `docs/decisions.md`.

You do **not** install the app manually. The CLI builds it and pushes it over.

---

## 2. Your laptop (Arch)

```bash
sudo pacman -S --needed jdk17-openjdk github-cli android-udev
sudo usermod -aG adbusers $USER
```

`android-udev` matters. Without it `adb devices` reports your phone as
`no permissions` and you will lose an hour to it. **Log out and back in** after
the `usermod` so the group applies.

Then set the paths for **your** shell.

bash / zsh — in `~/.bashrc` or `~/.zshrc`:

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

fish — run once, these persist as universal variables:

```fish
fish_add_path $HOME/Android/Sdk/platform-tools
set -Ux ANDROID_HOME $HOME/Android/Sdk
set -Ux JAVA_HOME /usr/lib/jvm/java-17-openjdk
```

If `adb` comes back as "unknown command", this is the step you skipped.

Install Android Studio once and let it fetch the SDK, build-tools and **NDK**
(ExecuTorch needs the NDK). Fighting the AUR SDK packages by hand is a known
time sink.

Verify:

```bash
adb devices    # your phone, not "unauthorized" or "no permissions"
```

Accept the RSA prompt on the phone when it appears.

### Other distros

Same idea: JDK 17, Android SDK + NDK, `adb` on PATH, udev rules so your user can
talk to the device. On Ubuntu the udev package is `android-sdk-platform-tools-common`.

If Gradle says **SDK location not found**, either export `ANDROID_HOME` in your shell
or create `android/local.properties` (gitignored) with one line:

```properties
sdk.dir=/absolute/path/to/Android/Sdk
```

If native builds fail with **no space left on device** while disk looks fine, check
`df -h /tmp` — Gradle/Kotlin use `/tmp`; clear old `cursor-sandbox-cache` or
`metro-cache` if it is full.

---

## 3. Secrets and config (two `.env` files, both gitignored)

**Root `.env`**, for the app. Values are baked into the app at build time, so only public
values go here:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...    # Settings → API. Public by design
# EXPO_PUBLIC_DESCRIBE_URL=https://<backend>.vercel.app   # unset = laptop backend over USB
# EXPO_PUBLIC_SHOW_DEBUG=1                                # debug overlay in release builds
```

**`backend/.env`**, for the backend only. Copy `backend/.env.example`:

```bash
GEMINI_API_KEY=...   # https://aistudio.google.com/apikey. Never commit, never paste in chat
# SUPABASE_URL=...   # set on the deployed backend so only Lumina users can call it
```

Ask a teammate for the team's values, or set up your own:

**Supabase (once per project).** SQL Editor → run `supabase/migrations/0001_routes_anchors.sql`.
Authentication → Sign In / Providers → **Allow anonymous sign-ins** → **Save changes**. The
Save button is easy to miss; without it every place save fails with
`anonymous_provider_disabled`.

---

## 4. Run it (development)

```bash
npm install
npm run fetch-models                   # depth (99 MB) + SegFormer (15 MB) into assets/models/ — gitignored
npx expo prebuild --platform android   # generates /android — gitignored
npx expo run:android                   # phone plugged in, ~10 min the first time
```

Then every session, in two terminals:

```bash
cd backend && npm install && npm run dev   # "what's around me" backend on :8787
npm run dev                                # adb reverse for 8081 AND 8787, then Metro
```

Edit TypeScript, save, the phone reloads in about a second.

**Rebuild only when** you add a native module or change `app.json` plugins.

### The deployed backend

Live at **`https://lumina-backend-pink.vercel.app`** (Vercel project `lumina-backend`,
account `derzzzhenry-4646`). The Gemini key and `SUPABASE_URL` live in Vercel's encrypted
env settings, not in any file, and `backend/.vercelignore` keeps `backend/.env` from being
uploaded. To redeploy after a backend change:

```bash
cd backend
npx vercel login                          # once per machine
npx vercel link --project lumina-backend  # once per machine
npx vercel deploy --prod
```

A teammate without access to that Vercel account can deploy their own copy with the same
commands, a new project name, and `npx vercel env add GEMINI_API_KEY production`, then
`npx vercel env add SUPABASE_URL production`.

---

## 5. Build an APK (no laptop needed)

The development build loads its JavaScript from Metro on the laptop, so it will not start
unplugged. For demos and teammates' phones, build a release APK. It bundles the
JavaScript, so it needs no Metro or USB:

```bash
# root .env must have EXPO_PUBLIC_DESCRIBE_URL=https://... (release builds block http://)
npx expo prebuild --platform android      # if /android does not exist yet
cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
# APK: android/app/build/outputs/apk/release/app-release.apk
```

`arm64-v8a` only: every current phone, and ExecuTorch does not support 32-bit ARM anyway.
arm64-v8a alone is 203.9 MB, 114 MB of which is the two bundled models; all four architectures would add ~140 MB. `npx expo run:android --variant release` also
works and installs on a plugged-in phone, but builds every architecture.

Share the APK file and install it by tapping it, or with `adb install -r app-release.apk`.

- It is signed with React Native's standard **public debug keystore** (SHA1 `5E:8F:16:06…F6:25`),
  the same on every machine. So APKs from any teammate's laptop install over each other.
  But the key is public, so it is fine for our phones and the viva, **not** for
  distribution. A store release needs a private keystore.
- **Install with `adb install -r`, do not uninstall first.** Uninstalling deletes the
  saved sign-in, and the phone becomes a new anonymous user who cannot see the old saved
  places. Linking an account to keep places across reinstalls is not built.
- `EXPO_PUBLIC_` values are read **at build time**. Change the `.env`, rebuild the APK.
- The debug overlay is hidden in release builds unless built with `EXPO_PUBLIC_SHOW_DEBUG=1`.
  Either way, hold and say **"show logs"** or **"hide logs"** to toggle it at runtime.

---

## 6. Things that will bite you

**Expo Go does not work.** VisionCamera, ExecuTorch and worklets are native modules;
Expo Go ships a fixed binary that cannot load them. You need the development build
above. Everyone hits this once.

**"Connecting to the development server" forever.** The app cannot reach Metro. Almost
always a firewall or a network that isolates clients — not a code problem. Metro will
happily report itself as running while nothing can reach it.

The fix that sidesteps both, over USB, no firewall changes:

```bash
adb reverse tcp:8081 tcp:8081
npx expo start --dev-client --localhost
```

`adb reverse` maps the phone's `localhost:8081` to your laptop's, and `--localhost`
makes Metro hand the app a `localhost` URL instead of a LAN IP. **Re-run `adb reverse`
every time you replug the phone or restart the adb server** — it does not persist.

On Arch, `ufw` is active by default once installed and denies incoming, which blocks
port 8081. If you would rather work wirelessly than over USB:

```bash
sudo ufw allow from 192.168.0.0/24 to any port 8081 proto tcp
```

Scope it to your subnet — do not open 8081 to the world.

**Campus Wi-Fi.** Institutional networks isolate clients even with the firewall open.
Use USB (above), your phone's hotspot, or:

```bash
npx expo start --tunnel
```

**Wireless debugging** (Android 11+) so you aren't tethered while testing:

```bash
adb pair <ip:port>     # pairing code shown on the phone
adb connect <ip:port>
```

**First launch downloads the models** and caches them. It needs internet, and it is not
hung:

| Model | Size | From | When |
|---|---|---|---|
| YOLO26n (detection) | ~10 MB | Hugging Face | first launch |
| Depth Anything V2 (depth) | 99 MB | **inside the app** (`npm run fetch-models` before building) | never |
| SegFormer-B0 (wall/door/stairs) | 15 MB | **inside the app** (same) | never |
| CLIP (place memory) | 96 MB | Hugging Face | first launch |
| LFM2.5-VL-450M (offline describe) | 649 MB | Hugging Face | **first launch on Wi-Fi only** |

Detection, depth, OCR and offline describe work offline after that. "What's around me"
(cloud), place memory (Supabase) and voice on Android 11 need internet.

**Xiaomi / MIUI phones ignore `adb shell input tap`** unless Developer options →
"USB debugging (Security settings)" is on, which needs a Mi account. The command reports
success anyway. Test taps by hand.

**Permissions.** Camera and microphone prompts fire on first use. If you deny one
by reflex, Android will not re-prompt — clear app data or reinstall.

**Logs while walking around:**

```bash
adb logcat -s ReactNativeJS
```

---

## 7. Checks

```bash
npm test                              # 5 pure-logic suites (narration, depth zones, text, commands, place match)
npm run typecheck                     # tsc --noEmit
(cd backend && npm run typecheck)
npx expo-doctor                       # environment and dependency sanity
```
