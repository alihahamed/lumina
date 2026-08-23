# Setup

Android only. You need a physical phone — the emulator has a fake camera, no NPU,
and no usable depth data, so none of what Lumina does can be tested on it.

---

## 1. Your phone

1. **Enable Developer options** — Settings → About phone → tap *Build number* seven times.
2. **Turn on USB debugging** (Settings → System → Developer options).
   Turn on *Wireless debugging* too if you're on Android 11+, so you aren't tethered
   while walking around.
3. **Install "Google Play Services for AR"** from the Play Store. This is the ARCore
   runtime. It sometimes auto-installs on first AR launch; installing it manually
   avoids a confusing failure later.
4. **Check your device** against the
   [ARCore supported devices list](https://developers.google.com/ar/devices).
   You need **Depth API** support, which is a subset of ARCore support. Do this
   before writing any code — it determines who on the team can work on M3.

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

Then in `~/.bashrc`:

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

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

---

## 3. Run it

```bash
npm install
npx expo prebuild --platform android   # generates /android — gitignored
npx expo run:android                   # phone plugged in, ~10 min the first time
```

After that, you almost never rebuild:

```bash
npx expo start --dev-client
```

Edit TypeScript, save, the phone reloads in about a second.

**Rebuild only when** you add a native module or change `app.json` plugins.

---

## 4. Things that will bite you

**Expo Go does not work.** VisionCamera, ExecuTorch and worklets are native modules;
Expo Go ships a fixed binary that cannot load them. You need the development build
above. Everyone hits this once.

**Campus Wi-Fi.** Institutional networks isolate clients, so Metro can't reach your
phone. Either use your phone's hotspot for the laptop, or:

```bash
npx expo start --tunnel
```

**Wireless debugging** (Android 11+) so you aren't tethered while testing:

```bash
adb pair <ip:port>     # pairing code shown on the phone
adb connect <ip:port>
```

**First launch downloads the model.** ExecuTorch fetches YOLO26n (~10 MB) from
Hugging Face and caches it. The first run needs internet and will sit at
"downloading model" for a moment. It is not hung. Everything after that is offline.

**Permissions.** Camera and microphone prompts fire on first use. If you deny one
by reflex, Android will not re-prompt — clear app data or reinstall.

**Logs while walking around:**

```bash
adb logcat -s ReactNativeJS
```

---

## 5. Checks

```bash
npm test          # rate limiter logic
npm run typecheck # tsc --noEmit
npx expo-doctor   # environment and dependency sanity
```
