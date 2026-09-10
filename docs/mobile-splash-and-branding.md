# Mobile splash screen & branding assets

How the TejoTime logo reaches the launch screen on each platform, and the one Android constraint
that decides the whole design.

---

## The two splashes, in order

A cold start shows **two** screens in sequence. They are configured in completely different
places, which is why they can drift apart:

| # | What | Where it comes from | Asset |
|---|---|---|---|
| 1 | **Native splash** — drawn by the OS before any JS runs | `expo-splash-screen` config plugin in `app/app.json`, compiled into native resources | iOS: `logo-full.png` · Android: `splash-logo-android.png` |
| 2 | **JS splash** — drawn by React once the bundle loads, while fonts load | `app/src/components/common/TSplashScreen.tsx` | `logo-full.png` |

`app/src/app/_layout.tsx` calls `SplashScreen.preventAutoHideAsync()` and hides it once
`useFonts` resolves, so #1 hands over to #2.

**Changing the native splash requires a native rebuild** (`npx expo prebuild -p android` then
`npx expo run:android`). It lives in `android/app/src/main/res/`, so Fast Refresh and a JS reload
do nothing.

---

## ⚠️ Android masks the splash icon into a circle

This is the constraint that shapes everything else.

The plugin writes `windowSplashScreenAnimatedIcon` into
`android/app/src/main/res/values/styles.xml` — the **Android 12+ system splash slot**. Per
[Android's splash screen docs](https://developer.android.com/develop/ui/views/launch/splash-screen),
for an icon **without** an icon background:

- the icon canvas is **288 × 288 dp**
- the icon must fit within a **192 dp diameter circle**
- *"Everything outside the circle turns invisible (masked)."*

So the wide brand lockup (`logo-full.png`, 538 × 156, a 3.45:1 ratio) **cannot** be handed to the
Android splash directly — the circle would clip the `TejoTime` wordmark off both ends. That is why
Android originally shipped `splash-icon.png` (the calendar/clock mark alone) while iOS — which
applies no mask — got the full lockup, and why the two platforms looked different.

### How the full logo fits anyway

`assets/images/splash-logo-android.png` is the wide logo centred on a **square, transparent
1024 × 1024 canvas**. A square canvas is what the circle wants; the logo inside it is short enough
that its corners stay inside the circle.

The binding constraint is the **diagonal**, not the width: a rectangle centred in a circle fits
only when `√(w² + h²) ≤ diameter`. At `imageWidth: 190`:

```
logo content   170 × 46 dp   (centred in the 288 dp canvas)
corner distance from centre = √(170² + 46²) / 2 = 88.1 dp
mask radius                                     = 96.0 dp   ✅ ~8 dp margin
```

Raising `imageWidth` past roughly **208** starts clipping. Verify after any change by measuring
the generated `android/app/src/main/res/drawable-mdpi/splashscreen_logo.png` (mdpi is 1×, so its
pixels are dp) rather than eyeballing the emulator.

### Regenerating the asset

If the brand lockup changes, rebuild the square canvas from it — scale to ~92% of the canvas
width, then pad to square. The transparent padding is invisible against the splash background:

```bash
cd app
sips --resampleWidth 940 assets/images/logo-full.png --out /tmp/lf940.png
sips -p 1024 1024 /tmp/lf940.png --out assets/images/splash-logo-android.png
npx expo prebuild -p android && npx expo run:android
```

> `sips -p H W` pads to a centred canvas. Confirm the content really is centred afterwards —
> a lopsided canvas shifts the logo off the circle's centre and eats the margin on one side.

---

## Notes

- **iOS needs none of this.** It has no mask, so `ios.image` stays `logo-full.png` at
  `imageWidth: 280` and renders the lockup as-is.
- **Dev builds lie.** Expo's docs warn that "from SDK 52, due to changes supporting the latest
  Android splash screen API, the splash screen on development builds will not reflect all
  properties set in the config plugin" — so confirm the final look in a release build before
  trusting it.
- **Dark mode is unhandled.** Both platforms pin `backgroundColor: #FFFFFF` with no `dark`
  variant, and the lockup's wordmark is near-black navy. On a device in dark mode the launch
  screen is still a white flash. The dark-mode lockup already exists for the login screen
  (`logo-full-dark.png`, see [18-theming-architecture.md](./18-theming-architecture.md)) and could
  be wired into the plugin's `dark` option if that flash is worth removing.
