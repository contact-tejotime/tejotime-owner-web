# Mobile Home screen

**Redesigned:** 2026-09-22 · **Applies to:** `app/` (iOS and Android) · owner-web: see the bottom

Home is the first tab and the screen an owner looks at most. From top to bottom:

| Block | File | Shows |
|---|---|---|
| Header | `components/home/HomeHeader.tsx` | Store logo (or initials tile), "Good afternoon · Tue, 22 Sep", store name, notifications |
| Live queue card | `components/home/LiveQueueCard.tsx` | Waiting · In service · Walk-in wait, with **Add walk-in** and the booking-QR shortcut in its top row |
| Seats | `components/queue/QueueBoard.tsx` | Seat filter chips (2+ seats only), one board per seat, drag to reorder |

Today's bookings are **not** on Home. A "Today" summary card sat between the live card and the
seats briefly on 2026-09-22 and was removed at the owner's request, to keep Home about the queue.
They live on the Appointments tab.

`app/src/app/(app)/(tabs)/dashboard.tsx` composes them. The header stays fixed. Everything else
is **one** scroll with one pull-to-refresh: the summary cards are passed to `QueueBoard` as its
`header` and drawn inside its scroll view. They used to sit fixed above a separately scrolling seat
list, which left the seats a letterbox on small phones.

## What each number means

The live card uses the same per-seat data as the seat boards (`store.seats`, built by the backend's
queue engine), so the card and the boards can't disagree.

- **Waiting:** the sum of every seat's waiting count. A staff login sees only its own chair.
- **In service:** *people* being served, not busy seats. A business with no staff has a single
  shared group that can serve several people at once.
- **Walk-in wait:** what someone walking in now would wait on the soonest seat (`clearMinutes`).
  It reads **Now** while any seat is empty. This is the number the owner quotes at the door. The
  `__unassigned__` "Any" group, which holds tickets whose seat was deleted, is left out. It's only
  counted when it's the only group (a business with no staff at all).
- While the first load after sign-in is in flight (`bootstrapping`), the numbers pulse instead
  of showing false zeros.

## Design decisions

- **The store's mark in the header is solid.** It is `components/ui/StoreMark.tsx`, shared by Home's
  header and the Settings header (`THeader` with `avatar`, `avatarUrl`). It shows the uploaded logo
  (`business.logoUrl`, from GET /business) on the card surface with a hairline border. Without a
  logo, or if the logo fails to load, it shows the initials on a **solid brand-colour tile** in the
  brand's ink. It used to be `InitialsAvatar`: a pale brand tint behind brand-tinted initials. On a
  warm page (a red brand on a beige preset) that tint all but disappeared, and owners reported
  nothing showing in front of the store name. `InitialsAvatar` is still used for *people*
  (customer cards), where a quiet tint is right.
- **One primary action.** Home used to offer "Add walk-in" twice: a Quick actions button and a
  Walk-in pill in the queue header. It's now the one button on the live card. The booking QR
  moved into the card's corner. The single-seat "0 waiting" pill is gone, because the card already
  says so.
- **The card stays short, because the seats are the point.** "Add walk-in" is a pill in the card's
  top row beside the QR button, not a full-width button under the figures. As a full-width button
  the card ran ~210dp and pushed the seat boards — what an owner actually works from — off the
  first screen. At roughly half that, Home shows the card, the seat chips and a full seat board
  before the fold on a 1080×2400 phone.
- **The live card is the store's own brand colour,** and the only filled surface on Home.
  Everything on it uses the brand's **ink** (`textOnBrand`), dimmed with `withAlpha`
  (`theme/ink.ts`), never a fixed white. In dark mode the engine lightens the brand and the ink
  turns dark. A fixed white would vanish, which is also why the chip counts no longer use
  `rgba(255,255,255,…)`. The "Add walk-in" button inverts the card (ink fill, brand label). Checked
  in light and dark mode. The ink is **white wherever white reaches 3:1** on the brand (see
  [18-theming-architecture.md](./18-theming-architecture.md), "White first on brand fills"), so a
  mid-tone brand like orange gets white numbers and a white button, not black and navy.
- **No infinite animations** (a live pulse, say). A screen that never goes idle stalls Android's UI
  tooling and Google Play's pre-launch crawler (see [mobile-onboarding.md](./mobile-onboarding.md)).
  "Live" is a static green dot.
- **An empty seat is a shortcut.** Tapping "Seat free · Tap to add a walk-in here" opens the walk-in
  sheet with that seat already chosen (`openWalkin()` then `setWalkinStaff(id)`). The
  `__unassigned__` group gets the plain sheet, because its id isn't a seat the API accepts.
- **Seat boards:** a status dot before the sub-line (green free, brand colour serving), a 40dp
  avatar, and a "Press and hold a card to move it" hint. The hint appears only when there is
  something to drag.
- **The seat board's strings come from the BACKEND, not the app.** `GET /queue` returns each seat
  already built — `subLine`, `waitBadge` and every card label — and `lib/mappers.ts::mapSeat` passes
  them straight through. `app/src/lib/queue.ts::buildSeatGroups` still holds a parallel
  implementation with its own `t.format.*` strings, but **nothing imports it**: editing those keys
  changes nothing on screen. The live copy is `backend/src/lib/queue-engine.ts`, and two unit tests
  in `backend/tests/unit/queue-engine.test.ts` assert the exact strings, so a change there fails
  the suite until they are updated too.
- **The sub-line is short, and wraps.** It shares its row with the avatar and the waiting badge,
  which leaves ~26 characters at 411dp. `"Serving Darshil · ~30 min"` is 25 — it fitted on an
  Android emulator and cut on a 393pt iPhone. It is now `~{n}m` (the form the walk-in sheet already
  used), and `"Available · ready for walk-in"` became `"Ready for walk-ins"`. Shortening alone is
  not enough, though: a long first name with a three-digit ETA still reaches the edge, and a
  truncated `~30…` loses the number the line exists to show — so the sub-line is `numberOfLines={2}`
  and wraps instead. Verified at font scale 1.15 with `"Serving Darshil · ~266m"`, which wraps and
  keeps the figure.
- **Tab icon:** Home is now the `home` (house) icon. `layoutDashboard` rendered as the same four
  squares as Calendar's `grid`. Changed on owner-web too (bottom nav and sidebar).

## Permissions

Each block follows the permission map. Without `queue` there's no live card or seat boards (and
no QR shortcut on the card, so the QR gets a plain button of its own). Without `profile` there's
no QR. A login with neither still gets the header and an empty page, not an error.

## owner-web

**Brought across on 2026-09-24.** owner-web's Home (`owner-web/src/app/(app)/dashboard/page.tsx`)
now has the same blocks, rules and wording:

| Block | owner-web file |
|---|---|
| Header: store mark, "Good evening · Thu, 24 Sep", store name, bell | `dashboard/page.tsx` + `components/StoreMark.tsx` |
| Live queue card: Waiting · In service · Walk-in wait, **Walk-in** pill + QR | `components/LiveQueueCard.tsx` |
| Seats: heading + drag tip, chips (2+ seats only), boards, empty-seat shortcut | `components/QueueBoard.tsx` (via `HomeQueueSection.tsx`) |

The "Quick actions" row, the queue's Walk-in chip and the single-seat "N waiting" pill are gone,
as on the app. Differences that are deliberate, because this is a browser:

- **The greeting uses the store's timezone** (`GET /business` → `timezone`, default
  `Asia/Kolkata`), not the server clock. The page is server-rendered, and Railway's clock is UTC.
- **The logo comes from `GET /business`**, which is profile-gated, as on the app. A login without
  `profile` gets the initials tile.
- **Drag is by the grip**, not press-and-hold, so the tip reads "Drag a card by its handle to move
  it" and the empty-seat hint says "Click", not "Tap".
- **The seat board badge is the backend's `waitBadge`** ("2 waiting" / "Free"), green while the
  chair is free, as on the app. It used to be a web-only Busy/Free pill.
- **Layout by width:** one column of seats on a phone, two on a tablet (641–1024px), and as many
  340px+ columns as fit beside the sidebar on desktop. A single seat on screen (a one-chair shop,
  or one picked from the chips) always spans the full width instead of sitting in half a grid.
  The live card's top row stays on one line down to 320px.
- **Desktop (≥1025px): the live card becomes a header row plus three cards,** at the owner's
  request — "● LIVE QUEUE" with Walk-in and QR on the right, then Waiting, In service and Walk-in
  wait as separate white cards with an icon each. One brand banner the width of a monitor spread
  three numbers a screen apart. It is the same markup as the phone card, only restyled, so the
  numbers and the action can't drift between layouts, and the cards are the shared `.kpi-card`
  that Reports also uses ([owner-web-app-parity.md](./owner-web-app-parity.md)).
- **The booking QR renders through `OverlayPortal`.** Rendered in place, it sat under the seat
  boards on a phone: the live card is `isolation: isolate` (for its discs), which trapped the
  dialog's z-index inside the card.
- **Queue tickets** are the app's `QueueCard` (`components/QueueTicketCard.tsx`); on the web the
  number tile doubles as the drag handle, and Start / End / × appear on mouse hover only.

Verified 2026-09-24 in headless Chrome against a local API on the seeded Sharp Cuts shop at 320,
375, 414, 768, 1024, 1280, 1440 and 1600px: no horizontal overflow at any width; the card reads
3 waiting · 2 in service · Now; clicking Mike's empty seat opens the walk-in sheet with Mike
chosen, and the card's Walk-in opens it on "Any seat". Type check and lint clean. The desktop
three-card layout was checked at 1100 and 1440px, and dark mode (owner-web follows the store's
Appearance mode, `data-tt-mode` on `.app`) at 375 and 1280px. Not checked: a staff login, and a
store with an uploaded logo.

## Verified (2026-09-22)

Android release build against a local API with the seeded Sharp Cuts shop (three seats, five tickets,
four bookings), first on the default blue brand, then on red (`#DC2626`) for the header mark:

- The Home layout renders with the right numbers (3 waiting · 2 in service · walk-in wait "Now",
  with Mike's chair free).
- The seat chips show their counts.
- Tapping an empty seat opens the walk-in sheet with Mike pre-selected.
- Dark mode is legible throughout.
- Type check and lint are clean.
- The header mark on a red brand: the initials tile, and the uploaded-logo version.
- Not checked: iOS (the simulator can't be tapped from the command line), tablet layouts, and a
  staff login.

Re-checked on 2026-09-24 after the card was made compact: the same build and shop, Home shows the
live card (3 waiting · 2 in service · walk-in wait "Now"), the seat chips, John's whole board and
the top of Lisa's without scrolling. Type check and lint clean. iOS still unchecked.
