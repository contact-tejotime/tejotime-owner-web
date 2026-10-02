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

### Pricing modes, and when the amount stops being optional

A service is priced `fixed` (one amount), `range` (a floor and a ceiling) or `unset` ("no price":
it began as the legacy zero rows — see `database.md` — and is now a mode an owner or admin can
choose on purpose, because price is optional; the microsite shows no price for it). Money is
integer paise throughout: `price_paise` is the fixed amount *or* the range floor, `price_max_paise`
the ceiling, and an `unset` service is stored as `0` with no ceiling.

- **Fixed** — unchanged. Checkout pre-fills service + add-ons and the override is optional.
- **Range / unset** — `queue_checkout` **raises `TEJO:AMOUNT_REQUIRED` (422)** when
  `p_amount_paise` is null. Deriving would bank the band's *minimum*, which is the same
  under-reporting of `visit.amount_paise` that 0020 exists to prevent, arrived at by a different
  route. The refusal lives in the function rather than only in the UI, so a client that ignores
  the flag still cannot bank a figure nobody chose.
- **No service at all** (migration 0030) — an entry with no service **and no add-ons** is refused
  the same way. It used to derive to ₹0 and bank a free visit; with services optional it is the
  common case. `billingFor` reports it as `servicePriceType: 'unset'`.

`GET /queue/:id` carries the resolution for the checkout sheet: `servicePriceType`,
`serviceMaxAmount`, `amountRequired`, and a **null** `suggestedAmount` whenever `amountRequired`
is true — there is no honest figure to pre-fill, and pre-filling the floor is exactly the failure.
`domain/money.ts::servicePricing` is the one place that reads a row into that shape, so the owner
list, the public microsite and the checkout sheet cannot disagree about what a price means.

**`queue_no_show` deliberately does *not* auto-promote.** Marking someone absent should not start
the next customer's clock without the shop deciding to.

---

## 3. The ETA-15 alert

`lib/eta-notify.ts` + `queue.service.ts::processTicketBroadcasts`.

Fires **once per ticket**, for **online live-queue joins only** — not walk-ins — when
`0 < waitMinutes <= ETA_NOTIFY_MINUTES` (default 15) **and** the visit opted in
(`sms_opt_in = true`). Missing opt-in never texts.

> **Since 2026-09-28 this is a socket event only** (`ticket:eta_15` / `ticket:eta_2` /
> `ticket:ready`) — the waitlist SMS were replaced by the three appointment texts (booking
> confirmation, 15-minute reminder, post-checkout review request) in
> `modules/notifications/sms-dispatch.ts`. See [docs/sms-opt-in-a2p.md](../../docs/sms-opt-in-a2p.md).

Idempotency is a **conditional claim** on `notified_eta_15_at`: the update only matches rows where
the column is still null, so exactly one concurrent caller wins. `notified_turn_at` does the same
for "it's your turn".

Consequence worth knowing: **a walk-in bumping the ETA back up never re-sends.** The one-shot is
per ticket, not per threshold crossing.

---

## 4. Category-driven behaviour

`config/constants.ts` carries one set that changes validation and UI:

| Set | Members | Effect |
|---|---|---|
| `VISITOR_TYPE_CATEGORIES` | `Hospital` | Requires identifying the visitor as `mr` \| `patient` (`queue_entry.visitor_type`, `appointment.visitor_type`). |

`visitor_type` is **display-only** and never enters wait-time math.

There is no category rule for services or staff. `OPTIONAL_SERVICES_STAFF_CATEGORIES` (Hospital,
Restaurant) was removed: **every** store may have zero services and zero staff, so pictures,
stylists, services and prices are all optional. A store with no staff gets the flat `Waiting` group
in `buildSeatGroups` — one shared lane (`staff_id IS NULL`) where several people can be in service
at once, `SEAT_BUSY` does not apply, and checkout does not auto-promote (migration 0030). See
[docs/optional-store-data.md](../../docs/optional-store-data.md).

---

## 5. Permissions

`backend/src/domain/permissions.ts` is the single source of truth, imported by both the route
guards and `/auth/me`, so what the UI hides and what the API refuses come from one place. **The
API is the boundary; the UI only decides what to draw.**

### Modules

`dashboard`, `commission`, `queue`, `appointments`, `calendar`, `customers`, `services`, `staff`,
`hours`, `notifications`, `billing`, `profile`, `team`.

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
| `manager` | **legacy, no longer assigned** — `manage` everything except `billing: view`, `team: view`, `commission: view` |
| `staff` | `queue: manage`; `dashboard`/`appointments`/`calendar`/`notifications`/`commission`: `view` (commission = its own chair's earnings only); **everything else `none`** |

### Role-only modules

`team` and `commission` are in `MODULES` (so `/auth/me` reports them and the guards use them) but
**not** in `GRANTABLE_MODULES`: their level comes from `ROLE_DEFAULTS` alone. `effectiveAccess`
applies overrides only to grantable modules, so a stale or hand-written row for either is ignored.

`commission` was a grantable Hidden / View only row until 2026-10-02 (staff hidden by default,
capped at view by a `GRANT_CEILING`). It is now role-only: every staff login sees its own earnings
(`view`, scoped to its chair by `scopeStaffId`), owners `manage` (set rates), and no override can
hide it or raise it. The rate routes also check the owner **role**. `PUT /users/:id/permissions`
drops a `commission` key rather than 400-ing the whole save — app builds from the toggle era still
send it — and replaces only the modules in its payload, so a client older than a module cannot
wipe its grant.

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

## 5a. Staff commission

A dated percentage per stylist (`staff_commission_rate`, basis points), and every visit paid at the
rate of its own **store-local** day through the `visit_commission` view — computed when read,
nothing stamped on `visit`, `queue_checkout` untouched. "20% from 02/10, 30% from 16/10" pays
2–15 Oct at 20% and all of 16 Oct onwards at 30%, in every report, for ever: rates start today or
later and days that are over are locked (409 `COMMISSION_RATE_LOCKED`). Rounded per visit; totals
are the sum of the lines. "Today" comes only from the server. All plans. Full rules, API and screens:
[docs/staff-commission.md](../../docs/staff-commission.md).

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
| SMS / alerts | Twilio SMS | wired, behind `SMS_ENABLED`; A2P opt-in gate — see [docs/sms-opt-in-a2p.md](../../docs/sms-opt-in-a2p.md) |
| Email | SES / Postmark | deferred no-op (`EMAIL_ENABLED=false`) |
| Payments | Razorpay / Stripe | deferred — `upgrade()` flips the plan directly |
| OTP | — | **deferred stub** (`OTP_ENABLED=false`) — see the warning in `api.md` |
