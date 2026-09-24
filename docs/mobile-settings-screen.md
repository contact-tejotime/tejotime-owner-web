# Mobile Settings screen

**Applies to:** `app/` (iOS and Android) · **Mirror:** `owner-web/src/app/(app)/settings/SettingsScreen.tsx`

Settings is the last tab. `app/src/app/(app)/(tabs)/settings.tsx` is a list of permission-gated
groups, each a card of `TSettingsRow`s:

| Group | Rows |
|---|---|
| Business | Business profile, Appearance (owner only), Working hours, Services & pricing, Staff & seats |
| Team | Team logins (owner only) |
| Bookings & queue | Booking QR code, Notifications & reminders |
| Account | Your account, Dark mode |
| Support | Email support, Call support |
| — | Sign out, then a version footer |

## The grouping is shared with owner-web — do not regroup one alone

owner-web's settings screen uses the **same six groups in the same order**, from the same
`settings.group*` keys. It is a different implementation (CSS, `SettingsRow`, `<section>`), but the
structure is the product's, not the platform's. Merging the one-row Team group into Business, or
dropping Support because the persistent "Need help? Email · Call" footer already offers both, are
reasonable ideas — but they are **two-surface changes** (CLAUDE.md §11.1), not mobile tidy-ups.

Two rows are deliberately **not** mirrored:
- owner-web has a **Subscription** row (`can(access, 'billing')`). Mobile must never show one — see
  [mobile-no-in-app-purchases.md](./mobile-no-in-app-purchases.md).
- ~~Dark mode uses the `moon` icon on mobile and `settings` on owner-web.~~ Both use `moon` since
  the 2026-09-24 port ([owner-web-app-parity.md](./owner-web-app-parity.md)).

## Four things that were wrong, fixed 2026-09-24

All four were **mobile-only drift** — owner-web already did the right thing in three of them, which
is what made them easy to spot once the two files were read side by side.

- **The footer advertised a version that never existed.** `settings.appVersion` was the literal
  string `"v2.4"` in `en.json` while `app.json` shipped **1.0.3**, so every owner read "TejoTime
  v2.4" and a bug report quoting it would have pointed nowhere. A version is a **build fact, not
  copy**: it now comes from `Constants.expoConfig?.version` via `expo-constants` (already a
  dependency) and the key is gone from `en.json`. owner-web has no version footer at all.
- **"Signed in as sharpcuts."** With no name on the session the footer fell back to
  `businessProfile.username`, the *demo tenant's* handle — telling a real owner they were signed in
  as someone else. There is now a `footerNoUser` variant: with no name, the clause is dropped
  rather than guessed.
- **"Notifications & reminders — 3 of 4 on" was fabricated.** `notificationsSub` was computed from
  `notificationPrefs`, a hard-coded mock in `data/settings.ts`, and
  `settings/notifications.tsx` holds its toggles in local `useState` with **no API behind them**.
  The count therefore described nothing, and reset on every launch. It now reads the static
  `settings.notificationsSub` ("Alerts and reminders"), which is exactly what owner-web already
  showed. **The underlying gap is still open: notification preferences do not persist.** Making the
  count honest needs an endpoint, not a copy change.
- **Email support used the `bell` icon** — the same glyph as Notifications, two rows above. There
  was no `mail` in the icon set, so one was added (Lucide envelope). owner-web already used `mail`.

## The sub-screens

`settings/_layout.tsx` stacks eight pages behind `SettingsPageShell` (back chevron + centred
title). Fixed on 2026-09-24, found by walking all eight on a device:

### Working hours — one line could not hold a day name

It was `[switch] [day] [from] – [to]` on **one** line, and the day column got whatever was left:
~38dp. Every weekday truncated — **`Mo…` `Tu…` `We…` `Th…`** — so Tuesday and Thursday were
identical on the screen an owner uses to say when the shop opens. Only Sunday (closed, no pickers)
ever showed in full.

**Shortening the names was not enough, and this is the useful part.** With `Mon`–`Sun` in a
fixed 38dp column it looked fixed on a 411dp Android emulator, but on a 393pt iPhone `Mon` and `Wed`
— the two widest abbreviations — still clipped to `Mor` and `W…`. There was nowhere to take the
width from: switch 45 + day 38 + two chips 226 ≈ **325pt inside a ~327pt row**. Any fix that tunes
the day column against one screen width is guessing.

So the row is **two lines**: full day name with the switch on the right (where a row toggle belongs
on both platforms), times underneath.

```
  Monday                          [ ● ]
  10:00 AM  –  7:00 PM
```

The horizontal constraint is gone, so the **full** name fits at any width and any system text size,
and no abbreviation list is needed (a `days.abbr` added for the first attempt was removed again —
`days.short` is single letters `S M T W T F S`, ambiguous for the same reason, and is for calendar
headers). The card grew ~160pt into ~220pt of empty space that was already below it, so all seven
rows and the footnote still fit one screen.

`TimeSelect` gained a `style` prop and both chips take `flex: 1`. At their natural width a row of
`9:00 AM` and a row of `10:00 AM` differed, so the separator landed at a different x on every row;
flexing them aligns all seven and scales with the screen instead of a hardcoded width. The chip is
`space-between` so its chevron stays on the right edge when stretched.

### Team logins — the owner was called a co-owner

- The sub-line was `role === 'staff' ? staff : coOwner`. **Three** roles reach it, not two, so the
  super owner was labelled "Co-owner" — directly under an "Owner account" badge saying the
  opposite. There is now a `team.owner` string and an `isSuperOwner` branch.
- **"Add co-owner" was `variant="secondary"`, which is a filled teal**, so it sat beside the filled
  blue "Add staff login" as an equal-weight fill — and the rarer, higher-consequence action (a
  co-owner gets everything the owner has) read as the louder one. Now `outline`.
- The phone rendered raw (`919399385943`); it goes through `formatPhone` like everywhere else.

### A backend bug underneath the team screen

`/users` returned `isSuperOwner: false` for `role: "owner"`. The column, the service mapping and the
**admin portal's provisioning** are all correct — but `backend/db/seed.ts` never set
`is_super_owner`, so the seeded tenant was the single place the super owner was not flagged. That
is the repo's only fixture (CLAUDE.md §12.4), so anything behind `requireSuperOwner` would have
403'd in every local test, and the team card showed the co-owner blurb instead of the owner one.
Fixed in the seed; **re-seed after pulling** or the local tenant keeps the old flag.

### Smaller fixes

- **Appearance mixed spellings on one screen** — "Brand color" beside "Button colour". The app is
  now `color` throughout (0 occurrences of `colour`). ~~**owner-web is still mixed**~~ (fixed in the
2026-09-24 port: owner-web's Appearance says `color` too; was 12 `colour` /
  8 `color`) — there is no house style anywhere, and picking one is a two-surface copy decision.
- **`settings.yourAccountSub` said "Your name and password"** but `password.tsx` has no name
  field. Note this is the **fallback only**: the row renders `store.session?.name ?? sub`, so an
  owner with a name sees their name and never saw the wrong string. Now "Change your password".

### Left alone

- **Notification toggles still do not persist** — `settings/notifications.tsx` is local `useState`
  over a hard-coded list. Only the fabricated *count* was removed (above); making the screen real
  needs an endpoint.
- **Business profile's Address input renders scrolled to the end** ("o 4, Linking Road…" for "Shop
  4, …"). Cosmetic, single-line `TextInput` behaviour, not investigated.

## Density

`TSettingsRow` was `paddingVertical: 14` / `minHeight: 58` with a 38dp icon, which fitted only five
of the ~11 rows on a phone: Account, Support and Sign out were two scrolls away. Now 11 / 52 with a
36dp icon, and `section.marginBottom` 22 → 16. "Bookings & queue" now reaches the first screen.
`TSettingsRow` is shared with `settings/profile.tsx`, which was checked too.

## Verified (2026-09-24)

Android release build against a local API with the seeded Sharp Cuts shop, signed in as the owner:

- Footer reads **"TejoTime v1.0.3 · Signed in as Sharp Cuts Owner"** (read back from the
  accessibility tree, not just the screenshot).
- Email support shows an envelope; Notifications reads "Alerts and reminders".
- The denser list reaches "Bookings & queue" without scrolling.
- Type check and lint clean.
- **Not checked:** iOS (`simctl` can't tap), a staff login (fewer groups), tablet layout, and the
  `footerNoUser` branch — the seeded owner always has a name, so that path needs a session without
  one to exercise.
