# Current work

**Last updated:** 2026-09-06 · branch `feat-jay`.

This is the living document. Update it when the state of play changes; the other five docs describe
the system as designed, this one describes where it actually is.

---

## 1. What is in flight

### Microsite team avatars (2026-09-07)

Uploaded staff photos never showed on the live page. Not a save or a serving bug — verified end
to end that `staff.avatar_url` persists, the public DTO exposes `avatarUrl`, and `/media/...`
302-redirects to a signed bucket URL that returns `200 image/jpeg`. The card in
`sections.tsx::LiveBoard` simply never rendered it; `photo` and `avBg` had sat unused on the
`LiveMember` interface since the section was written.

`MemberAvatar` renders a round, cover-fitted photo, falling back to the member's **initials on
`avBg`** when there is none, and again via `onError` if the signed redirect fails. Plain `<img>`
(with the gallery's existing `eslint-disable`) because `next/image` would need the bucket host in
`remotePatterns`. Confirmed against the actual server-rendered page: John's photo `src` present,
`SS` / `L` / `M` monograms for the three staff without one.

### Multi-service selection (2026-09-07)

The microsite and the mobile walk-in sheet let a customer pick exactly **one** service. Real
visits are routinely "haircut AND a hair spa", so the second service was invisible: the wait-time
engine sized the visit at 30 minutes instead of 90, and checkout suggested ₹350 instead of ₹1150.

- **No new shape for the queue.** A multi-service visit is stored the way `queue_extend` already
  stores add-ons: `service_id` = first service, `service_name` = "Haircut + Hair Spa",
  `extra_minutes` = Σ of the rest (read by `estMins`), one `queue_entry_extra` row per extra
  (summed by `billingFor`). Both numbers were therefore already correct once the rows existed.
- **Migration 0025** adds `appointment_service` (bookings must itemise — a booking is made now and
  checked in later) and `queue_attach_services()`, which does what `queue_extend` does but works
  on a **`waiting`** entry; `queue_extend` refuses anything not already `in_service`, by design.
  `appointment_check_in` replays those rows so nothing is lost at the counter.
- **APIs** take `serviceIds[]` and still accept the legacy singular `serviceId` (folded in first),
  so already-shipped clients keep working. Slot length is the **sum** of the chosen services — a
  90-minute visit books a 90-minute hole. An unknown id is a **404**, never a silent drop.
- **UI**: microsite service cards are square checkboxes with a running "N selected · M min" total
  and a visit total that stays a range when a range-priced service is in the cart; the mobile
  `ServiceCard` gained a `multiSelect` tick box and the walk-in sheet the same total.
- **Tests**: 11 new Tier-1 assertions ("MULTI-SERVICE VISITS"). Suite now **93/93**, exit 0.

### Multi-day booking on the microsite (2026-09-07)

"Book an Appointment" was **today-only** — `fetchSlotsForToday()` hardcoded one date — so a
customer arriving late in the day saw whatever was left of today and got pushed at the waitlist.
The seeded salon shows the shape of it: **today had 1 slot left at 7:30 PM while the next open
day had 20.**

- **No backend change was needed.** `GET /public/businesses/:slug/slots` already accepted `date`
  and `staffId`, resolved that weekday's hours, excluded taken appointments, and filtered past
  times with `cursor.isAfter(now)` (a no-op for a future day). `bookSlot` already took any
  `slotStart` and `preferredStaffId`. The client API wrapper already forwarded all three params.
- **Client** (`MicrositeClient.tsx`): a `bookDate` state and a 14-day horizontal day strip with
  closed weekdays greyed rather than hidden. `fetchSlots(serviceId, date, staffId)` replaces the
  today-only version and takes its inputs as arguments — every caller fires from the event that
  changes one of them, so reading state there would fetch the previous day. A `slotReq` ref drops
  out-of-order responses.
- **Two latent bugs fixed on the way.** The date was built with `toISOString().slice(0,10)` — the
  **UTC** day — so a customer in IST before 05:30 asked for yesterday and was told nothing was
  available. Now local date parts. And provider choice never reached the slots query, so the
  times shown ignored which chair was picked; a named provider now narrows availability.
- **Check in stays a separate entry point.** "Join the walk-in waitlist instead" is now a
  fallback only: selected day has no times AND it is today AND the store is open. It used to
  appear for any empty day, which will now be most future days a customer browses.
- **Copy**: `timeLabel` → "Choose a date and time"; empty states name the day
  (`slotsEmptyDay` / `slotsClosedDay`); `slotsEmpty` / `slotsEmptyClosed` deleted as dead, keeping
  the microsite dictionary's zero-unused-key property.
- **Out of scope, still absent:** cancel, reschedule, calendar export.
- **Tests**: 12 new Tier-1 assertions in `smoke-rest.mjs` ("MULTI-DAY BOOKING + PREFERRED
  PROVIDER"). Suite now **82/82**, exit 0.

### Service pricing modes — fixed vs range (2026-09-07)

A service can now be priced two ways, and the store says which instead of every surface guessing
from a zero.

- **DB** — migration `0024_service_price_range.sql` adds `service.price_type`
  (`fixed | range | unset`) and `price_max_paise`, with `ck_service_price_shape` enforcing one
  shape per mode. **The backfill is the decision worth knowing:** `price_paise > 0` → `fixed`;
  `price_paise = 0` → **`unset`**, not a fixed zero and not a bounded range. Those rows had no
  price and no bounds to invent, so they are recorded as unpriced and the write schemas refuse
  `unset` — an owner opening one must choose a mode. `unset` can never be created again.
- **Checkout** — `queue_checkout` raises `TEJO:AMOUNT_REQUIRED` (→ 422) when no amount is passed
  for a `range` or `unset` service. Deriving would bank the band's *minimum* into
  `visit.amount_paise`, which is the same under-reporting migration 0020 was written to stop.
  `GET /queue/:id` returns `amountRequired` and a **null** `suggestedAmount` for those, so the
  sheet has nothing dishonest to pre-fill. Fixed services are unchanged end to end.
- **One resolver** — `backend/src/domain/money.ts::servicePricing` reads a row into
  `{ priceType, price, priceMax, amountRequired }`; the owner service list, the public microsite
  DTO and the checkout billing all go through it.
- **UI** — Fixed/Range pickers in `owner-web/ServicesEditor`, `admin-panel/StoreForm` and the
  mobile `ServiceEditSheet`; the microsite renders `₹min–₹max` for a band and **"Price on
  request"** for an unpriced service (the old `priceVaries` key is gone). Range checkout starts
  with an **empty** amount box in both `owner-web/QueueDetailSheet` and mobile `DetailPanel`.
- **Admin provisioning got stricter**: `priceRupees` is now `.positive()`. A named service is a
  priced service. Categories that legitimately have no menu (Hospital, Restaurant) send no
  services at all and are unaffected.
- **Tests — all executed and green** against a local Postgres 17 + migrated + seeded database:
  `backend` vitest **60/60**, `smoke-rest.mjs` **70/70** (exit 0), `smoke-socket.mjs` **6/6**
  (exit 0). The admin create-store (201) and edit-store (200) paths were driven directly with a
  two-range-service payload, and the range→fixed switch verified to clear `price_max_paise`.
- **Two pre-existing smoke-script bugs surfaced once it could finally run.** `first John waiter
  ETA ~45 min` asserted the *undecayed* estimate — the seed pins the in-service head 15 minutes
  into a 45-minute service and `remainingMins` decays it, so the real value is ~30 and falling.
  It now asserts the band, not a literal, so it cannot rot again. And the range-checkout test
  seated its walk-in with `staffId: 'auto'`, which by that point picks a seat that is already
  serving; `queue_start` raised SEAT_BUSY and the 422 assertion then passed for the **wrong**
  reason (INVALID_STATE is also 422 — only asserting on the error *code* caught it). It now
  creates a dedicated idle seat.
- **Smoke scripts fixed while in there**: both posted `{ handle }` to `/auth/login`, which
  `loginSchema` (`.strict()`, requires `phone`) rejected as a 400 — every run failed on its first
  assertion. They now post the seeded phone. `README.md` carried the same stale credential.
- **The seed gained a fifth service**, `Hair Extensions` (₹2,000–₹6,000), as the range fixture.
  `smoke-rest.mjs` now expects 5 microsite services, not 4.

### The U.S. market repositioning (marketing site)

The public site has been rewritten from India-market copy to a U.S. launch, against a client copy
guide. **Shipped** in `bc0b482`:

- Homepage copy replaced wholesale — hero, proof bar, industry cards, feature section, online
  booking, walk-ins, client management, getting started, pricing, FAQ, closing CTA.
- Internal production notes removed from the public site; no `$XX` placeholder pricing anywhere.
  Pricing is Starter (free during the pilot) / Business (**"Coming soon"**) / Multi-location
  (contact us).
- "Walk-ins" reframed as an **optional** walk-in waitlist, because walk-ins don't fit every target
  industry.
- Med-spa and physical-therapy copy carries **no HIPAA, medical-record, insurance, or compliance
  claims** — those capabilities are not verified. Keep it that way.
- The unverified social-proof gallery was replaced with a `ProductTour` component until real pilot
  photography and testimonials exist.
- New routes: `/industries/[slug]` (9 industry pages), `/resources`, `/terms`, `/accessibility`;
  `/privacy` rewritten.

### The customer booking page (microsite) copy + correctness pass

Same U.S.-market repositioning, now applied to the **public customer microsite** (`/{phone}`).
Full record: **`docs/customer-booking-page-copy-2026-09-06.md`** — read it before touching
microsite copy. The three things worth knowing here:

- **One vocabulary rule drives the whole page.** "Book an Appointment" = a scheduled visit,
  "Check in" = a walk-in. Never "Free" for *available*, never `$0` for *unpriced*.
  Service cards now open the **booking** flow (they say "Book"); the Team section and the hero
  own the walk-in flow.
- **A closed store no longer invites walk-ins.** `walkInsClosed` gates every walk-in control and
  swaps them to booking. The gate is `hours.length > 0 && !isOpen`, **not** `!isOpen` — a store
  that never configured hours reports `isOpen: false` forever, and gating on the raw flag would
  have switched check-in off for every one of them. UI-only; the API still accepts an
  out-of-hours join.
- **`openStatus` gained `nextOpenLabel`** ("Monday at 10:00 AM", business-timezone-resolved) so a
  closed page can say when to come back. Covered by `backend/tests/unit/open-status.test.ts`.

A second review pass caught what the first missed: `LiveStatusLine` was **hardcoded English**
saying "All 4 free" in the two most prominent slots on the page, the closed gate stopped at the
outside of the provider cards, and `joinAfterTrack` bypassed it entirely. Also removed: the dead
`DomainProfile.liveNote` / `.ctaSub` (ten stale strings), dead `trustCells` (which rendered an
empty About band on stores with reviews but no About copy), and salon-only vocabulary — "shop",
"chair", "token" — from strings every vertical sees. A dead-key audit over the microsite
dictionary now reports zero unreferenced keys.

### Legal pages

`/privacy`, `/terms`, `/accessibility` render from `frontend/src/i18n/en.json` through
`components/legal/LegalPage.tsx`. Company-specific facts are `{token}` placeholders resolved from
`t.legal`; **an unfilled token renders as a visible amber marker** so an unverified detail cannot
ship unnoticed.

All four values are now filled:

| Key | Value |
|---|---|
| `entity` | `TejoTime` (confirmed as the name to use) |
| `address` | `4213 Lee Blvd, Lehigh Acres, FL 33971` |
| `supportPhone` | `+1 (239) 506-1324` |
| `governingState` | `the State of Florida` |

There are currently **zero** pending markers on any legal page.

> These are solid, product-accurate drafts, **not attorney-reviewed**. The liability, indemnity and
> governing-law sections in particular should get a lawyer's read before launch.

### Contact details unified across all four apps

`+1 (239) 506-1324` / `4213 Lee Blvd, Lehigh Acres, FL 33971` are now the single source of truth in
`{app,admin-panel,owner-web}/src/lib/support.ts` (`SUPPORT`) and in `frontend`'s `t.legal`. The
previous Indian support number is **gone from the entire monorepo**.

The address renders in the real contact blocks — owner-web support card, the app's support block,
admin login help, and all three legal pages — but deliberately **not** in the compact two-item
strips (app tab bar, login rows), where it would be noise.

---

## 2. Fixes landed alongside

- **`shell()` client/server crash.** `owner-web`-style `shell()` was exported from
  `MarketingChrome.tsx` (`"use client"`) and called by the server-rendered industry and resources
  pages, which **broke the production build**. Extracted to
  `frontend/src/components/landing/shell.ts` with no `"use client"`. `tsc --noEmit` does not catch
  this class of bug — only `npm run build` does.
- **Industry card copy truncation.** `globals.css` clamped `.tj-photo-body` to 2 lines below 680px.
  The new, longer client-approved copy truncated mid-sentence on every phone. Clamp removed.
- **Toast overlapping the closing CTA.** The toast was `position: sticky`, so at the end of the page
  it resolved to its flow position on top of the Start Free / Book a Demo buttons. Now `fixed`, with
  an iOS safe-area inset.
- **Anchor links landing under the sticky header.** Added `scroll-padding-top` (88px desktop, 80px
  mobile).
- **`/terms` horizontal overflow** at 320–360px from a non-wrapping pending-marker chip.

Verified with a scripted audit across **6 viewports × 6 pages**: no horizontal overflow, no clipped
text, no JS errors. Frontend, owner-web and admin-panel all typecheck; frontend builds and lints
clean.

---

## 3. Known gaps, roughly by severity

### Security / correctness

- **`verifyAdminOtp` mints a full 12h admin JWT against a hardcoded constant.** Flag-gated off
  (`OTP_ENABLED=false` everywhere, including production), but it is a complete auth bypass if the
  flag is ever turned on before real OTP verification is implemented.
- Admin tokens are signed with **`JWT_ACCESS_SECRET`, the same secret as owner tokens** — only the
  `typ` claim separates them. A separate secret would be safer.
- Refresh tokens are stored as `sha256(jti)` with **no per-device metadata used** —
  `auth_session.user_agent` / `.ip` exist but are never written, so there is no session list and no
  targeted revoke.
- **Public writes are not idempotent** — the `idempotency_key` table exists but no middleware uses
  it. A double-tapped "join queue" creates two entries.
- **`audit_log` exists but nothing writes to it.**
- `otp_verification`, `payment`, and the payments/SMS webhook handlers are scaffolding only.

### Infrastructure

- **`owner-web/` has no `Dockerfile` and no `railway.toml`** despite `DEPLOY.md` listing a
  `tejotime-owner` service at `business.tejotime.com`. The only app service without
  config-as-code.
- **`owner-web/` has no CI job.** Lint and build it by hand before merging.
- CI does not run `check:theme`, `check:crop`, `check:axes` or `test:theme`, so the four theme
  mirrors can drift silently.
- Migrations are manual and unversioned in deploy — nothing enforces schema-before-image.
- Backend pinned to one replica (see `deployment.md` §4).

### Product

- **Staff `/owner` sockets join a seat room that nothing emits to**, so staff clients silently fall
  back to polling for live queue updates. Seat-scoped emitters are unimplemented.
- **Joining a queue outside business hours is still allowed by the API.** The microsite hides
  every walk-in control when the store is closed, but `POST /public/businesses/:slug/queue` does
  not check. A server-side rule needs a product call — shops that run late are a real case.
- **No cancellation / no-show policy field on `business`**, so the booking flow cannot state or
  link one. The copy review asked for it; it needs a column and an owner-portal editor first.
- **Appointments cannot be rescheduled, cancelled or exported to a calendar**, and booking slots
  are **today-only** — which is what constrains the booking copy on the microsite.
- Backend still defaults `DEFAULT_CURRENCY` to **`INR`** with prices in paise, and `business.timezone`
  defaults to `Asia/Kolkata`, while the marketing site is now U.S.-facing. **This needs resolving
  before a real U.S. launch** — it is the largest open inconsistency in the codebase.

### Documentation / structure

- `docs/00`–`docs/18` describe a stack that was never built (Prisma, Redis, BullMQ, Supabase).
  Accurate for the data model, error catalog and role matrix; actively misleading for the stack.
  `DEPLOY.md` and `docs/qa-report-*.md` are current.
- Six-plus utility modules duplicated across the web apps **by hand with no sync guard** —
  `countries.ts`, `phone.ts`, `format.ts`, `support.ts`, `frontend-url.ts`, `PhoneField`, `i18n`.
- i18n migration is partial; `owner-web` in particular still has many inline strings.
- Duplicate migration prefix `0016`. Use `0025+` going forward.

---

## 4. Testing reality

Thin, and worth being honest about:

- `backend/tests/unit/` — **6 vitest files, 52 tests**, covering **pure functions only**:
  `queue-engine`, `eta-notify`, `ttl-cache`, `whatsapp`, `whatsapp-webhook`, `open-status`.
- `frontend/src/theme/engine/__tests__/run.ts` — framework-free theme self-check.
- `backend/scripts/smoke-rest.mjs` / `smoke-socket.mjs` — end-to-end smoke against a running,
  seeded server.

**No route or integration tests, no DB tests, no frontend or mobile tests, no coverage gate.**
The microsite copy pass is the sharpest example: its backend half is unit-tested, and every one of
its rendering changes — the `$0` rule, the closed-state gate, the per-store page title — is
verified by nothing but a manual look.
`supertest` is a devDependency but unused. Permission guards, tenant scoping, the plpgsql
functions and the BFF proxies are verified only by smoke scripts and manual QA
(`docs/qa-report-2026-07-10.md`).

Practical consequence: when you change a guard, a scope, or a `queue_*` function, **exercise it
manually or extend the smoke scripts** — nothing else will catch a regression.

---

## 5. Suggested next steps

1. Resolve the **currency/timezone mismatch** (`INR`/`Asia/Kolkata` defaults vs a U.S. launch).
2. Add `owner-web` **`Dockerfile` + `railway.toml` + a CI job** — it is deployed but unconfigured.
3. Wire the four guard scripts into CI so theme mirrors cannot drift.
4. Get the legal pages **attorney-reviewed** before launch.
5. Implement real admin OTP, or remove `verifyAdminOtp` entirely rather than leaving a
   flag-gated bypass in the tree.
