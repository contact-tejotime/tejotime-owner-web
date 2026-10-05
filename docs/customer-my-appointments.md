# My appointments — manage a booking with the phone number

Shipped 2026-10-05. Customer microsite only (`frontend/`) plus the public API (`backend/`).

## 1. The decision

Customers don't keep the manage link they get after booking. On another phone, or after clearing
their browser, they had no way to see, move or cancel a booking. They could only call the store.

**The client decided on 2026-10-05, deliberately, that the phone number alone is enough.** Typing
it gives the same powers as the link:

- **One-off booking:** see it, move it, cancel it.
- **Repeating booking:** skip a visit, move a visit, change all future visits, cancel the series.

This **reverses** the earlier rule "a phone alone never cancels" (docs/customer-chatbot-booking.md
§5, docs/recurring-appointments.md §5). That rule stood because there is no OTP.

### The accepted risk

- **Anyone who knows a customer's number** can move or cancel that customer's bookings at that store.
- **Nobody is told.** The client's SMS rule allows only the three registered texts
  (docs/sms-opt-in-a2p.md), so no message goes out for a move or a cancel.
- **Keys can't be revoked.** An appointment key is a fixed HMAC of the appointment id, and a series
  manage token never changes. Once handed out, it works for as long as the booking can be changed.

### What was kept

| Kept | Why |
|---|---|
| The lookup stays on `publicWrite` (20 per hour per network) | A phone lookup must not be cheap to enumerate. |
| Only a full international number (`+` and 8–15 digits) | `normalizePhone` reads a bare 10-digit number as `+1` (US). An Indian `9876543210` would otherwise open a stranger's `+1 9876543210` bookings. The page always sends `+<cc><number>`. |
| Keys only for bookings that can still change | Status pending/confirmed and not started. One from earlier today is listed with no key. Only active or paused series come back. |
| Nothing else about the customer | No name, phone, visitor type (a Hospital's "MR or patient") or notes, in the lookup or in `GET /public/appointments/:id`. |
| Number first, keys in page memory only | Nothing is listed until a number is entered, and only that number's bookings show. Keys and tokens are never written to localStorage, including those of bookings made on this browser: the page stopped saving bookings and clears old saved records on load. Only the last number and name are kept, for pre-filling. |
| The waitlist is unchanged | `/track` by phone still shows the place only. Leaving still needs the device that joined (`X-Ticket-Key`). |
| Applies to every store type | Hospital and clinic stores included, by the client's choice. |

**Window.** A public booking reaches today+13 (`BOOKING_WINDOW_DAYS` 14). A customer may move a
booking up to **today+20**, the same as a repeating visit (`customerWindowDays()`). So a booking
made at +13 can then be moved to +20. The client accepted this.

## 2. The flow

The **"My Appointments"** button sits next to "Check Waitlist Status" in the store page's header
(desktop and the mobile menu). Exact copy: [customer-booking-page-copy-2026-09-06.md](customer-booking-page-copy-2026-09-06.md)
§ "My Appointments".

1. **Number first, like Check Waitlist Status, on every device.** The pop-up opens on the phone
   step, pre-filled with the last number used on this page. "Show My Appointments" lists **only that
   number's** bookings, wherever they were made. "Look up another number" switches. Reopening the
   pop-up for the same number during the visit shows the list from page memory, with no new lookup.
2. **A one-off booking** offers **Reschedule** (a date strip from today to today+20, then that day's
   times, then a confirm step) and **Cancel** (with a confirm step).
3. **A repeating booking** opens the existing manage view (the `/{phone}/v` page) inline, driven by
   the token the lookup returned.

**Why no "booked on this device" list (changed 2026-10-05, same day).** The first version opened
on every booking this browser had saved. Someone who booked with four different numbers in one
browser saw all four numbers' bookings together, and so would anyone picking up a shared phone. The
client chose number first instead. Since every list now comes from the phone lookup, which returns
the keys, the page no longer saves bookings, keys or series tokens at all. Saved records left by the
earlier version are deleted when the page loads (`readStore`). The keys of a booking made on the page
are held in memory only, so the chat can still cancel the booking it just made.

**No link on the success screen.** Removed on 2026-10-05, the same day, also at the client's request.
The repeating-booking success screen used to offer "Save your link…" with a Copy button. It now
ends with "To skip, move or cancel a visit, tap My Appointments on this page and enter your number."
(a one-off booking already said the same). The `/{phone}/v#token` manage page stays: the
confirmation SMS, a registered template, still links to it.

**Store chat.** The chat's "My Appointments" flow uses the same lookup (and the same page memory), so a booking made on another device
is now cancellable there too. The old "booked on another device — call the store" answer is gone.
On a repeating visit the action reads "Skip this visit".

**Answer bot.** A question about changing or cancelling a booking now points at My Appointments
(suggested action `appts`). A refund question still gets the honest fallback, because a refund is a
policy the page doesn't state.

## 3. API

All endpoints are under `/api/v1/public`.

| Method | Path | Limiter | Notes |
|---|---|---|---|
| POST | `/businesses/:slug/appointments/lookup` | `publicWrite` | Body `{phone}`, which must start with `+` (otherwise 400). Response: `{ appointments[], series[] }`, described below the table. |
| GET | `/appointments/:id` | `publicRead` | Header `X-Appointment-Key`. Now also returns `staffId`, `seriesId`, `rescheduledAt` and `canChange`. |
| GET | `/appointments/:id/slots?date&staffId` | `publicRead` | Header `X-Appointment-Key`. Response `{date, slots, today, lastDay}`; `lastDay` is today+20. The booking doesn't block its own time. |
| POST | `/appointments/:id/reschedule` | `publicWrite` | Body `{key, slotStart, staffId?}`. Rules below the table. |
| POST | `/appointments/:id/cancel` | `publicWrite` | Body `{key}`. Unchanged. A series visit cancelled this way is a skip. |

**Lookup response:**
- `appointments[]`: up to 20, from today on. Each has `appointmentKey` only when `canChange` is true.
- `series[]`: `{seriesId, manageToken, status}` for each active or paused series.

**Reschedule rules:**
- **Wrong key:** 404, and nothing is read.
- **Can't move any more:** 422 when the booking is not pending/confirmed or has started.
- **Time not offered:** 409 `SLOT_UNAVAILABLE` when the time isn't one the slots answer would offer,
  which includes anything past today+20.
- **Stylist:** `staffId` keeps the current stylist when absent; `'any'` means no preference. A
  stylist from another store is a 400.
- **Writes:** the move takes the store's `appt:` lock and emits `appointment:updated`, plus
  `series:updated` when the booking belongs to a series.
- **Texts:** none are sent. The 15-minute reminder is re-armed for the new time.

**Code:**
- `public.service.ts`: `lookupAppointments`, `publicAppointmentSlots`, `reschedulePublicAppointment`.
- `reschedule.service.ts`: `customerSlotsForAppointment`, `rescheduleByCustomer` (the same guards as
  a customer moving a series visit by token).

## 4. Owner surfaces

No change. Owner web and the app (iOS and Android) already show every booking. A customer's move or
cancel reaches them through the existing `appointment:updated` / `series:updated` events.

**Known limit:** an owner who types a bare 10-digit number when creating a booking stores it as
`+1…`. The customer then won't find that booking by their `+91…` number. Owner-created bookings
were out of scope here.

## 5. Tests

- **Unit** — `backend/tests/unit/public-appointments.test.ts`:
  - the lookup returns keys and series tokens;
  - the series query is filtered by status and store;
  - a booking from earlier today gets no key;
  - no customer details are returned;
  - a bare number gets 400.
- **Unit** — `backend/tests/unit/series-edit.test.ts` ("My appointments: move a booking by its
  appointment key"):
  - wrong key → 404, with no reads;
  - a one-off and a series visit both move;
  - the stylist can change, but only to one from this store;
  - today+21 and taken times → 409;
  - checked-in or started → 422;
  - the slots answer reaches today+20.
- **Unit** — `backend/tests/unit/chat-faq.test.ts`: the cancel/reschedule question points at My
  appointments; a refund question gets the fallback.
- **E2E** — `backend/scripts/smoke-my-appointments.mjs`, run against a fresh API:
  - device A books a one-off and a series;
  - device B, holding only the phone number, moves and cancels the one-off and skips a series visit
    with the looked-up token;
  - another customer's number never returns these bookings; an unknown number gets empty lists;
  - a bare number → 400; today+22 → 409; a wrong key → 404.
- **E2E** — `backend/scripts/smoke-selfservice.mjs`: the lookup now returns the booking's key, and
  `/track` still returns no ticket key.
- **Chat flow** — `frontend/src/components/chat/flow/__tests__/flow-check.ts` (`npm run test:chat-flow`,
  167/167): scenario 25, where a booking made on another device is now cancellable; lookup → cancel;
  "Skip this visit" on a repeating visit.
- **Browser** — a headless-Chrome walk-through on the throwaway API (not in the repo; there is no
  browser runner), 29/29 steps at 390 px and 1280 px:
  - device A books a one-off and a repeating booking;
  - device B, holding only the phone number, reschedules and cancels the one-off, skips a visit in
    the inline manager, and skips one from the chat;
  - after a reload, no key, token or saved booking is in localStorage;
  - device A lists without typing, and its saved records reflect B's changes.
