# Book appointment — the Appointments tab's "+"

**Date:** 2026-10-28 · **Applies to:** `owner-web/`, `app/` (iOS and Android), `backend/`

## Decision

The owner, looking at the Appointments tab: its "+" opened **Add walk-in** — the wrong action on a
tab of bookings, and walk-ins already have their place on Home. The "+" now opens **Book
appointment**: a scheduled visit for a customer who phones or asks at the desk.

- **Walk-ins stay on Home** (owner-web `LiveQueueCard` / `QueueBoard` → `WalkInSheet`; app
  `LiveQueueCard` / `QueueBoard` → `AddWalkInSheet`). Nothing about them changed.
- The Calendar has no "+" and is unchanged.

## The form

Top half — the walk-in sheet's fields:
- **Customer name** (required).
- **Phone** (**required** — owner, 2026-10-28). It starts on the store's country. A number already
  on the books is that customer (`findOrCreateCustomer`): no duplicate is made, and the customer
  keeps their saved name. Because every booking from here has a number, it shows in Customers, in
  their history, on the "Due to come back" list and under "My appointments" by phone.
- **MR / Patient** for Hospital-type stores, as the walk-in asks.
- **Services** — the checklist with price, length and "N selected · M min". The first service starts
  ticked; a store that has services needs at least one (their total length sets the free times).

Bottom half — the booking picker:
- **Day** — today on the store's clock up to today+60 (the owner's window).
- **Stylist** — "Any stylist" plus each stylist; a **staff login** gets only its own chair.
- **Time** — only the free times the API offers for those services, that stylist and that day.
  Choosing one highlights it; nothing is booked until **Book appointment**.

"The customer won't get a message" sits under the button — owner bookings are never texted
([sms-opt-in-a2p.md](./sms-opt-in-a2p.md)).

## The rules (all on the server)

`POST /appointments` (`backend/src/modules/appointments/owner-booking.service.ts`):
- without `customerId`, **`customerPhone` is required** and must be a real number
  (`normalizePhone`), else **400** before anything is locked or written;
- the time is judged exactly like a customer's own booking (`isBookable` under the store's `appt:`
  lock — see "No overlapping bookings" in CLAUDE.md §7): a time taken meanwhile is **409
  `SLOT_UNAVAILABLE`**, and the sheet re-reads its times;
- `source='owner'`, `sms_opt_in` and `review_sms_opt_in` false, services itemised for check-in,
  `visitor_type` kept;
- `appointments: manage` is required (the "+" is hidden without it — on the app it used to show to
  everyone); a staff login may book only its own chair (403).

## Files

| | owner-web | app |
|---|---|---|
| Trigger | `appointments/AppointmentsBook.tsx` (replaces `AppointmentsWalkIn.tsx`, deleted) | `(tabs)/appointments.tsx` header → `store.openBook` |
| Sheet | `components/NewAppointmentSheet.tsx` (`wk-*` + `rs-*` classes) | `components/feedback/BookAppointmentSheet.tsx`, mounted in `(app)/_layout.tsx` |
| Picker | its own day / `StylistOption` / `.rs-slot` block, fetching `/api/appointments/slots` | `SlotPickerInline` with `api.getNewBookingSlots`; `useStaffOptions` / `initialStaff` (now exported from `RescheduleInline.tsx`) |
| Submit | `POST /api/appointments` | `store.bookAppointment` → `api.createAppointment` |
| Strings | `appointments.bookAppointment`, `bookAppt.*` | the same keys |

## Tests

| What | Command | Result 2026-10-28 |
|---|---|---|
| Route guards | `cd backend && npx vitest run tests/unit/owner-booking.test.ts` | 24/24 (no phone / bad phone → 400, nothing written; name + phone links the customer; visitor type kept) |
| End to end | `node scripts/smoke-book-appointment.mjs` (running API + seeded throwaway DB) | 20/20 — slots → book → on the day's list → one customer for the number, even booked twice → 400s → 409 → staff 403 → cleanup |
| No overlaps | `DATABASE_URL=<migrated throwaway> npx tsx scripts/smoke-no-overlap-db.ts` | 24/24 |

Not yet checked in a browser or on a device.
