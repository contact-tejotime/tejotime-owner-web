# Recurring appointments

**Status:** Phase 1 and Phase 2 built 2026-10-03 on `feat-jay` (not yet deployed). Phase 3 is still
plan; owner-created bookings/series were taken out of Phase 2 by the product owner. Written the same
day from the client's requirement and a review of the appointment code; §0 and §0b say what was
built and where it differs from the plan below.
**Readers:** sections 1–4 describe the product (for the client and product owner); sections 5–15
are the technical design (for the developers who build it).

## 0. What Phase 1 built

**Open questions settled** (the §14 recommendations, plus one the doc left to the client): weekly
is offered; custom 7–90 days; "after X visits" defaults to 6, max 26, and a skipped date counts;
"until" at most a year out; the series starts at booking; Pause keeps already-booked visits;
2 owner-marked no-shows in a row pause; the per-store switch defaults to **on**; recurring visits
count as online bookings on their own day. **Free for every plan**, and Regulars lives under
**Appointments** (not Customers), so the free plan's 2-customer cut never touches it.

| Area | Where |
|---|---|
| Schema | `backend/db/migrations/0036_recurring_appointments.sql` — `appointment_series`, `appointment_series_service`, `appointment_series_issue`, four `appointment` columns, `business.recurring_enabled` |
| Date rules (pure) | `backend/src/lib/recurrence.ts` |
| Shared slot loader | `backend/src/modules/appointments/booking.repo.ts` (moved out of `public.service.ts`, now used by both) |
| Series logic + job | `backend/src/modules/appointments/series.service.ts`; scheduled in `jobs/scheduler.ts` (hourly at :07, and once at startup) |
| Owner API | `appointments.routes.ts` — `/appointments/series…`, `/appointments/:id/skip` |
| Public API | `public.routes.ts` — `repeat` on booking, `/series-preview`, `/public/series…` |
| Check-in stylist fix | `appointments.service.ts` `checkIn` |
| Tests | `tests/unit/recurrence.test.ts`, `tests/unit/public-series.test.ts`, `scripts/smoke-recurring.mjs`, `scripts/smoke-recurring-sweep.ts` |

**Changes from the plan below:**

1. **Manage link: a random stored token, not an HMAC key (§5).** An HMAC key would need the
   36-character series id in the link as well, and the confirmation SMS is length-bound. The
   token is 16 url-safe characters (96 random bits), unique-indexed, and travels in the
   `X-Series-Token` header. The link is `www.tejotime.com/{store phone}/v#{token}`.
2. **The confirmation SMS for a series visit is two segments.** Today's body is ~155 characters
   with the plain store link; the manage link adds ~20, which crosses 160. One-off bookings are
   unchanged. Worth knowing for Twilio cost.
3. **At booking, only the first visit is texted.** The other visits booked in the same moment are
   on the customer's screen; texting each would be noise. Visits the job books later each get the
   confirmation, as planned.
4. **A closed weekday writes no row (§9 said "write a skipped visit row").** A cancelled row would
   show up in the owner's day list as a phantom cancellation. The cursor (`generated_through`) and
   the store lock already stop the job retrying that date.
5. **Public endpoints are keyed by the token, not the series id** — `GET /public/series`,
   `POST /public/series/visits/:appointmentId/skip`, `POST /public/series/cancel` (§8).
6. **Resume can change the stylist** (`{ staffId }`, or `"any"`). Without it, a series paused
   because its stylist left could only be cancelled in Phase 1.
7. **A customer cancelling one series visit through the existing "cancel booking" flow is
   recorded as a skip** (`cancel_reason = 'skipped'`), so it reads the same as Skip.

A customer books once, and the visit repeats on a fixed rhythm (every 2 weeks, every 18 days, …)
until an end they choose. The system does **not** create every future visit up front. It saves the
repeat rule, keeps only the next one or two visits on the calendar, and a background job books each
next visit about three weeks ahead — early enough that no other customer can take that slot first.

## 0b. What Phase 2 built (2026-10-03)

**Scope (product owner):** reschedule one visit, change all future visits, "Book another time" on
Needs attention, and the Phase 1 leftovers (open the series sheet from a visit row, a repeat marker on
the calendar, store-timezone times in the app). **Not built:** owners creating new bookings or
series (no "New appointment" screen), Phase 3.

**Decisions:**
- **Rescheduling one visit:**
  - **Customers** reschedule their **repeating** visits only, from the manage link, within today … today+20. That is the job's horizon, where every series date is already booked, so nothing can collide.
  - **Owners** reschedule **any** booking, one-off or series, within today … today+60.
- **"Change all future visits":** changes the time and/or the stylist, never the interval (client spec), and both customers and owners can use it.
  - A visit the customer **already moved by hand keeps its time**.
  - A date where the new time is **taken by someone else cannot use it**: before confirming, the person picks another free time for that date, or skips it.
- **No SMS** for any of it. A moved visit's 15-minute reminder follows the new time.

| Area | Where |
|---|---|
| Schema | `backend/db/migrations/0037_recurring_edit.sql`: `appointment.rescheduled_at`, `appointment_series.anchor_index`; `admin_appointment_stats` ignores superseded rows |
| Date rules (pure) | `lib/recurrence.ts`: `startIndex`, `occurrenceIndex`, `isRuleDate`, `firstDateAfter`, `ruleFromColumns`, `projectedBookings` |
| Slot loader | `booking.repo.ts` `slotInputFor`: `excludeIds`, `project` |
| Moving a booking | new `appointments/reschedule.service.ts` |
| Change / Book another time / customer edits | `series.service.ts` (Phase 2 section) |
| Request shapes | new `appointments/series.schemas.ts` (shared by both routers) |
| Tests | `tests/unit/series-edit.test.ts`, more in `recurrence.test.ts`; `scripts/smoke-recurring-edit.mjs`; Phase 2 section of `scripts/smoke-recurring-sweep.ts` |

**How it works:**
- **Moving a visit** updates it in place: start, end, stylist, `rescheduled_at`.
  - `occurrence_date` stays, so the job never re-books that date.
  - The new time passes the same `isBookable` rule as public booking. The visit does not block itself (`excludeIds`).
  - A regular's **not-yet-booked** series dates count as taken (`project`). That is what stops an owner moving something onto a date a regular will get next month.
- **A change** keeps the interval and starts on one of the old rule's dates, so from that date on the new rule has exactly the old dates. Every write is one transaction under the store's `appt:` lock:
  1. supersede the booked visits from that date on (`cancel_reason='superseded'`; visits moved by hand are left alone);
  2. re-anchor the rule (`version+1`, `anchor_date`, `anchor_index += k`, new time/stylist);
  3. write each conflict's resolution — a moved visit, or a skipped row;
  4. book the rest.
  - If anything no longer fits, nothing is written and the answer is **409 `CHANGE_CONFLICTS`**, naming the dates.
- **`anchor_index`** counts the rule dates before the re-anchored first date, so "after 6 visits" still ends after the original sixth.
- **The job never books a date that already has a live row of the series**, in any version. That keeps skips and moved visits across changes.
- **Replaced visits are hidden** from every list (owner day list, series detail, manage page, admin figures). Nobody cancelled them.
- **A change may only start** from today up to the first not-yet-booked date (`changeFromDates`). Starting further out would leave the dates in between booked by neither rule.

**API added:**
- **Owner:**
  - `GET /appointments/:id/slots`, `POST /appointments/:id/reschedule`
  - `GET /appointments/series/:id/slots`, `POST /appointments/series/:id/preview-change`, `PATCH /appointments/series/:id`
  - `POST /appointments/series/issues/:issueId/book`
- **Customer** (`X-Series-Token`):
  - `GET /public/series/slots`, `POST /public/series/visits/:id/reschedule`
  - `POST /public/series/preview-change`, `POST /public/series/change`
- **Payloads:**
  - `GET /public/series` gains `staff`, `staffId`, `staffLocked`, `today`/`lastDay`, `changeFromDates`, and per-visit `canReschedule`/`moved`.
  - The owner series detail gains `changeFromDates`/`today`; the appointment DTO gains `rescheduledAt`.
  - `/auth/me` gains `business.timezone`, for the app's store-clock times.

**Changes from the Phase 2 plan in §13:**
- "Reschedule one visit" and "change all future" were planned as `POST /appointments/:id/reschedule` and `PATCH /appointments/series/:id`, and built as planned. They were joined by preview and slots endpoints, so clients never compute a store-local day or instant themselves.
- The conflict rule became "pick another time or skip", not "keep the old visit", by client decision.

---

## 1. What the customer sees

### 1.1 Booking

The booking flow is unchanged up to picking a time. Just before **Confirm**, one new section
appears:

```
Repeat this booking?
 (•) Just this once
 ( ) Every week    ( ) Every 2 weeks    ( ) Every 3 weeks    ( ) Every 4 weeks
 ( ) Custom: every [18] days

Stop repeating
 (•) After [6] visits     ( ) On [date]     ( ) Never (until I cancel)

Your visits: Sat 10 Oct · Sat 24 Oct · Sat 7 Nov · Sat 21 Nov · …
Same service, stylist and time. If your usual time isn't free, the salon will contact you.
```

| Rule | Why |
|---|---|
| **"Just this once" is pre-selected.** | Nobody signs up for a series by accident. |
| **Every week** is offered (open decision, §14). | Clinic and physio regulars often come weekly. |
| **Custom** is 7–90 days. If it is not a multiple of 7, show "Every 18 days falls on a different weekday each time." | Customers otherwise expect "every 18 days" to stay on a Saturday. |
| **After X visits:** default 6, maximum 26. **On a date:** up to one year ahead. **Never:** allowed. | Limits keep abandoned series from holding prime slots for years. |
| The **preview** lists the next dates. A date on a weekday the shop is closed is shown as "Shop closed — skipped". A date already taken (only possible for weekly or custom 7–13 days, §3.3) is shown as "Not free — pick another time or skip". | The customer sees exactly what they are agreeing to before confirming. |
| **Every chosen service** repeats, not only the first. | Multi-service visits (migration 0025) must stay whole. |
| **"Any stylist" repeats as any stylist.** A named stylist is locked in. | Same promise the booking already makes. |
| The **SMS checkbox and its wording do not change.** | That wording is part of the Twilio A2P registration (§4). |

### 1.2 After booking

The success screen says "You're booked! Repeats every 2 weeks." and lists the visits already
booked. It ends with "To skip, move or cancel a visit, tap My Appointments on this page and enter
your number."

**Changed 2026-10-05 (client):** the screen used to offer "Save your link to skip or cancel visits"
with a Copy button. Customers didn't keep the link, so it was removed in favour of My Appointments
([customer-my-appointments.md](customer-my-appointments.md)). The manage link still arrives in the
confirmation SMS if the customer ticked the SMS box (§5). The browser doesn't keep the token any
more: My Appointments starts from the phone number on every device, and the lookup returns it.

### 1.3 Managing the series

From that link the customer can:

| Action | Effect | Phase |
|---|---|---|
| **Skip one visit** | That visit is cancelled. The rest of the series is untouched. | 1 |
| **Cancel the series** | Every upcoming visit is cancelled and no more are created. | 1 |
| **Reschedule one visit** | Only that visit moves. Future visits keep the usual time. | 2 |
| **Change all future visits** | New time and/or stylist from a chosen date onward. Visits already booked after that date are re-booked on the new rule. | 2 |

Without the link (new phone, cleared browser), the customer taps **"My appointments"** on the store
page and types their phone number. That opens the same manage view: the lookup returns the series'
manage token. This is a client decision of 2026-10-05; see
[customer-my-appointments.md](customer-my-appointments.md). Before that, the lookup only showed the
visits, and the customer had to call the salon.

---

## 2. What the salon sees

All of this ships on **owner web and the mobile app (iOS and Android) together** (CLAUDE.md §11.1).

- **Repeat icon** on every series visit — Appointments list, Calendar month view and the day sheet.
  Use each app's icon set, not the 🔁 emoji (emoji render differently on iOS, Android and web).
- **Regulars** — everyone with an active or paused series: name, rhythm ("Every 2 weeks · Sat
  10:00 AM · Lisa"), next visit, status. Placement is an open decision (§14) because of free-plan
  gating on Customers.
- **Series sheet** (tap a regular or a repeat visit): **Pause / Resume**, **Cancel series**, **Skip
  this visit**, and **Change future visits** (phase 2).
- **Needs attention** — visits the job could not book (§3.4), with the reason and a **Call** button.
  The owner books another time or skips that visit.
- **Phase 2:** the owner can create a repeating booking for regulars who phone or WhatsApp. This
  needs an owner "New appointment" screen, which does not exist today on either surface.

---

## 3. How it works

### 3.1 Store the rule, not 50 bookings

A **series** stores the rule: services, stylist (or any), store-local start time, first date,
every N days, and the end. Each actual visit is an **ordinary appointment row** linked to the
series. Everything that already works per appointment — calendar, check-in, the 15-minute reminder,
slot capacity, customer self-service — keeps working unchanged.

### 3.2 Rolling creation

A background job keeps each active series booked **up to 20 days ahead**, and no further. For an
every-2-weeks customer that means one or two upcoming visits on the calendar at any time.

### 3.3 Why nobody else can take the slot

Public booking — the store page and the store chat — only offers **today through today+13**
(`BOOKING_WINDOW_DAYS = 14`; `backend/src/lib/booking-slots.ts`: "14 → today … today+13"). A date
becomes visible to the public 13 days before it.

The job creates a visit once its date is **within today+20**. So every series visit exists **7 days
before** any other customer can even see that date.

Example — today is Sat 3 Oct 2026. The customer books Sat 10 Oct, 10:00 AM with Lisa, every 2
weeks, Never:

| Visit | Created by the job on | Other customers can first see that date on | Margin |
|---|---|---|---|
| Sat 10 Oct | at booking | — (the customer's own booking) | — |
| Sat 24 Oct | Sun 4 Oct | Sun 11 Oct | 7 days |
| Sat 7 Nov | Sun 18 Oct | Sun 25 Oct | 7 days |
| Sat 21 Nov | Sun 1 Nov | Sun 8 Nov | 7 days |
| … until cancelled | | | |

Rules that keep this guarantee true:

1. **The horizon is derived from the window, never hard-coded:** horizon = `BOOKING_WINDOW_DAYS + 6`
   days inclusive (today+20 today). If the window is ever raised to 30 days, the horizon moves with
   it; a fixed 20 would silently stop protecting slots.
2. **The job runs every hour and once at startup.** It is idempotent, so extra runs are harmless, and
   a run missed during a deploy is caught up by the next one. The guarantee only breaks after about
   a week with no runs at all.
3. **At booking, every visit already inside the horizon is created immediately**, in the same
   transaction as the first visit — not left for the next job run.
4. **The job and public booking take the same per-store lock** that `bookSlot` already uses
   (`pg_advisory_xact_lock(hashtext('appt:' || business_id))`), so they can never both claim a time.

Two known gaps:

- **Every week, or custom 7–13 days.** The second visit can already be inside the public window when
  the customer books, and may already be taken. For every 2 weeks or longer this cannot happen (the
  second visit is at least 14 days out). The preview (§1.1) shows the clash before the customer
  confirms.
- **Owner bookings.** `POST /appointments` has no booking window and **no slot check at all** today.
  No screen calls it yet, so nothing is at risk now. When the owner "New appointment" screen is built
  (phase 2), it must run the slot rules and warn when a time clashes with a regular's series date
  that the job has not created yet.

### 3.4 When the job cannot book a visit

The job checks each date with the **same rule public booking uses** (`isBookable` in
`booking-slots.ts`), except the 14-day limit. `computeSlots` already takes `windowDays` as an input,
so the series path passes the horizon instead of 14 and every other rule stays shared.

| Cause | What happens |
|---|---|
| Shop closed that weekday | Visit is **auto-skipped** (the customer saw it in the preview and on the manage page). |
| Outside opening hours (hours changed, or the services got longer) | **Needs attention** |
| Stylist deactivated or deleted | **Needs attention**, and the series **pauses** until the owner picks another stylist. |
| Time already taken (an owner booking) | **Needs attention** |
| A chosen service was deleted | **Needs attention** |

The series carries on with the next date. **No SMS is sent** (§4), so the owner phones the customer.

> **Holidays and staff leave:** the store has **no holiday calendar and no staff-leave feature**
> today (`business_hour` is per weekday only). In v1 the owner handles a holiday or leave by
> skipping that visit. A later phase can add closure dates and leave so the job flags them itself.

### 3.5 Lifecycle

| Action | Who | Visits already booked | Future creation |
|---|---|---|---|
| Skip one | customer, owner | That one is cancelled and marked skipped | Unchanged — a skipped date is **never** re-created |
| Reschedule one (P2) | customer, owner | That one moves | Unchanged |
| Change all future (P2) | customer, owner | Ones after the chosen date are replaced | New rule from that date |
| Pause | owner | Kept (the owner can cancel any of them) | Stops |
| Resume | owner | — | Restarts from the next date; dates already inside the public window are slot-checked and may need attention |
| Cancel series | customer, owner | All upcoming are cancelled | Stops for good |
| End reached | — | — | Stops; series becomes `ended` |
| 2 owner-marked no-shows in a row | — | Kept | Series pauses |

---

## 4. SMS

**Decided:** only the three texts that are already registered with Twilio. **Nothing** is sent for a
cancellation, skip, pause, reschedule or "couldn't book". No re-registration is needed.

| Event | SMS |
|---|---|
| Customer books (first visit) | ✅ Booking confirmation (as today) |
| Job creates the next visit, about 3 weeks ahead | ✅ The same confirmation text, with the new date and time |
| 15 minutes before each visit | ✅ Reminder (as today) |
| After checkout | ✅ Review request (as today) |
| Cancel, skip, pause, reschedule, couldn't book | ❌ Nothing |

The per-visit confirmation matters: a 15-minute reminder is far too late as the only notice for
someone on an 18-day cycle. It still fits the consent wording ("up to 3 messages per visit").

Consequences to accept:

- If the job cannot book a visit, **the customer is not told**. It goes on the owner's Needs
  attention list, and the owner calls.
- When the owner cancels a visit or a series, the customer is not told either. Owner-side cancels
  send no SMS today, so this is consistent.

Two implementation notes:

- The series stores the customer's `sms_opt_in` and `review_sms_opt_in`, and **copies both onto
  every visit it creates**. The reminder sweep and the review request read them from the visit
  (`appointmentReminderSweep`, and check-in copies them to the queue entry).
- The confirmation's "Manage your booking" link today opens **only the store page**
  (`storeUrl()` in `sms-dispatch.ts`), so it cannot skip or cancel anything. For series visits it
  should open the manage page (§5). The link stays on the same domain with a longer path; confirm
  with whoever owns the Twilio campaign that this is acceptable.

---

## 5. Customer access without a login

There is no customer login and no OTP. Today, self-service on a single booking depends on an
`appointmentKey` held only by the browser that booked. A "Never" series lives for months, so it needs
something sturdier.

**Proposal for v1** (built with a random stored token instead of an HMAC key — see §0, change 1):

- A **series key**, built exactly like `appointmentKey` — the same HMAC (`TICKET_URL_HMAC_SECRET`)
  over a **domain-separated** input, `series:{id}`, so it can never verify as a ticket or
  appointment key.
- The booking response returns it. The browser stores it, and the **confirmation SMS** carries it
  for series visits. (The success screen offered it as a link until 2026-10-05; see §1.2.)
- The key goes in the URL **fragment** (`…#k=…`), so it never reaches server or proxy logs; the page
  reads it and sends it as a header, the way `X-Ticket-Key` works today.
- A wrong or missing key returns 404, never 403 — the same rule as `appointmentForKey`, so a guessed
  id cannot be confirmed to exist.
- ~~A phone lookup still shows visits but never returns the key, so it cannot change anything.~~
  **Reversed 2026-10-05 (client decision):** the "My appointments" phone lookup returns the manage
  token of the phone's active or paused series, so the phone number alone manages it.
  See [customer-my-appointments.md](customer-my-appointments.md).

**Later (phase 3):** phone OTP. It would let any device manage a series, and also fix the existing
single-booking gap.

---

## 6. Abuse guards

Without OTP, anyone can create a "Never" series with a fake number. Guards:

1. **One active or paused series per phone number per store.** A second attempt gets a 409 that says
   "You already have a repeating booking here — manage it from your link or call the salon."
2. **Auto-pause after 2 no-shows in a row.** Only owner-marked no-shows count. Nothing marks
   no-shows automatically, and counting "not checked in" would pause real regulars whose visits the
   owner simply didn't check in.
3. **Limits:** at most 26 visits, end date at most one year away, interval 7–90 days.
4. **Per-store switch:** "Let customers book repeating appointments" (default is an open decision,
   §14).
5. The owner can cancel any series at any time.

---

## 7. Data model (proposed)

One migration, `0036_recurring_appointments.sql`, idempotent like every other migration.

**`appointment_series`**

| Column | Notes |
|---|---|
| `id`, `business_id` | `business_id` on delete cascade, like every tenant table |
| `customer_id`, `customer_name`, `customer_phone` | Same shape as `appointment` |
| `staff_id` | Nullable = any stylist. On delete set null → the job flags it (§3.4) |
| `visitor_type` | Hospital category; copied to each visit |
| `start_time` (`time`) | **Store-local** time of day, e.g. 10:00. Never a UTC instant — US stores have daylight saving, and 10:00 AM must stay 10:00 AM across it. |
| `anchor_date` (`date`) | Store-local date of the first visit under the current rule |
| `interval_days` | Check 7–90 |
| `end_type`, `end_count`, `end_date` | `never` / `count` / `until` |
| `status` | `active` / `paused` / `ended` / `cancelled` (text + check, not a new enum) |
| `version` | Bumped by "change all future visits" (see the index below) |
| `generated_through` (`date`) | The last rule date the job has handled — created, skipped or flagged |
| `sms_opt_in`, `review_sms_opt_in` | Copied onto every visit |
| `source` | Existing `appointment_source` enum: `online` or `owner` |
| `created_at`, `updated_at`, `paused_at`, `cancelled_at` | |

**`appointment_series_service`** — `(series_id, service_id, position)`. Only the ids are stored.
Names, durations and prices are copied into `appointment_service` when **each visit** is created,
the way a normal booking copies them, so a price change reaches visits created after it.

**`appointment`** — new columns:

| Column | Notes |
|---|---|
| `series_id` | FK to `appointment_series`, on delete set null |
| `series_version` | The rule version that created it |
| `occurrence_date` (`date`) | The rule date. It **does not change** when one visit is rescheduled, so the job still knows that date was handled. |
| `cancel_reason` | `skipped` / `cancelled` / `superseded`, so reports can tell a skip from a cancellation |

Unique index on `(series_id, series_version, occurrence_date) where series_id is not null`. This one
index does two jobs that pull in opposite directions:

- A **skipped** visit is still a row for that date and version, so the job can never re-create it,
  even if it runs twice or after a restart.
- **"Change all future visits"** bumps the version, so the same date **can** be booked again under
  the new rule.

**`appointment_series_issue`** — the Needs attention list: `series_id`, `series_version`,
`occurrence_date`, `reason`, `created_at`, `resolved_at`, `resolution` (`booked` / `skipped`).
Unique on `(series_id, series_version, occurrence_date)`.

Also: a partial unique index for guard 1 (one active or paused series per `(business_id,
customer_phone)`), and indexes on `appointment(series_id)` and `appointment_series(business_id,
status)`.

**No enum changes.** A series visit is recognised by `series_id`, not by a new `appointment_source`
value. That avoids `ALTER TYPE … ADD VALUE` inside a migration transaction, where the new value
cannot be used in the same transaction.

The date math — "every Nth day from the anchor, until the end, as store-local instants" — goes in a
**pure** `backend/src/lib/recurrence.ts` (no DB, no env), like `booking-slots.ts`, so it is
unit-testable on its own.

---

## 8. API (proposed)

### Public (no auth)

| Endpoint | Purpose | Limiter |
|---|---|---|
| `POST /public/businesses/:slug/appointments` | Existing booking, plus an optional `repeat: { everyDays, ends }`. The response adds `series: { seriesId, seriesKey, visits, skipped }`. | `publicWrite` |
| `POST /public/businesses/:slug/series-preview` | Dates and availability for the preview, before confirming. Read-only. | `publicRead` |
| `GET /public/series/:seriesId` | Series and upcoming visits. Needs the series key. | `publicRead` |
| `POST /public/series/:seriesId/visits/:appointmentId/skip` | Skip one visit. | `publicWrite` |
| `POST /public/series/:seriesId/cancel` | Cancel the series. | `publicWrite` |
| `POST /public/series/:seriesId/visits/:appointmentId/reschedule` (P2) | Move one visit; same slot rules. | `publicWrite` |
| `POST /public/series/:seriesId/change` (P2) | Change all future visits from a date. | `publicWrite` |

### Owner (`requirePermission('appointments', …)`)

| Endpoint | Purpose |
|---|---|
| `GET /appointments/series` | Regulars list (`?status=`) |
| `GET /appointments/series/:id` | One series with its visits |
| `POST /appointments/series/:id/pause` · `/resume` · `/cancel` | Series controls |
| `GET /appointments/series/issues` · `POST …/issues/:id/resolve` | Needs attention |
| `POST /appointments/:id/skip` | Skip one series visit |
| `POST /appointments/:id/reschedule` (P2) | Generic — for **every** appointment, not only series |
| `PATCH /appointments/series/:id` (P2) | Change all future visits |
| `POST /appointments` with `repeat` (P2) | Owner-created series; also gains the slot check and multi-service it lacks today |

- **Route-order trap:** `/appointments/series` must be registered **before** `/appointments/:id`.
  Otherwise `:id` matches the word "series" and its UUID validation returns a 400.
- **Staff logins:** extend `requireOwnRow` so a staff login can act only on series for its own chair,
  and `scopeStaffId` narrows the Regulars list the same way.
- **owner-web BFF:** `app/api/appointments/[id]/[action]/route.ts` has an allow-list
  (`check-in`, `cancel`, `no-show`); add `skip` and `reschedule` there, and add route handlers for
  the series endpoints. DTOs in `owner-web/src/lib/server-api.ts` and `app/src/lib/api.ts` are
  hand-mirrored — change all three together.
- **Realtime:** reuse `appointment:created` and `appointment:updated` for visits (including
  job-created ones), and add `series:updated` for owner screens. Emit after commit, as everywhere.

---

## 9. The background job

`recurringSweep(now = new Date())` in `jobs/scheduler.ts`. It takes `now` as a parameter, the same
way `appointmentReminderSweep(now)` does, so tests can drive it through months of dates.

- **Every hour, plus once at startup.**
- For each store with active series, under the store's `appt:` advisory lock:
  - For each rule date after `generated_through` and within the horizon (today + `BOOKING_WINDOW_DAYS`
    + 6, store timezone), until the series' end:
    - Closed weekday → write a skipped visit row (so it is never retried) and move on.
    - Bookable → insert the appointment and its `appointment_service` rows with the series' consent
      flags, then (after commit) send the confirmation if opted in and emit `appointment:created`.
    - Otherwise → insert an `appointment_series_issue` row; pause the series if the stylist is gone.
  - Advance `generated_through`. Mark the series `ended` when its end is reached.
- Inserts use `on conflict do nothing` against the unique indexes, so a double run creates nothing
  twice.
- Dates already in the past (for example after a long outage) are not booked; the job just moves
  past them.
- The backend runs as **one replica** (CLAUDE.md §9), so the job runs once. The unique indexes make
  it safe even if that ever changes.

---

## 10. Changes to existing behaviour

1. **Check-in honours the booked stylist.** `checkIn` in `appointments.service.ts` currently passes
   `soonestSeat(...)` to `appointment_check_in`, ignoring `appointment.staff_id`. A regular who always
   sees Lisa would be put on whichever chair is lightest. Fix: pass the booked stylist when one is
   set and still active, otherwise the soonest seat. This is a TypeScript-only change (the SQL
   function already takes the seat as a parameter), and it improves **every** booking. Phase 1.
2. **Reschedule** does not exist anywhere today. Phase 2 builds it for all appointments, owner and
   customer.
3. **Owner "New appointment" screen** (phase 2), and `POST /appointments` gains slot rules and
   multi-service (`serviceIds[]`).
4. **Mobile app parity:** the app has only **Check in** for appointments; owner web also has Cancel
   and No-show. Series management needs both on mobile, so phase 1 adds them.
5. **Admin analytics** — "online bookings today" counts appointments with `source = 'online'` by
   **scheduled day**, so each recurring visit counts on its own day. That is probably right; confirm
   (§14).
6. **SMS** — the confirmation is now also sent by the job for each new series visit. Update
   `docs/sms-opt-in-a2p.md` when built.

---

## 11. What each surface needs

| Surface | Work |
|---|---|
| **Backend** | Migration 0036; `lib/recurrence.ts`; series service and routes; public booking + preview + self-service; `recurringSweep`; check-in stylist fix; series link in the confirmation SMS |
| **Customer site** (`frontend/`) | Repeat section and preview in the booking modal (`components/microsite/MicrositeClient.tsx`); success screen (its manage link was removed on 2026-10-05, see §1.2); a manage page; strings in `src/i18n/en.json`. The **store chat stays single-booking** in v1 — the guided flow is not the place for this. Its "My appointments" list shows series visits like any other. |
| **Owner web** (`owner-web/`) | Repeat icon in `AppointmentListItem`, `calendar/CalendarMonth.tsx`; Regulars list; series sheet; Needs attention; Skip action; BFF routes and DTOs; i18n |
| **Mobile app** (`app/`, iOS + Android) | Same as owner web in `(tabs)/appointments.tsx`, `(tabs)/calendar.tsx`, `(tabs)/customers.tsx`, `components/appointments/AppointmentListItem.tsx`, `components/feedback/DayAppointmentsSheet.tsx`; plus appointment Cancel / No-show (§10.4); `lib/api.ts` DTOs; i18n. Check on **both** platforms. |
| **Admin panel** | Nothing in v1. |

---

## 12. Tests (CLAUDE.md §12)

| Tier | What it proves |
|---|---|
| **Unit** (vitest, no DB) — `recurrence.test.ts` | Every-N-days dates; the three end types; store-local time held across a US daylight-saving change; horizon boundary (day 20 created, day 21 not); detecting the weekly-series clash; series key verifies and is **not** accepted as an appointment or ticket key. |
| **DB smoke** — `scripts/smoke-recurring-db.mjs` (migrated throwaway DB, always rolled back, like `smoke-seatless` / `smoke-commission-db`) | Drives `recurringSweep` with an injected clock across ~3 months: each visit created 20 days ahead; a second run creates nothing; a skipped date never comes back; a version bump re-books the same date; closed weekday → skipped; deactivated stylist → issue + pause; ends after X and on the end date. |
| **HTTP smoke** — `scripts/smoke-recurring.mjs` (running API + seeded throwaway DB, fresh API because of `publicWrite`'s 20/hour) | Book with repeat → series and visits; another customer gets 409 on a weekly series' second visit; skip/cancel need the key (wrong key → 404); second series for the same phone → 409; owner pause/resume/cancel; a staff login cannot touch another chair's series; check-in puts the customer on the booked stylist. |

> `backend/.env` points at the **live preprod database**. Never run the seed or any smoke script
> against it — only against a throwaway database.

---

## 13. Phases

**Phase 1 — core**
- Series table, rolling job, SMS reuse, series key and manage link.
- Customer: repeat option with preview, success screen, skip one visit, cancel series.
- Owner (web + iOS + Android): repeat icon, Regulars, series sheet (pause / resume / cancel / skip),
  Needs attention.
- Check-in honours the booked stylist; appointment Cancel / No-show on mobile.
- Unit, DB smoke and HTTP smoke tests; docs updated.

**Phase 2 — editing**
- Reschedule one visit (generic, for all appointments) and change all future visits — customer and
  owner.
- Owner "New appointment" screen with a repeat option; `POST /appointments` slot rules.

**Phase 3 — optional**
- Store closure dates and staff leave, read by the job.
- Customer phone OTP.

---

## 14. Decisions

### Made

- Frequencies: every 2, 3 and 4 weeks, plus custom days.
- Ends: never, after X visits, on a date.
- Customer controls: skip one, reschedule one, change all future, cancel series.
- Owner: repeat badge, Regulars list, pause / edit / cancel series.
- Rolling creation: save the rule; only the next one or two visits exist; a job books ahead.
- SMS: only the three registered texts; nothing for cancel, skip, pause, reschedule or couldn't book.
- Slot protection: create each visit before its date opens to the public (§3.3).

### Open — recommendation in bold

| # | Question | Recommendation |
|---|---|---|
| 1 | How does a customer manage the series later, without a login? | **Series-key link on screen and in the SMS now; phone OTP later (§5).** |
| 2 | Offer "Every week"? | **Yes** — clinics and physio need it; the preview handles its clash case. |
| 3 | Custom interval limits? | **7–90 days.** |
| 4 | End limits and defaults? Do skipped visits count toward "after X visits"? | **Default "after 6 visits", max 26; end date ≤ 1 year. Skipped dates count** — simpler, and the preview shows the exact last date. |
| 5 | Free for every store, or premium only? | Client to decide. **If Regulars sits on the Customers screen, the free plan's 2-customer cut applies to it** — put it under Appointments, or make the feature premium. |
| 6 | Per-store switch default? | **On**, with the owner able to turn it off. |
| 7 | Does Pause keep the visits already booked? | **Keep them;** the owner can cancel any individually. |
| 8 | Auto-pause after no-shows? | **After 2 owner-marked no-shows in a row.** |
| 9 | Should recurring visits count as "online bookings" in admin analytics on their day? | **Yes** (no change). |
| 10 | Does the series start at booking, or only after the first visit is checked in? | **At booking**, matching "the customer books once", with the guards in §6. Starting after check-in blocks fake numbers better, but loses the series whenever an owner forgets to check someone in. |

---

## 15. Docs to update when it is built

- `CLAUDE.md` §4 (public surface), §5 (tables), §7 (business logic), §12.1 (new smoke scripts).
- `.claude/docs/database.md`, `api.md`, `business-logic.md`, `current-work.md`.
- `docs/sms-opt-in-a2p.md` — the job also sends the confirmation; the manage link.
- `docs/customer-booking-page-copy-2026-09-06.md` — the repeat section copy.
- `docs/owner-web-app-parity.md` — the new owner screens on both surfaces.
- This file: change **Status** from plan to built, and record what changed from the plan.

Done for Phase 1 (2026-10-03): this file (§0), `CLAUDE.md`, `.claude/docs/*`,
`docs/sms-opt-in-a2p.md`, `docs/owner-web-app-parity.md`.

## 16. Running the tests

```bash
cd backend
npx vitest run tests/unit/recurrence.test.ts tests/unit/public-series.test.ts   # no DB needed

# Real Postgres — a THROWAWAY database. backend/.env points at live preprod: never use it.
DATABASE_URL=<throwaway> npm run migrate
DATABASE_URL=<throwaway> npx tsx scripts/smoke-recurring-sweep.ts   # the job, driven through 2030
DATABASE_URL=<throwaway> npm run seed && DATABASE_URL=<throwaway> npm run dev   # then, in another shell:
node scripts/smoke-recurring.mjs   # HTTP: book, hold, token, owner controls, switch, check-in
node scripts/smoke-recurring-edit.mjs   # Phase 2 HTTP: move, change with a conflict, projection (fresh API)
```

`smoke-recurring-sweep.ts` refuses the database `backend/.env` points at and forces SMS off.
`smoke-recurring.mjs` spends 8 of `publicWrite`'s 20 writes per hour and `smoke-recurring-edit.mjs`
about 10; run each on a freshly started API if other smoke scripts ran first. The Phase 2 checks of
the job, Book another time and the two race checks are in `smoke-recurring-sweep.ts` (its own store).
