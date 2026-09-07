# Business logic

The rules that are not obvious from the schema or the route list. Most of this lives in
`backend/src/lib/queue-engine.ts`, `backend/src/domain/permissions.ts`, and the `queue_*` plpgsql
functions.

---

## 1. The queue engine

`backend/src/lib/queue-engine.ts` is the heart of the product: **pure functions**, no I/O, no
framework imports. It was ported from the mobile app so the owner queue board, the microsite wait
times, and the customer ticket all derive from **one** implementation. Mirrored by
`backend/tests/unit/queue-engine.test.ts` — the only meaningful test suite in the repo.

### `estMins(item, services)` — how long will this take?

1. **Exact match** on `service_name`.
2. Failing that, **longest-prefix** match — `service_name` may carry add-ons
   (`"Haircut + Shave"`), so the candidate list is filtered to services whose name is a prefix and
   sorted by descending name length. Longest wins, which prevents `"Hair"` beating `"Haircut"`.
3. Failing that, `DEFAULT_SERVICE_MINUTES` (**20**).
4. Plus `item.extra` (the `extra_minutes` column + `queue_entry_extra` rows).

`service_name` is denormalised onto `queue_entry` precisely so this still works after the service
row is edited or deleted.

### `remainingMins(item, services, now)` — the decay rule

- A **`waiting`** item contributes its **full** estimate. It has not started.
- An **`in_service`** item **decays with wall-clock**: `estimate − elapsedMins(startedAt)`,
  floored at 0. An over-running chair reads 0, never negative.

Only the in-service head decays. This is what makes the microsite wait time tick down between
polls without any writes.

### `seatLoad` / `soonestSeat` — "Any seat" assignment

`seatLoad` sums `remainingMins` over a seat's active entries. `soonestSeat` picks the **lightest
load**, and returns `null` when the business has no active staff (a valid state — see §4).

### `buildSeatGroups` — one lane per seat, and two edge cases that matter

Normally: one group per staff member, each with running ETA labels on its waiting cards.

Two failure modes are handled explicitly, and both exist because the naive version made rows
**silently disappear**:

- **A business with zero staff** (Hospital, Restaurant — see §4) gets a single flat `Waiting`
  group. Without it, their queue entries have nowhere to be grouped and vanish from every view.
- **Seatless active tickets** — staff deleted, so `queue_entry.staff_id` went null via
  `ON DELETE SET NULL`, plus legacy rows — land in an `Any` group. Without it they would inflate
  the shop-wide `queueCount` while appearing in no lane at all.

### `ticketPosition` — what the customer sees

Returns `{ ahead, waitMinutes, serviceRemainingMinutes, status }`. `ahead` is the card's 1-indexed
position within its seat's active line, minus one. `serviceRemainingMinutes` is clamped to
`min(seat's in-service remainder, this ticket's own wait)` — the in-service customer's own wait is
already 0, so they never see a phantom countdown.

---

## 2. Checkout, and what it cascades

`queue_checkout` (plpgsql, under the per-business advisory lock):

1. Writes a **`visit`** row (the completed-service ledger).
2. Bumps `customer.visits_count`, `customer.total_spend_paise`, `customer.last_visit_at`.
3. **Auto-promotes the next waiting entry on that seat** into `in_service`.

`p_amount_paise` (migration 0020) is an **override**: pass `null` and the derived service + add-ons
total is used instead.

**`queue_no_show` deliberately does *not* auto-promote.** Marking someone absent should not start
the next customer's clock without the shop deciding to.

---

## 3. The ETA-15 alert

`lib/eta-notify.ts` + `queue.service.ts::processTicketBroadcasts`.

Fires **once per ticket**, for **online live-queue joins only** — not walk-ins, not checked-in
appointments — when `0 < waitMinutes <= ETA_NOTIFY_MINUTES` (default 15).

Idempotency is a **conditional claim** on `notified_eta_15_at`: the update only matches rows where
the column is still null, so exactly one concurrent caller wins. `notified_turn_at` does the same
for "it's your turn".

Consequence worth knowing: **a walk-in bumping the ETA back up never re-sends.** The one-shot is
per ticket, not per threshold crossing.

---

## 4. Category-driven behaviour

`config/constants.ts` carries two sets that change validation and UI:

| Set | Members | Effect |
|---|---|---|
| `OPTIONAL_SERVICES_STAFF_CATEGORIES` | `Hospital`, `Restaurant` | May have **zero** services and **zero** staff. Drives the flat `Waiting` group in `buildSeatGroups`. |
| `VISITOR_TYPE_CATEGORIES` | `Hospital` | Requires identifying the visitor as `mr` \| `patient` (`queue_entry.visitor_type`, `appointment.visitor_type`). |

`visitor_type` is **display-only** and never enters wait-time math.

---

## 5. Permissions

`backend/src/domain/permissions.ts` is the single source of truth, imported by both the route
guards and `/auth/me`, so what the UI hides and what the API refuses come from one place. **The
API is the boundary; the UI only decides what to draw.**

### Modules

`dashboard`, `queue`, `appointments`, `calendar`, `customers`, `services`, `staff`, `hours`,
`notifications`, `billing`, `profile`, `team`.

The catalogue lives **in code, not the database** — adding a screen is a deploy, not a migration.

**`GRANTABLE_MODULES` excludes `team` on purpose.** "Can create logins" is the one permission that
would let a staff account grant itself all the others, so it stays tied to the owner roles rather
than being a checkbox. `grantableSubset()` strips it before the editor sees a draft — handing the
editor an unfiltered map made it seed a draft containing `team` and then get that draft rejected
on save.

### Access levels

`none` < `view` < `manage`, compared by rank via `atLeast(have, need)`.

### Role defaults

| Role | Default |
|---|---|
| `owner` | `manage` on everything (super owner; exactly one per business, created by the admin panel at provisioning) |
| `co_owner` | `manage` on everything, but cannot touch the super owner |
| `manager` | **legacy, no longer assigned** — `manage` everything except `billing: view`, `team: view` |
| `staff` | `queue: manage`; `dashboard`/`appointments`/`calendar`/`notifications`: `view`; **everything else `none`** |

`staff` is deliberately narrow: it gets its own chair's queue and nothing that would expose the
shop's customer list or money. An owner grants those one at a time, and even when granted the read
is still scoped to that staff member.

### Resolution

`effectiveAccess(role, overrides)` = `ROLE_DEFAULTS[role]` merged with **sparse** overrides from
`user_permission` (a row exists only where an owner deliberately changed something).

**Owner roles ignore overrides entirely** (`FIXED_ROLES = ['owner', 'co_owner']`) — an override row
against an owner is ignored rather than rejected, so a stale row can never quietly lock the account
holder out of their own business.

### Enforcement

| Guard | What it does |
|---|---|
| `requirePermission(module, 'view'\|'manage')` | the module boundary |
| `requireOwnRow('queue_entry'\|'appointment')` | row-level — a staff login may act only on its own chair's rows |
| `scopeStaffId(principal)` | narrows reads; **a staff login with no chair linked sees nothing**, not everything (fails safe) |
| `requireSuperOwner` | the handful of actions co-owners must not reach |

---

## 6. Plan gating

Free plan truncates the customer list to `FREE_PLAN_CUSTOMER_LIMIT` (default **2**) and returns
`meta.lockedCount`.

Two things to preserve:

- **The server truncates.** Client-side blur is cosmetic only.
- Reads use **`getLivePlan()` (a DB lookup)** rather than the `plan` claim in the token, so an
  upgrade applies immediately instead of waiting up to 15 minutes for a token refresh.

`upgrade()` flips the plan directly while `PAYMENTS_ENABLED=false`.

---

## 7. Theme engine

`frontend/src/theme/engine/` — pure TypeScript, no React, no DOM, no `node:` imports (which is
what lets it be mirrored into an Expo app). It compiles `business.theme` jsonb into a complete,
contrast-checked set of CSS custom properties.

- 6 presets × light/dark, OKLCH colour ramps, WCAG contrast checks.
- Axes: colour, radius, shadow, density, animation, hero, typography.
- Owners edit it in the Appearance panel against a live `?preview=1` iframe of the microsite,
  gated by `NEXT_PUBLIC_ADMIN_ORIGIN` / `NEXT_PUBLIC_OWNER_ORIGIN`. If either origin is wrong the
  preview silently reports "isn't accepting live theme updates".
- Self-check: `npm run test:theme` (framework-free, run through the backend's `tsx`).

**The parity invariant:** no existing store's microsite may move a pixel because of theme work.
Adding an axis means updating **every** file that hand-lists axes — `npm run check:axes` is the
guard, because an axis missing from an Appearance panel's `key()` dirty-check is silently
**unsaveable** with no error anywhere.

---

## 8. Integration seams and their current state

Every external provider is an interface plus a flag-gated implementation that logs and returns
`{ id: null }` when disabled. **Wire a provider behind the existing interface** — never call a
vendor SDK from a service.

| Concern | Provider | State |
|---|---|---|
| Object storage | Railway Buckets (S3-compatible), AWS SDK v3 | **live** |
| WhatsApp / alerts | Twilio SMS as a temporary stand-in | wired, behind `WHATSAPP_ENABLED` |
| SMS | MSG91 / Twilio | deferred no-op (`SMS_ENABLED=false`) |
| Email | SES / Postmark | deferred no-op (`EMAIL_ENABLED=false`) |
| Payments | Razorpay / Stripe | deferred — `upgrade()` flips the plan directly |
| OTP | — | **deferred stub** (`OTP_ENABLED=false`) — see the warning in `api.md` |
