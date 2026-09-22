# Mobile onboarding (first-run tour)

**Added:** 2026-09-22 · **Applies to:** `app/` (iOS and Android) · **Not on:** owner-web (see below)

A four-page tour shown **once per install, before sign-in**. Each page pairs a miniature of a
real screen with a short headline, then hands over to the login screen.

| # | Page (`kind`) | Headline | The miniature shows |
|---|---|---|---|
| 1 | `queue` | Your live queue, in your pocket | A seat board with three tokens (one in service), a Walk-in pill, an "Avg wait" chip |
| 2 | `bookings` | Bookings that fit your day | This week's date strip (today highlighted), two appointments with Check in, a "New booking" toast |
| 3 | `customers` | Know every customer | A customer card with visits, last visit and spend, and a "Today" revenue card with a bar chart |
| 4 | `share` | Share your booking page | A real QR code for the TejoTime site, a "Joined the queue" toast, the shop link |

All copy lives in `app/src/i18n/en.json` under `onboarding` (the page text in `slides`, the
sample names and figures in `art`). Where the app already has a word (Walk-in, Check in, Visits,
In service, VIP), the art reuses that string, so the tour and the real screens can't disagree.

> **Never put a price, plan, trial or "Premium" in this tour.** App Review rejected 1.0 (2) for
> exactly that kind of reference with no In-App Purchase behind it
> ([mobile-no-in-app-purchases.md](./mobile-no-in-app-purchases.md)).

---

## Flow and routing

```
cold start ─► splash (authLoading) ─► index.tsx
                                       ├─ authed            → /(app)/(tabs)/dashboard
                                       ├─ !onboarded        → /(auth)/onboarding ─► Skip / Get started ─► /(auth)/login
                                       └─ otherwise         → /(auth)/login
```

- **`onboarded`** is store state, read by the session restore **in parallel with** the token check
  (`Promise.all([initSession(), getOnboarded()])`). So `authLoading`, which already holds the
  animated splash, also covers the flag, and the first screen is never decided before it is known.
- **Skip** and **Get started** both call `completeOnboarding()`. That sets the state immediately and
  writes the flag fire-and-forget. A failed write only means the tour shows once more.
- A **signed-in** owner never sees the tour, even on a fresh install that still has tokens.
  Signing out lands on login, not the tour.
- The login route uses a **fade** transition in `(auth)/_layout.tsx`: the tour hands over to
  sign-in rather than pushing it.
- `(auth)/_layout.tsx` also sets the **status bar style** (dark icons on the light page). Without
  it, Android drew the clock and icons white on the onboarding and login pages, where they were all
  but invisible. The `(app)` layout has always set its own.

## Persistence

`tt_onboarded_v1` = `'1'`, stored beside the session tokens by `app/src/lib/tokenStore.ts`
(SecureStore on native, `localStorage` on web).

- **A failed read counts as seen.** Re-showing a finished tour is a nuisance, but a storage error
  must never block the way to sign-in.
- **iOS keeps Keychain items across an uninstall**, so a reinstall on the same device skips the
  tour. To test it again on a simulator, use Device → Erase All Content and Settings, or bump the key.
- **To show a rewritten tour to everyone once more,** bump the key's version (`_v2`).

## How it's built

`app/src/app/(auth)/onboarding.tsx` (screen) and
`app/src/components/onboarding/OnboardingArt.tsx` (the four miniatures).

- **The pager is a paging `Animated.ScrollView`**, not a FlatList: four fixed pages need no
  virtualisation. Its scroll offset drives all the motion on the UI thread. Only the page index,
  which sets the button label (Next → Get started) and hides Skip on the last page, goes back
  through React.
- **Each page gets a `progress`** value: 0 when centred, ±1 one page away. The art's main card
  drifts slightly with it. The floating chips drift further (parallax), shrinking and fading as
  their page leaves, so each chip "arrives" as its page swipes in. The dots stretch into a pill
  and take the brand colour. The text fades and slides.
- **The chips bob gently for three cycles (~13 s), then settle.** It's finite on purpose: a
  never-ending animation keeps the screen from ever going idle, and Android's UI tooling
  (`uiautomator`, and so Google Play's pre-launch crawler) then fails with "could not get idle
  state". **Reduce Motion** stops the bob entirely. The swipe-driven movement stays, because it
  follows the user's own finger.
- **The art is drawn on a fixed 320 × 300 dp canvas**, in plain dp rather than `moderateScale`, and
  the screen scales the whole canvas to the room available (0.62×–1.3×). Scaling pieces
  individually would drift them apart. Its text ignores the system text size
  (`maxFontSizeMultiplier={1}`), because the canvas already scales as a unit. The page text
  still honours it, up to the app-wide `MAX_FONT_SCALE`.
- **Everything is theme tokens.** It follows dark mode and needs no image assets, except the brand
  mark in the header (`splash-mark.png`).
- **Decorative**, so it's hidden from screen readers. The dots row announces "Page n of 4".
- **Tablets:** pages are as wide as the pager's *measured* width, not the window's. In tablet
  landscape the safe area insets the sides, and a window-wide page would never snap back to
  centre. A rotation re-seats the current page at its new offset. The text column and button cap
  at 440dp.

## Why owner-web doesn't have it

CLAUDE.md §11.1 says an owner-facing change must land on all three surfaces, or say why not. A
first-run tour belongs to *installing an app*. owner-web users reach a sign-in page from a link,
there's no equivalent "first open" moment, and a browser offers no reliable per-device memory of
having seen it. So it's deliberately left out.

## Testing

`app/` has no test runner, and CLAUDE.md §12.2–12.3 put mobile UI flows out of scope for automated
E2E (no Detox). What was checked on 2026-09-22, on release builds:

| Check | Android (Pixel 10 emulator, Android 17) | iOS (iPhone 17 Pro simulator) |
|---|---|---|
| Fresh install lands on the tour, after the animated splash | ✅ | ✅ |
| Next moves one page, and the button reads "Get started" on page 4 | ✅ | not checked (`simctl` can't tap) |
| Swipe pages, from both the art and the text area | ✅ | not checked |
| Skip hidden on the last page, header doesn't move | ✅ | not checked |
| Skip → login, and Get started → login | ✅ | not checked |
| Relaunch after finishing goes straight to login | ✅ | not checked |
| Status bar icons dark and readable on the tour and login | ✅ (white before the fix) | ✅ |

Also `tsc --noEmit` and `eslint` clean. Not checked: dark mode, tablet landscape, Reduce Motion.

**Driving it on Android:** `uiautomator dump` can't find the buttons while the chips are bobbing
("could not get idle state"). Tap by coordinates during the first ~13 s, or wait for the bob to
settle.
