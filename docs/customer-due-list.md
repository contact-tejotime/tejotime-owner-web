# "Due to come back" — the salon's call list

**Date:** 2026-10-28 · **Applies to:** `backend/`, `owner-web/`, `app/` (iOS and Android)

## Why

Salons want to phone a regular a day or two before they would normally come back, agree a day and
time on the call, and book it there and then — instead of hoping the customer remembers. TejoTime
already records every finished visit (`visit`: customer, day, services, stylist), so each regular's
rhythm can be worked out with no new data. The client's rule (2026-10-28): **don't demand an exact
gap** — "if the gap is 15 to 25 days, allow it".

## Who is due — the rules

All of it is the pure module `backend/src/lib/due-back.ts` (no DB, no env, no clock), pinned by
`backend/tests/unit/due-back.test.ts`. Every date is a **store-local calendar day**: a visit at
00:10 in Kolkata counts on that day, not the previous UTC one.

1. **Visit days.** A customer's visits reduce to distinct days — two services checked out separately
   on one day are one visit. A refunded card visit still counts (only its money was returned).
2. **Regular** = at least **3 visit days**. Only the most recent window is judged: the last
   **5 gaps** (6 days). One long gap a year ago doesn't rule out a loyal customer forever.
3. **Usual gap** = the **median** of those gaps, rounded to whole days (halves up). A median, not an
   average, so one holiday month can't drag it.
4. **Band** = usual ± **max(3 days, 25%)**, both edges inclusive:

   | Usual gap | Band |
   |---|---|
   | 7 | 4–10 |
   | 20 | **15–25** |
   | 42 | 32–52 |

5. **Regular rhythm**: every gap in the window is inside the band — except **one outlier is
   forgiven** once there are 3 or more gaps (someone who skipped a month once).
6. **At least 7 days.** Shorter rhythms (a restaurant's daily diner, a weekly clinic visit) are left
   out — the client's call, so the list never floods. Same floor as a repeating booking.

| Gaps | Usual | Band | Regular? |
|---|---|---|---|
| 18, 23, 20 | 20 | 15–25 | ✅ |
| 15, 25 | 20 | 15–25 | ✅ |
| 20, 21, 45 | 21 | 16–26 | ✅ (45 forgiven) |
| 10, 40, 22 | 22 | 17–27 | ❌ two outside |
| 14, 26 | 20 | 15–25 | ❌ two gaps, nothing forgiven |

### When they are listed

With last visit **1 Oct** and usual **20** (band 15–25):

| From | Status | Rule |
|---|---|---|
| 19 Oct | **Due soon** | expected (21 Oct) − 2 days — time for the call |
| 27 Oct | **Overdue** | after last visit + top of the band (26 Oct) |
| 11 Nov | **Not back for a while** | after last visit + 2 × usual (10 Nov) |
| 30 Mar | dropped | more than 180 days since the last visit |

The list is sorted Overdue, Due soon (both by expected day), then Not back for a while (most recent
first).

### Never listed

Matched by `customer_id` **or by the phone's digits** (stored numbers come with and without '+'):
- a **pending or confirmed booking** from the store's midnight today onward (someone late for this
  morning is not a customer to phone), never a superseded one;
- an **active or paused repeating booking** ([recurring-appointments.md](./recurring-appointments.md));
- a **waiting or in-service ticket** in today's queue;
- a customer with no phone (a walk-in without a number never becomes a customer at all).

## The call

Each row: **Call** (`tel:`), **Book**, **Later**, **Not interested**. What a call achieved is stored
in `customer_followup` (migration 0045) — one current-state row per customer:

| Outcome | Effect |
|---|---|
| No answer | hidden until the store's **tomorrow** (set by the server) |
| Call back on a day | hidden until that day — tomorrow … today+60 (`callBackRange` from the API) |
| Not interested | hidden until undone — even through new visits |

- A snooze holds only while the visit it was about is still the latest: someone who came in by
  themselves starts a fresh cycle (`about_last_visit`).
- Every hide offers **Undo** on the toast, and every hidden customer stays under **Hidden (n)** with
  its own Undo (`DELETE /customers/:id/followup`).
- **Booking** a customer deletes their row.

## Book

Book opens the shared slot picker on the customer's **expected day** (today, when that has passed),
with their **last visit's services and stylist**:
- Services come from the last visit's queue entry: its first service, plus the extras whose label is
  a current service's name. An add-on that isn't a service, or a service since switched off, leaves
  the pre-fill incomplete — the picker then says "check the services".
- A stylist who has left is replaced by "Any stylist". A staff login books only on its own chair.

It posts to the owner's `POST /appointments`, which is now checked exactly like a customer's own
booking: the same `isBookable` under the store's `appt:` lock, today … today+60, regulars'
not-yet-booked series dates counted as taken, and a 409 `SLOT_UNAVAILABLE` when the time was taken
meanwhile (the picker re-reads its times). Before 2026-10-28 that endpoint had no screen and no guard
at all — any time, a stylist from another store, one service.

**No SMS.** Owner surfaces are never an opt-in path ([sms-opt-in-a2p.md](./sms-opt-in-a2p.md)), so a
visit booked here has `sms_opt_in` and `review_sms_opt_in` false: no confirmation, no 15-minute
reminder and no review request after checkout. The owner is on the phone; that is the confirmation.

## Who sees it

| Login | List | Log a call | Book |
|---|---|---|---|
| Owner, co-owner | the whole store | ✅ | ✅ |
| Staff with Customers access | customers whose **last visit was in their chair** | with Customers "manage" | with Appointments "manage", own chair only |
| Staff (default: no Customers access) | — (403) | — | — |

A staff login with no chair linked sees nobody. Another chair's customer is a 404, not a 403.

## The screens

| | owner-web | app (iOS + Android) |
|---|---|---|
| Where | Customers → `All \| Due · N` (`?view=due`); **All is the default** | Customers tab → `All \| Due · N`; All is the default |
| List | `customers/DueList.tsx`, `styles/customers-due.css` | `components/customers/DueCard.tsx` in the tab's Due view |
| Book | the shared `RescheduleSheet` with a new target kind `new` (services chips) | `BookNewInline` (RescheduleInline.tsx) — inline, never a second modal |
| Later | `customers/LaterSheet.tsx` (bottom sheet, date input) | inline month grid in the card |
| Undo | `showToast(…, { action })` (`lib/toast.tsx`) | `showToast(…, …, { action })` (`lib/toast.ts` + `TToast`) |
| Refresh | `LiveRefresh` on bookings, check-ins, checkouts, `customer:followup` | socket handlers → `scheduleDueRefresh` |

**No Home card**: the owner decided on 2026-09-22 to keep Home about the queue
([mobile-home-screen.md](./mobile-home-screen.md)). All plans get the feature.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/customers/due` | `{ today, callBackRange, counts{overdue,dueSoon,lapsed,hidden}, data[], hidden[] }` |
| PUT | `/customers/:id/followup` | `{outcome:'no_answer'}` · `{outcome:'call_later', callBackOn}` · `{outcome:'not_interested'}`; emits `customer:followup` |
| DELETE | `/customers/:id/followup` | Undo; idempotent |
| GET | `/appointments/slots?date&serviceIds&staffId` | free times for a new booking of those services |
| POST | `/appointments` | `{customerId, serviceIds, slotStart, staffId?}` (legacy name/phone, `serviceId`, `scheduledStartAt` still accepted) |

The `/due`, `/:id/followup` and `/slots` routes are registered before their router's `/:id`.

## Data

- **0045** `customer_followup` (see the table above) + a partial index
  `visit(business_id, customer_id, completed_at desc) where customer_id is not null`.
- Who is due is **computed on every read** — nothing is stored or scheduled. At salon scale that is
  one query; if a large store ever needs it, the scheduler can materialise a `next_due_at` nightly.

## Tests

| What | Command | Proves |
|---|---|---|
| Rules | `cd backend && npx vitest run tests/unit/due-back.test.ts` | the examples above, rounding, band edges, the timeline, snoozes, order |
| Routes | `npx vitest run tests/unit/customers-due.test.ts tests/unit/owner-booking.test.ts` | route order, scopes and 403/404s, follow-up validation on the store's calendar, booking guards (409/400/403/404), itemised services, no SMS |
| Real SQL | `DATABASE_URL=<migrated throwaway> npx tsx scripts/smoke-due-list-db.ts` | backdated visits either side of midnight IST, every status, every exclusion (by id and bare phone), the follow-up lifecycle, staff scope, the pre-fill, booking under the lock |
| HTTP | `SMOKE_DATABASE_URL=<seeded throwaway> node scripts/smoke-due-list.mjs` | list → hide/undo → book → off the list → 409 → staff 403s → the owner's Cancel |
| No overlaps | `DATABASE_URL=<migrated throwaway> npx tsx scripts/smoke-no-overlap-db.ts` | owner and customer bookings and moves never put two bookings on one stylist at once, including four at the same moment and a checked-in visit |

Run 2026-10-28: rules 30/30, routes 15/15 + 21/21, DB smoke 44/44, HTTP smoke 33/33, no-overlap
24/24, `smoke-rest` 138/138, `smoke-booking-guards` 14/14, `smoke-recurring-sweep` 50/50, whole
backend suite 51 files / 664 tests.

**Found on the way:**
- **Owner Cancel and No-show:** these answered 500 on every booking from 2026-10-05, because
  `setStatus` reused `$1` as both `appointment_status` and text. Fixed; the HTTP smoke's cleanup step
  is its regression test.
- **Check-in double-booking:** a **checked-in** visit stopped holding its stylist, so the rest of its
  booked time showed as free and could be double-booked by the owner or a customer.
  - `slotInputFor` now counts `checked_in` with `pending`/`confirmed`.
  - `smoke-no-overlap-db.ts` failed 22/24 before the fix (one real overlap in the day) and passes
    24/24 after.

## Not done / open

- Not checked in a browser or on a device yet.
- A separate rhythm per service (haircut every 3 weeks, colour every 6) — Phase 2.
- "Make it repeating" after the call (turn the booking into a series from the owner side) — Phase 2.
- An automatic "we miss you" message needs a newly registered SMS sample / approved WhatsApp
  template and opt-in — not allowed today.
- The tolerance (25%), the lead (2 days) and the minimum (7 days) are fixed; a per-store setting can
  come later.
- `GET /customers` (All) is still not narrowed to a staff login's chair (pre-existing); Due is.
