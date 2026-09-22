# Mobile Home screen

**Redesigned:** 2026-09-22 · **Applies to:** `app/` (iOS and Android) · owner-web: see the bottom

Home is the first tab and the screen an owner looks at most. From top to bottom:

| Block | File | Shows |
|---|---|---|
| Header | `components/home/HomeHeader.tsx` | Store logo (or initials tile), "Good afternoon · Tue, 22 Sep", store name, notifications |
| Live queue card | `components/home/LiveQueueCard.tsx` | Waiting · In service · Walk-in wait, **Add walk-in**, booking-QR shortcut |
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
- **Tab icon:** Home is now the `home` (house) icon. `layoutDashboard` rendered as the same four
  squares as Calendar's `grid`. Changed on owner-web too (bottom nav and sidebar).

## Permissions

Each block follows the permission map. Without `queue` there's no live card or seat boards (and
no QR shortcut on the card, so the QR gets a plain button of its own). Without `profile` there's
no QR. A login with neither still gets the header and an empty page, not an error.

## owner-web

owner-web's Home (`owner-web/src/app/(app)/dashboard/page.tsx`) keeps its own layout: the same
header, quick actions and queue section, laid out for a browser. Only the tab icon changed there.
Bringing the live card to the web is a reasonable follow-up. The numbers are all
available from the same queue payload.

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
