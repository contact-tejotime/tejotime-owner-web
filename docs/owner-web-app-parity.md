# owner-web ↔ app parity

**Brought across:** 2026-09-24 · **Applies to:** `owner-web/` · **Design source:** `app/` (iOS and Android)

The owner asked for one product on three surfaces: **on a phone, owner-web shows the same UI as the
app; on a tablet or desktop it shows the same design, laid out for the width.** Every owner-web
screen was ported to that rule on 2026-09-24. This doc says where each screen's code lives, what
was deliberately left different, and why. Keep it current — CLAUDE.md §11.1 makes an owner-facing
change unfinished until both codebases match.

## The rule, per width

| Width | Chrome | What a screen must look like |
|---|---|---|
| ≤640px (phone) | bottom nav + "Need help?" strip | The app's screen: same blocks, order, wording, icons, cards, badges, empty states |
| 641–1024px (tablet) | bottom nav + strip | The same components, in the app's tablet layout (2-up grids, centred 720px forms) |
| ≥1025px (desktop) | sidebar + footer contact | The same components and styling laid out for the width — multi-column grids, capped readable widths. Never a phone column stretched across a monitor, never a different design language |

Two desktop layouts are **the owner's explicit decisions**, not parity drift. Keep them:

- **Home:** the live-queue card becomes a header row (● LIVE QUEUE · Walk-in · QR) and **three
  separate cards** (Waiting, In service, Walk-in wait). One brand banner the width of a monitor
  spread three numbers a screen apart.
- **Reports:** Revenue, Appointments, Completed and In queue are **four equal cards** (three on
  This month), 2×2 between 1025 and 1279px where four don't fit beside the sidebar.

Both use **one** shared desktop card: `.kpi-card` / `-icon` / `-text` / `-value` / `-label` /
`-note` in `globals.css` (≥1025px block). The rules are prefixed `.app` on purpose: a screen's own
stylesheet loads after `globals.css`, so its single-class phone rules would otherwise win. Change
the card there and both screens move together.

## Where each screen lives

Each screen's CSS is its own file in `owner-web/src/styles/`, imported by the page, with every
selector behind a screen prefix so it cannot leak. `globals.css` keeps only shared rules.

| Screen | App | owner-web | CSS |
|---|---|---|---|
| Home | `(tabs)/dashboard.tsx`, `components/home/*`, `components/queue/QueueBoard.tsx` | `dashboard/page.tsx`, `LiveQueueCard`, `StoreMark`, `HomeQueueSection`, `QueueBoard`, `QueueTicketCard` | `globals.css` (`.home-*`, `.live-card*`, `.seat-*`), `shell-sheets.css` |
| Reports | `(tabs)/stats.tsx`, `cards/StatCard.tsx`, `feedback/DateRangeSheet.tsx`, `feedback/CommissionVisitsSheet.tsx`, `lib/commission-text.ts` | `stats/page.tsx`, `stats/ReportQueuePreview.tsx`, `stats/CommissionVisitsSheet.tsx`, `stats/commission-text.ts` | `reports.css` (`.rp-*`) |
| Commission rates | `settings/commission.tsx`, `components/settings/CommissionEditSheet.tsx`, `common/TMonthGrid.tsx` | `settings/commission/page.tsx`, `components/CommissionEditor.tsx` | `settings-b.css` (`.cm-*`) |
| Appointments | `(tabs)/appointments.tsx`, `AppointmentListItem.tsx` | `appointments/page.tsx`, `components/AppointmentListItem.tsx`, `lib/appointments.ts` | `appointments.css` |
| Calendar | `(tabs)/calendar.tsx`, `DayAppointmentsSheet.tsx` | `calendar/page.tsx`, `calendar/CalendarMonth.tsx` | `calendar.css` (`.calx-*`) |
| Recurring: Regulars, Needs attention, series sheet ([recurring-appointments.md](./recurring-appointments.md)) | `(tabs)/appointments.tsx` (Today \| Regulars), `appointments/RegularCard.tsx`, `appointments/NeedsAttentionCard.tsx`, `feedback/SeriesSheet.tsx` (mounted in `(app)/_layout.tsx`), `lib/series.ts`, `state/store.tsx` | `appointments/page.tsx` (`?view=regulars`), `appointments/RegularsList.tsx`, `components/series/*` (`SeriesSheet` in a `BottomSheet`/`OverlayPortal`, `NeedsAttentionCard`, `RepeatMark`, `ResolveIssueButton`), `lib/series.ts`, BFF `api/appointments/series/**` | `appointments.css`, `series.css` |
| Recurring Phase 2: Move visit, Change future visits, Book another time | `appointments/SlotPickerInline.tsx`, `appointments/RescheduleInline.tsx`, `appointments/ChangeFuturePanel.tsx`, `lib/zoned.ts` (store-clock times) | `series/RescheduleSheet.tsx`, `series/ChangeFuturePanel.tsx`, `series/BookingSheets.tsx` (one host for the series sheet, row Reschedule and Book another time on Appointments and Calendar), BFF `api/appointments/[id]/slots`, `series/[id]/slots`, `series/[id]/preview-change`, `series/issues/[issueId]/book` | `series.css`, `calendar.css` |
| Customers | `(tabs)/customers.tsx`, `cards/CustomerCard.tsx` | `customers/page.tsx`, `customers/CustomerCard.tsx`, `CustomerSearch.tsx` | `customers.css` |
| Settings hub | `(tabs)/settings.tsx`, `TSettingsRow.tsx` | `settings/page.tsx`, `SettingsScreen.tsx`, `settings/account/` | `settings-hub.css` (`.st-*`) |
| Hours, Team, Notifications, Password | `settings/hours|team|notifications|password.tsx` | `settings/hours|team|notifications/`, `HoursEditor`, `TeamManager`, `ChangePasswordForm`, `SettingsSubpageShell` | `settings-a.css` (`.sa-*`) |
| Profile, Appearance, Services, Staff | `settings/profile|appearance|services|staff.tsx`, `components/settings/*` | `settings/profile|appearance|services|staff/`, `components/store-settings/*`, `components/appearance/*` | `settings-b.css` (`.sb-*`) |
| Chrome and sheets | `(tabs)/_layout.tsx`, `THeader`, `TSheet`, `DetailPanel`, `AddWalkInSheet`, `QRSheet`, `ConfirmSheet`, `QueueCard` | `BottomNav`, `AppPageHeader`, `PageHeader`, `BottomSheet`, `OverlayPortal`, `QueueDetailSheet`, `WalkInSheet`, `StoreBookingQr`, `ConfirmDialog` | `shell-sheets.css` |
| Checkout: amount to charge, add-on chips ([checkout-add-ons.md](./checkout-add-ons.md)) | `feedback/DetailPanel.tsx`, `feedback/ConfirmSheet.tsx` (`presentation="overlay"`), `lib/checkout-amount.ts`, `state/store.tsx` (`extendService`, `removeExtra`) | `QueueDetailSheet.tsx`, `ConfirmDialog.tsx` (`prefix`/`inputMode`/`validate`), `lib/checkout-amount.ts`, BFF `api/queue/[id]/[action]` (`remove-extra`) | `shell-sheets.css` (`.dp-chip.is-selected`, `.cfm-input-wrap`) |

## Rules every overlay must follow

**Render sheets and dialogs through `components/OverlayPortal.tsx`.** A `position: fixed` overlay
is only "on top" inside its own stacking context. Any ancestor with `isolation`, `transform`,
`filter`, `opacity < 1` or a z-index on a positioned box traps it, and later siblings paint over it.
That is how the booking QR ended up under the seat boards on a phone: its trigger sits in Home's
live card, which is `isolation: isolate` for its decorative discs. **Do not portal to `<body>`
either** — the store theme (brand colour, surfaces, the whole dark palette) is declared on
`.app[data-tt-theme]`, so a body-portalled dialog came out light and default blue. OverlayPortal
targets that element.

## Behaviour that changed with the port

- **Appointments: check-in was unreachable on the web.** The gate tested a `booked` status the API
  never sends (the real ones are `pending`/`confirmed`). Fixed; check-in now toasts
  "{name} added to queue" and opens Home, as the app does, for logins that can see the queue.
- **Appointments and Calendar read bookings uncached.** The old cached read was keyed only on
  business + path, but `GET /appointments` is narrowed to a staff login's own chair, so an owner's
  and a staff member's lists could be served to each other.
- **Times and dates use the store's timezone** (`GET /business` → `timezone`, default
  `Asia/Kolkata`), not the server clock — Railway runs UTC, which printed times 5h30m off.
- **Walk-in (web):** multi-service, Next up / End of queue, and MR/Patient for Hospital stores —
  the backend requires it, so Hospital walk-ins from the web used to fail.
- **Customer sheet:** reads the live card, not a click-time snapshot, so a ticket another device
  already started stops offering Start.
- **Appearance is its own page,** `/settings/appearance`, as on the app. Profile's save no longer
  carries the theme (PATCH is partial, so that is safe).
- **Services and Staff can be edited** (PATCH name, duration, price mode; name, role, photo) — the
  app always could.
- **"Your account" opens `/settings/account`,** open to every role. It used to open the
  profile-gated `/settings/profile`, so a staff login hit "No access" and could not change its
  password on the web.
- **Notifications:** the handler-less Save button is gone. There is no preferences endpoint, so on
  both surfaces the switches are session-only.
- **Chat button** sits above the bottom nav and support strip up to 1024px. At 22px it covered the
  Settings tab.
- **Store profile — the client's setup review (2026-10-05,
  [store-setup-review-2026-10-05.md](store-setup-review-2026-10-05.md)), the same on both:**
  - **Headline:** "Headline on your page" with an **Ideas:** row of chips for the store type; a tap
    replaces the text. A blank headline is refused inline. The app also toasts it, because the
    field is far above its Save button.
  - **Neighborhood:** "Neighborhood shown on your page (optional)".
  - **About photo:** "About section photo (optional)" with a hint.
  - **Photos section, top:** a **Gallery heading** radio-chip group — Default for the store type,
    the ready-made headings, Custom… (40 characters). Then **"Photos for: {heading}"** directly above
    the photo grid.
    - Once Custom is picked it stays picked while the owner types.
    - The heading saves with the profile's Save.
    - Only the owner form shows it. Staff get the separate name-and-address form, so they never
      send the owner-only field.
  - **Removed on both:** the highlight number and caption.
  - **Store type:** both use `familyFor` (`src/lib/store-family.ts`, synced by `npm run
    sync:family`).

## Deliberately different on the web

Kept because a browser is not an App Store build, or because removing them would lose something:

- **Subscription:** the Settings row, the Team permission grid's billing module, and the Customers
  upgrade card for locked customers (billing logins only). The app must never show them
  ([mobile-no-in-app-purchases.md](./mobile-no-in-app-purchases.md)).
  `/settings/subscription` is still a static mock, so that upgrade path is a dead end until
  billing is real.
- **Mouse-only affordances:** drag-to-reorder (the ticket's number tile is the handle), hover
  Start / End / × on tickets, hover and focus rings.
- **Appointments:** a second "Checked in or closed" section, and a × no-show shortcut on bookings
  whose start time has passed. The app shows no second section.
- **Appointment row actions (recurring, 2026-10-03):** the same set on both — Skip (upcoming series
  visit), Cancel (upcoming one-off) and Mark no-show (time has passed), each confirmed except
  no-show — but drawn differently: the web shows icon buttons beside "Add to queue"; the app
  folds them behind a "⋮" button that unfolds inline (no native action sheet, so iOS and Android
  match). The series sheet's confirmations are inline on the app because iOS will not present a
  second modal over an open sheet.
- **Recurring times:** both now show the **store's** clock. The app gets the zone from `/auth/me` (`business.timezone`, every role) and formats through `lib/zoned.ts`. If Intl can't convert, it falls back silently to the phone's clock, so Hermes on iOS needs a device check. (Until Phase 2 the app used the phone's clock.)
- **Recurring Phase 2 (2026-10-03).** Same flows and wording on both, drawn differently:
  - **The picker:** the web uses a native `<input type="date">`; the app uses the pure-JS `TMonthGrid`. Both take their range from the API (`today`/`lastDay`), and both order it Day → Stylist → Time, because the free times depend on the stylist.
  - **Where it opens:** on the web, Move and Book replace the series sheet's body in place, and row Reschedule opens a sheet. The app runs them inline in the row strip and in the sheet; iOS cannot stack a second modal.
  - **Calendar day sheet → series sheet:** the app closes the day sheet and opens the series sheet 320ms later (same iOS rule).
  - **Escape (web only):** `BottomSheet` marks the Escape it handles (`preventDefault`), so a series sheet opened from the Calendar's day sheet doesn't close both.
  - **Row Reschedule** is offered on both only before the booking's start time. The API also accepts a booking earlier on the store's today.
  - **Staff logins** see only their own chair and no "Any stylist"; the API answers 403 for any other chair.
- **Profile / Appearance:** the store card (live status, Visit, QR), a sticky save bar from 641px,
  preset thumbnails, the preview's device switch, the native colour picker, gallery Move down.
- **Team:** PhoneField with a country picker, fuller confirm copy.
- **Commission dates** ([staff-commission.md](./staff-commission.md)): the web uses the browser's
  `<input type="date">` (Reports' Custom period is a plain GET form); the app uses the pure-JS
  `TMonthGrid` — inline in the rate sheet, because iOS will not present a date-picker modal over an
  open sheet, and without a native module, which would need a new build. Both take their limits
  (the store's today) from the API, and both copies of `lib/commission.ts` are kept in step by
  `npm run test:commission`.
- **Checkout add-on price popup (2026-10-06):** same wording, rules and arithmetic (the two
  `lib/checkout-amount.ts` copies, checked by `npm run test:checkout`). The web shows a
  `ConfirmDialog` over the sheet; the app draws `ConfirmSheet` as an overlay **inside**
  `DetailPanel`'s Modal, because iOS will not present a second Modal over it. Escape (web) and
  Android back close the popup first. Only the web has no toast when an add-on goes on or off — it
  never had one for add-ons; the app keeps its "+10 min · Shave added" / "Shave removed".
- **No pull-to-refresh:** `LiveRefresh` (socket for owners, polling for staff) keeps pages current.
- **Sheets animate in only**; the app also animates them out.

## Known gaps (not fixed)

- **Backend:** `GET /auth/me` has no timezone and `GET /business` is profile-gated, so a login
  without `profile` falls back to `Asia/Kolkata` for times, hours and greetings.
- **Backend:** nothing writes `app_user.dark_mode`. The Settings Dark mode switch flips the page
  for the session only; a reload returns to the store's Appearance mode (on both surfaces).
- **Backend:** `customers.routes.ts` computes `lastVisitLabel` in `DEFAULT_TIMEZONE`, not the
  store's, so "Today" can be a day off for a non-IST store.
- **Dead CSS** in `globals.css` that no screen renders any more (`.sheet-*`, `.service-pick*`,
  `.seat-pick*`, `.store-qr-*`, `.page-head*`, `.card-open/-main/-actions`, `.appt-card`,
  `.cal-grid/-cell`, `.settings-row*`, `.account-fold*`). Left while eight agents edited the file
  in parallel; safe to delete in a cleanup pass after a grep.
- ~~**App-side bug seen, not fixed:** the app's `AppointmentListItem` renders `null · John` for a
  booking with no service.~~ Fixed 2026-09-28 (services became optional, so it would have been
  common): the mapper yields `''` and the row joins whatever is present. The app's `QueueCard` and
  `DetailPanel` got the same treatment. The web still says "No service selected".

## Verified (2026-09-24)

- `tsc --noEmit`, `eslint src` and `next build` clean in `owner-web`.
- A production build served against a local API on the seeded Sharp Cuts shop, driven by headless
  Chrome: all 16 routes at 320, 375, 768 and 1280px — no horizontal overflow, no console errors,
  `/queue` redirects to Home. Dark mode captured at 375 and 1280px.
- Home and Reports desktop cards checked at 1100 and 1440px.
- **Not checked:** a staff login end to end, a Hospital store, real saves on the settings forms,
  iOS Safari's keyboard over bottom sheets, print. There is no automated UI test: owner-web has no
  browser test runner (CLAUDE.md §12.6).
