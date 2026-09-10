# Running the mobile app on the iOS simulator

First iOS build of `app/` (Expo 56 / React Native 0.85). Android was the only platform ever built
before, so `app/ios/` did not exist and none of the iOS-side traps below had been hit.

Verified on macOS 26.5, Xcode 26.6, CocoaPods 1.15.2, iOS 26.5 simulator runtime.

---

## ⚠️ Never check this repo out into a path containing a space

The checkout used to live at `~/Documents/TejoTime Project/`. **Three separate scripts in the iOS
toolchain interpolate the project path into a shell command without quoting it**, so each tried to
execute `/Users/<you>/Documents/TejoTime` and died. None of them are our code; all three are
upstream bugs that only fire on a path with a space, and each only surfaces once the previous one
is fixed:

| Where | Symptom |
|---|---|
| `react-native/scripts/cocoapods/rncore.rb` + `rndependencies.rb` (`URI::File.build`) | `pod install`: ``The `React-Core-prebuilt` pod failed to validate ... Missing required attribute `source` ``, after `Failed to download release tarball: bad component(expected absolute path component)` |
| `expo-constants/ios/EXConstants.podspec` (`bash -l -c "$PODS_TARGET_SRCROOT/..."`) | `xcodebuild` 65: `Script '[CP-User] Generate app.config for prebuilt Constants.manifest' failed` |
| `ios/TejoTime.xcodeproj` "Bundle React Native code and images" (a backticked path run unquoted) | `xcodebuild` 65: `Script 'Bundle React Native code and images' failed` |

The fix is the path, not the scripts: the checkout now lives at
`~/Documents/TejoTimeProject/tejotime-owner-web`. Patching around them is a losing game — two of
the patches live in `node_modules/` and die on `npm ci`, the third lives in the generated `ios/`
folder, and a Release build reaches further unquoted paths that a Debug build skips.

**If `pod install` or `xcodebuild` fails with "No such file or directory" naming a truncated
prefix of your project path, this is that bug. Move the checkout; don't patch.**

### If you ever move the checkout

Xcode bakes absolute paths into DerivedData, including one **inside `node_modules`**. After a
move, clear both or the `ExpoModulesJSI` xcframework step fails with
`IDERunDestination: Supported platforms for the buildables in the current scheme is empty`:

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData/TejoTime-*
rm -rf app/node_modules/expo-modules-jsi/apple/.DerivedData
```

---

## Runbook

```bash
# 0. Backend first — app/.env.local points at http://localhost:8080
cd backend && npm run dev            # needs a migrated + seeded Postgres

# 1. Generate the native project. ios/ and android/ are BOTH gitignored generated folders;
#    regenerating them is routine, not a red flag.
cd app && npm install
npx expo prebuild -p ios --no-install

# 1a. REQUIRED before pod install — see "Expo precompiled modules" below. Without this the app
#     builds and installs but dies in dyld at launch.
node -e "const f='ios/Podfile.properties.json',j=require('./'+f);j.EXPO_USE_PRECOMPILED_MODULES='false';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"

cd ios && pod install && cd ..

# 2. Build, install, start Metro and open the dev client
npx expo run:ios --device "iPhone 17"
```

First build is ~10 minutes — the first `pod install` downloads ~150 MB of prebuilt React Native
xcframeworks from Maven; incremental builds are fast. `npm run ios` is wired to `expo run:ios`:
with `expo-dev-client` in the dependency list, `expo start --ios` is not enough on a machine that
has never built the native project.

### ⚠️ Expo precompiled modules must be turned off, or the app dies in dyld at launch

Expo 56 defaults `EXPO_USE_PRECOMPILED_MODULES` to `1`, shipping Expo modules as **prebuilt dynamic
frameworks** instead of compiling them. Those binaries are linked against `@rpath/React.framework`
— but this project also runs React Native prebuilt (`RCT_USE_PREBUILT_RNCORE=1`), and in that
combination CocoaPods leaves `React.framework` in `XCFrameworkIntermediates/React-Core-prebuilt/`
and **never embeds it**. Six frameworks (`ExpoModulesCore`, `ExpoFileSystem`, `ExpoFont`,
`ExpoImage`, `ExpoModulesWorklets`, `ExpoPrint`) then reference a dylib that is not in the bundle.

The build *succeeds* and the app *installs* — it only fails the moment it is launched, which is why
`expo run:ios` looks like it worked and the simulator just sits on the home screen:

```
dyld[…]: Library not loaded: @rpath/React.framework/React
  Referenced from: …/TejoTime.app/Frameworks/ExpoPrint.framework/ExpoPrint
```

`ExpoPrint` is only the first one dyld reaches; the dyld paths in that error name Expo's own build
machine (`/Users/alanhughes/Work/expo/packages/precompile/…`), which is the tell that the framework
was precompiled upstream rather than built here.

Setting `"EXPO_USE_PRECOMPILED_MODULES": "false"` in `ios/Podfile.properties.json` (the Podfile
reads it and force-disables the env var) makes the Expo modules compile from source as static
libs. The embed list then becomes `React.framework`, `ReactNativeDependencies.framework`,
`ExpoModulesJSI.framework`, `hermesvm.framework` — React is embedded and the app launches.

**`ios/` is a gitignored generated folder, so this setting does not survive `expo prebuild`.**
Re-apply step 1a every time the native project is regenerated. To make it durable it would have to
move into `app.json` as an `expo-build-properties` plugin entry (`ios.usePrecompiledModules:
false`), which means adding that package — not currently a dependency.

To verify a bundle before wondering why the app won't open:

```bash
APP=$(ls -d ~/Library/Developer/Xcode/DerivedData/TejoTime-*/Build/Products/Debug-iphonesimulator/TejoTime.app)
ls "$APP/Frameworks/"          # React.framework must be present
xcrun simctl launch --console-pty booted com.tejotime.tejotimemobile   # surfaces dyld errors
```

`simctl launch --console-pty` is the only way to see this class of failure — a crash before the JS
runtime starts never reaches Metro, so the `expo run:ios` output stays clean.

### Running on other simulators

The same `.app` runs anywhere without rebuilding:

```bash
xcrun simctl create "TT-iPhoneSE3" com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation com.apple.CoreSimulator.SimRuntime.iOS-26-5
xcrun simctl boot    <udid>
xcrun simctl install <udid> ~/Library/Developer/Xcode/DerivedData/TejoTime-*/Build/Products/Debug-iphonesimulator/TejoTime.app
xcrun simctl launch  <udid> com.tejotime.tejotimemobile
xcrun simctl openurl <udid> 'exp+tejotime-mobile://expo-development-client/?url=http%3A%2F%2F<lan-ip>%3A8081'
xcrun simctl io      <udid> screenshot shot.png
```

Launch the app *before* `openurl`, or SpringBoard shows an "Open in TejoTime?" confirmation that
needs a tap. `simctl` cannot tap at all — driving the UI needs a tool holding Accessibility
permission (System Settings → Privacy & Security → Accessibility).

---

## Config notes

- **`app/.env.local` wins over `app/.env`.** `.env` points at production
  (`https://api.tejotime.com`); `.env.local` points at `http://localhost:8080`, which is correct
  for the iOS simulator — unlike the Android emulator it shares the host's loopback, so there is
  no `adb reverse` step.
- **ATS**: `NSAllowsArbitraryLoads=false` with `NSAllowsLocalNetworking=true`, so cleartext to
  `localhost` and LAN addresses works while public HTTP does not. Intentional.
- **Camera and microphone are deliberately blocked.** `app.json` passes `cameraPermission: false`
  and `microphonePermission: false` to the `expo-image-picker` plugin, because `lib/upload.ts`
  only ever calls `launchImageLibraryAsync`. Without that the plugin writes
  `NSCameraUsageDescription` + `NSMicrophoneUsageDescription` into `Info.plist` and adds
  `RECORD_AUDIO` to the Android manifest — permissions the app never uses, which App Review asks
  about and which show on the Play listing.
- **iPad is supported** (`ios.supportsTablet: true` → `TARGETED_DEVICE_FAMILY = "1,2"`). Without
  it the app ran in an iPhone-sized compatibility window and the tablet branch of
  `useResponsive` / `TResponsiveContainer` never fired on iOS at all, though it did on Android
  tablets. Expo grants iPad all four orientations (Apple requires them while
  `UIRequiresFullScreen` is false); iPhone stays portrait-only.
- **`rSize()` reads `Dimensions.get('window').width` once and is not reactive**, which its comment
  justifies with "portrait is locked". That stays safe on iPad despite landscape: `rSize` clamps
  the width at `MAX_SCALE_WIDTH` (480) and both iPad orientations are far past the clamp, so it
  returns the same value either way. `useResponsive` — which decides the centered tablet column —
  *is* reactive, via `useWindowDimensions`.

---

## iOS parity fixes made during this first run

Android hides three problems that iOS does not, all rooted in one difference: **Android resizes
the window under the keyboard (`softwareKeyboardLayoutMode: "resize"`) and has a Back button to
dismiss it; iOS floats the keyboard over the app and gives number pads no Return key.**

| File | Was | Now |
|---|---|---|
| `components/settings/EditSheet.tsx` | No height cap, no scroll. The Services/Staff forms it wraps run to five fields plus two buttons — off the bottom of a 667pt phone, and further off with the keyboard up. | `maxHeight: '86%'` + a `ScrollView` with `keyboardShouldPersistTaps="handled"` and `keyboardDismissMode="on-drag"`, matching `AddWalkInSheet`. |
| `components/feedback/DetailPanel.tsx` | Checkout amount box and Complete button sit in a bottom-anchored footer with no keyboard avoidance — the iOS keyboard covered the entire checkout. | Wrapped in `TKeyboardScreen`. |
| `components/feedback/ConfirmSheet.tsx` | The prompt variant (Team → reset password) centres a ~300pt card; iOS buried Confirm/Cancel under the keyboard. | Wrapped in `TKeyboardScreen`. |
| `components/common/TScreenScroll.tsx` | No keyboard props, so a button under the keyboard took two taps and a number pad had no dismissal gesture. | Same two props `TKeyboardScreen` already used. |
| `components/common/TToast.tsx` | Leftover debug `backgroundColor: 'red'` on the toast host and `'blue'` on the toast. | Removed. |
