# Mobile splash screen & branding assets

How the TejoTime logo reaches the launch screen on each platform, how the launch animation hands
over from the OS without a visible seam, and where every icon asset comes from.

---

## Launch, frame by frame

A cold start is drawn by **three** things in turn. They are configured in different places, which
is why they can drift apart:

| # | What | Where it comes from | Shows |
|---|---|---|---|
| 1 | **Native splash**, drawn by the OS before any JS runs | `expo-splash-screen` plugin in `app/app.json`, compiled into native resources | `splash-mark.png` (the calendar-and-clock mark alone), centred, **150pt/dp** wide, on white |
| 2 | **`TSplashScreen`**, a static JS copy of #1 | `app/src/components/common/TSplashScreen.tsx` | The same mark, same size, same place. It sits *under* #1 while fonts load, and is the fallback the `authLoading` gates draw |
| 3 | **`TAnimatedSplash`**, the launch animation | `app/src/components/common/TAnimatedSplash.tsx`, mounted last inside `AppStateProvider` in `app/src/app/_layout.tsx` | Starts on the identical frame, then plays the intro and exit below |

The animation (added 2026-09-22), timed from the moment the native splash is hidden:

| ms | What moves |
|---|---|
| 0 – 210 | Nothing. The JS frame is identical to the native one, and the native splash finishes its 150 ms fade-out underneath |
| 210 – 770 | The mark shrinks and glides left into its slot in the TejoTime lockup |
| 530 – 1010 | The wordmark and tagline wipe out from behind the mark, left to right |
| when ready | Once the intro has played **and** the saved session is restored (`authLoading` false): the lockup lifts (×1.08) and fades, and the white ground dissolves over 420 ms onto whatever screen is underneath (login, or the dashboard's first-load skeletons) |

- **The handover is gated on pixels, not time.** `SplashScreen.hideAsync()` is called from
  `TAnimatedSplash` when its mark's `expo-image` `onDisplay` fires. The root layout no longer hides
  the splash on font load, because a not-yet-decoded image would have flashed a white frame. An
  800 ms timer hides it anyway if `onDisplay` never arrives, so the app can't get stuck behind the OS
  splash.
- **The native splash's fade-out is real on Android.** `hideAsync()` fades it out over
  `setOptions({ duration })`, 400 ms by default. The first version started moving the mark 120 ms in,
  so on Android a fading copy of the mark stayed at the centre while the JS copy slid away: a double
  image. The root layout now sets `duration: NATIVE_SPLASH_FADE_MS` (150), and `HOLD_MS` waits
  that out plus 60 ms. The fade itself is invisible because the two frames are identical. iOS
  hides without a fade (`fade: false`).
- **Slow restore:** if the session is still restoring 900 ms after the intro, a brand-ink spinner
  fades in under the lockup.
- **Reduce Motion:** no intro. The mark fades out when the app is ready.
- **Touches** are swallowed until the exit starts, so nothing underneath can be tapped blind.
- **Warm start** is ~1.4 s end to end. The animation never holds the app back by more than the
  intro's ~1 s.

**Keep three numbers in sync:** `imageWidth: 150` in `app.json`, `NATIVE_MARK_SIZE` in
`TSplashScreen.tsx`, and the fixed (not `moderateScale`d) size both JS frames draw the mark at. A
mismatch shows as a jump at the handover. The colours are fixed too (`#FFFFFF`, spinner
`palette.brandInk`): the splash sits outside `ThemeProvider` and must never pick up a store's
primary colour.

**The lockup is assembled, not a single image.** The final frame is the new mark plus
`splash-wordmark.png` ("TejoTime" and its tagline, cut out of `logo-full.png`). Both are placed from
`splash-geometry.json`, so the result reproduces `logo-full.png`'s layout exactly, with the clean
mark in place of the lockup's older, compressed one.

**Changing the native splash requires a native rebuild.** It is compiled into `ios/` and
`android/app/src/main/res/`, so Fast Refresh and a JS reload do nothing. Expo also warns that
"Expo Go and development builds cannot fully replicate the splash screen experience". Judge it in a
**release** build.

---

## Android masks the splash icon into a circle

The plugin writes `windowSplashScreenAnimatedIcon` into `android/app/src/main/res/values/styles.xml`,
the **Android 12+ system splash slot**. Per
[Android's splash screen docs](https://developer.android.com/develop/ui/views/launch/splash-screen),
an icon **without** an icon background sits on a **288 × 288 dp** canvas and only a **192 dp
diameter circle** of it is shown. *"Everything outside the circle turns invisible (masked)."* Expo
draws the image `imageWidth` dp wide, centred on that canvas (the generated
`drawable-mdpi/splashscreen_logo.png` is 288px: mdpi is 1×, so its pixels are dp).

Until 2026-09-22 the splash showed the **wide** lockup (538 × 156), so Android needed its own
`splash-logo-android.png` (since deleted) shrunk until its corners cleared the circle (170dp wide). That made it
smaller than iOS's 280pt, and a different picture. The square mark removes the problem:
`splash-mark.png` frames the artwork so its farthest point is at 98% of the half-canvas, so at
`imageWidth: 150` the artwork reaches at most **73.5dp from the centre, inside the 96dp mask**.
Anything up to `imageWidth` ≈ **196** stays unclipped. Both platforms now draw the same image at the
same size.

---

## App icon

Every icon asset is generated from **one** square 1024px master by
`app/scripts/make-app-icons.mjs`. Never hand-edit the outputs:

```bash
cd app
node scripts/make-app-icons.mjs path/to/master-1024.png
node scripts/make-app-icons.mjs assets/images/icon.png   # re-run from the current icon
npx expo prebuild --no-install     # only to inspect locally — EAS runs prebuild itself
```

| File | Used by | Notes |
|---|---|---|
| `icon.png` | iOS (`expo.icon`) | **Opaque RGB, no alpha channel.** App Store Connect rejects an icon that has one, even if every pixel is opaque. The master from design came with one. |
| `android-icon-background.png` | adaptive icon, back layer | The master's own background gradient, fitted from its four corners |
| `android-icon-foreground.png` | adaptive icon, front layer | The artwork lifted off that background and **scaled into the 66dp safe circle** |
| `android-icon-monochrome.png` | Android 13+ themed icons | The inked parts (navy, blue, orange) as one-colour line art. White paper is cut out, so the checkmark and clock face still read. |
| `favicon.png` | web build | 48 × 48 |
| `splash-mark.png` | native splash (both platforms) and the animated splash's first frame | The lifted artwork alone, square, reaching 98% of the half-canvas |
| `splash-wordmark.png` | animated splash | "TejoTime" + tagline, cut out of `logo-full.png` by connected shape (the clock's rim and the "T" share columns, so a straight cut can't separate them) |
| `splash-geometry.json` | animated splash | Where the mark and wordmark sit in the lockup, so the component never holds hand-copied numbers |

**Why the Android layers are not just the master.** Launchers mask an adaptive icon (circle,
squircle, teardrop), and only the centre **66 of 108dp** is guaranteed visible. The artwork in the
master reaches ~75% of the canvas, so on a circular launcher the calendar's corner and the clock's
rim were clipped. The previous `android-icon-foreground.png` had exactly that problem, with the
clock visibly cut off on the right. The script re-centres the artwork and shrinks its farthest
point to 97% of the safe radius. For the 2026-09-22 master that came to ×0.795.

**Lifting the artwork off its background** is a flood fill from the canvas edges through light
pixels. The white calendar page and clock face are walled in by navy outlines, so the flood never
reaches them. Flooded pixels are un-blended against the fitted gradient as outline-navy at partial
alpha. The master's drop shadow turned out to be exactly navy at ~10%, so it survives intact, and
anti-aliased edges get no halo. A future master that is **not** dark artwork on a light, flat-ish
background would break this assumption. Check the Android output before shipping it.

Checked for the 2026-09-22 icon: iOS `App-Icon-1024x1024@1x.png` has no alpha; Android xxxhdpi
`ic_launcher` / `ic_launcher_round` (legacy) and the adaptive layers render unclipped under
circle and rounded-square masks, and the monochrome layer keeps the checkmark and clock hands.

The native folders are gitignored (CNG), so a **new build** is required for the icon to change
on a device. A JS update or Fast Refresh does nothing.

---

## Notes

- **The login screen still shows `logo-full.png`,** whose mark is the older, compressed copy of the
  icon. Regenerating that lockup with the new mark would make the two match exactly.
- **Dark mode is unhandled.** Both platforms pin `backgroundColor: #FFFFFF` with no `dark`
  variant, and the animated splash is white to match. On a device in dark mode the launch screen
  is still a white flash, which the exit dissolves onto the dark app. The dark-mode lockup already exists for the login screen
  (`logo-full-dark.png`, see [18-theming-architecture.md](./18-theming-architecture.md)) and could
  be wired into the plugin's `dark` option if that flash is worth removing.
