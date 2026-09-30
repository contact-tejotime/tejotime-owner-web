# Store chat: check in, book and manage a visit

**Status:** built 2026-09-30 on `feat-jay`. It ships behind the same flag as the help chat
(`CHATBOT_ENABLED`), because the widget only mounts when that flag is on.
**Builds on:** [customer-chatbot-v1.md](customer-chatbot-v1.md). That doc covers the answer bot;
this one covers the guided flows added on top of it.

On a store microsite (`tejotime.com/{phone}`), a customer can now do everything the Join and Book
pop-ups allow without leaving the chat. The chat asks one thing at a time, with option buttons:

| Flow | Starts from | Ends with |
|---|---|---|
| **Check in** (walk-in waitlist) | "Check in now" chip · "I want to check in" · a Join suggestion | a live ticket card |
| **Book an appointment** | "Book appointment" chip · "book for tomorrow" · a Book suggestion | an appointment card with Cancel |
| **My waitlist status** | "My waitlist status" chip · "where am I in line" · a Track suggestion | the live ticket card, or "not on today's waitlist" |
| **Leave the waitlist** | "Leave the waitlist" on a ticket · "leave the queue" | "You've left" plus Rejoin |
| **My appointments** | "My appointments" chip · "cancel my appointment" | a list of upcoming bookings, each with Cancel when allowed |
| **Different number** | offered on the ticket, at the phone step, and in status and appointment lookups | the same flow for another number |

## 1. The rule that makes this safe

**The answer bot still never acts.** `POST /public/businesses/:key/chat` stays read-only, and
nothing a language model writes can join a queue or book a slot.

The actions run through a deterministic state machine in the browser,
`frontend/src/components/chat/flow/engine.ts`. It only ever emits an *effect*. The page carries
out each effect with the **same functions the pop-up uses**:

| Function | Also used by |
|---|---|
| `submitJoin` | the pop-up's Check in |
| `submitBook` | the pop-up's Book |
| `trackPhone` | the pop-up's Track my turn |
| `leaveHeld` / `releaseHold` | the pop-up's Leave |

As a result, a chat check-in behaves exactly like a pop-up one. It uses the same held-ticket record
in localStorage, the same abuse counter (3 joins, then blocked), the same ticket socket room and
poll, and the same resume pill.

```
typed text / tap ─► engine.step(state, input, ctx) ─► { state, out (bot messages), effect? }
                                                               │
                        useChatFlow executes the effect ◄──────┘
                        via the page's own functions (FlowAdapter)
                                    │
                        result ─► engine.step(... { kind: "result" }) ─► next message
```

## 2. Where the code lives

| File | Role |
|---|---|
| `frontend/src/components/chat/flow/engine.ts` | The state machine. Pure TypeScript with no React or DOM, so a script can check it. |
| `frontend/src/components/chat/flow/useChatFlow.ts` | Runs the engine, executes effects, refreshes slots on a timer and on tab focus, and turns live ticket events into messages. |
| `frontend/src/components/chat/flow/FlowCards.tsx` | Services picker, live staff and slot pickers, summary, live ticket, appointment and consent cards. |
| `frontend/src/components/chat/flow/binding.ts` | The interface `ChatWidget` consumes. The landing-page bot passes none and is unchanged. |
| `frontend/src/components/chat/flow/phone.ts` | Reads a typed number as local to the **store's** country (`parseTypedPhone`) and masks numbers for display. |
| `frontend/src/components/chat/ChatWidget.tsx` | Option buttons and cards. Options only work in the current turn, so a stale "Confirm" cannot fire. |
| `frontend/src/components/microsite/MicrositeClient.tsx` | Shared submit functions, the `FlowAdapter`, the context snapshot, and card rendering. |
| `backend/src/modules/public/public.service.ts` / `public.routes.ts` | Appointment self-service (§5). |
| `frontend/src/i18n/en.json` → `chat.flow.*` | All strings. |

## 3. The flows step by step

Only the steps a store needs are asked. The rules mirror the pop-up's `flowScreens`:

- **Visitor type** (Patient or MR) only for Hospital.
- **Services** only if the store has any. You can pick several, up to 10 (the API cap), and the
  first pick is the primary service.
- **Stylist** only if the store has staff. Check-in shows live waits; booking asks for a preference.
- **Day and time** only for booking. Days run over 14 days, closed weekdays are disabled, and dates
  use local date parts, never `toISOString`.
- **Name**, **phone** and **SMS consent** always. A remembered name or number is offered first as
  "Continue as Riya?" and "Use +91 98••••••10?".
- **Summary**, then Confirm, Change something, or Cancel.

**Check in** has three checks before any question:

1. Blocked number: show "call the store", plus [Book an appointment] (the block covers the walk-in
   line only).
2. A ticket is already held: show that ticket.
3. The store is closed: say when it opens and offer booking instead.

A store with **no configured hours** is never treated as closed, same rule as the website.

**Book**: no checks before the questions. Neither a held walk-in ticket nor the walk-in block
stops a booking — the block exists to stop join/leave abuse of the **line**, and a blocked number
used to be refused booking too (user report, 30 Sep 2026). The pop-up follows the same rule, and its
blocked view offers "Book an Appointment". "Join the walk-in line
instead" is offered only when the chosen day is today and walk-ins are open.

**At any point:**

- "stop" or "cancel" ends the flow.
- "back" goes back one step.
- A typed answer ("haircut and beard", "Lisa", "tomorrow", "5:30 pm", "yes") selects the matching option.
- Anything else goes to the answer bot, followed by "Shall we carry on?" [Continue] [Stop]. While
  that question is open, a typed "yes" means **carry on**: it re-shows the step (at the summary,
  the summary card again) and never confirms by itself — QA found "what are your timings?" →
  "yes" booking straight from the summary. The customer confirms afresh after seeing it.
- At a leave or cancel confirmation, only a clear yes or no counts. Anything else re-asks, and
  nothing destructive is guessed.

**Local intents.** `detectIntent` spots phrases that clearly ask the chat to *do* something
("check me in", "book", "cancel my appointment", "leave the queue", "where am I in line") and
starts the flow **without** calling `/chat`. Such a message never spends the `publicChat`
20-per-hour allowance. Questions such as "How does the waitlist work?", "Walk-ins?" or "Do you
take walk-ins?" deliberately do not match and still go to the answer bot.

## 4. Live data

| Data | How it stays current |
|---|---|
| Staff busy status, wait and queue count | **Live already.** The socket's `staff:availability` updates the page, with a 15 s poll when the socket is down. The staff card renders from that state, so labels change while the customer looks at them. |
| A staff member removed or deactivated | No socket event exists for this. The page re-reads `GET /public/.../staff` before each Confirm. If the chosen person is gone: "Lisa is no longer available — please pick again." |
| Customer ticket | **Live already** (`ticket:updated` / `ready` / `completed` / `cancelled`, plus a 5 s poll). The ticket card reads the page's ticket state. Once the chat has shown a ticket, it also posts "It's your turn", "Visit complete" and "cancelled by the store". |
| 15-minute warning | The page now listens for `ticket:eta_15`; the server already sent it, but no client listened. The chat posts "about 15 min until your turn". |
| **Slots** | **There is no push**, because booking emits nothing to customers. The chat keeps the list fresh in three ways: (1) it fetches on entering the time step and whenever services, day or provider change, and ignores a late answer for an old selection (the `slotsKey` guard, like the pop-up's `slotReq`); (2) it re-fetches every 30 s while the time step is open, and on tab focus, at most once every 10 s; (3) **before Confirm** it re-fetches the day and rejects a time that is gone ("That time was just taken") or has passed, then shows the fresh list. |

### Times are shown in the store's clock

Slot labels come from the API already formatted in the **store's** timezone (`business.timezone`),
so everything the chat shows about a time follows that zone, not the viewer's. The Morning /
Afternoon / Evening grouping reads the hour from the label, and booked times (appointment cards, the
pop-up's "booked for…" line) are formatted with the store's zone, which the microsite payload now
carries as `timezone`. Before this, a Phoenix-zoned store viewed from India showed its 9:00 AM
under "Evening" (30 Sep 2026).

### The server is the judge (since 30 Sep 2026)

Manual QA on the first build found the server trusted the client completely: two customers
confirming together were **both** booked, a 10:30 was accepted on top of a 10:00–11:30 booking, and
direct API calls booked the past, a closed Sunday, 11 PM, six weeks out and another store's
stylist. The pre-flight above is now only a courtesy; the server enforces the rule:

- **One rule, two uses.** `backend/src/lib/booking-slots.ts` `computeSlots` (pure, unit-tested)
  produces the slot list for `GET /slots` **and** is re-run by `POST /appointments`, which
  accepts only a time the list would offer. That single check rejects taken, overlapping, past,
  closed-day, out-of-hours, off-grid (not on the 30-minute step) and beyond-window
  (`BOOKING_WINDOW_DAYS` = 14, today included) times with **409 `SLOT_UNAVAILABLE`**.
- **Overlap-aware capacity**, not exact-start matching. A store can hold as many overlapping
  bookings as it has active stylists (a store with no stylists = one lane); a named stylist cannot
  hold two overlapping bookings; a booking with no stylist still uses one unit. "No preference"
  therefore keeps a time while any stylist is free (it used to vanish when anyone was booked).
- **Race-safe.** The check and the insert run in one transaction under
  `pg_advisory_xact_lock(hashtext('appt:' || business_id))` — per store, and namespaced so it never
  contends with the queue functions' lock.
- **Stylist checks.** `preferredStaffId` must be `'any'` or a UUID (a malformed id was a 500, now
  a 400), and must be an active stylist of **this** store (another store's id is a 400). The
  customer row is created only after the checks pass, so a rejected booking leaves no orphan.
- The chat and the pop-up both treat a 409 `SLOT_UNAVAILABLE` as "that time was just taken" and
  show fresh times.

Owner-created appointments are unchanged (an owner may deliberately overbook), but they count toward
capacity. Still open: a `slots:changed` socket push (the 30-second refresh covers it for now).

## 5. Appointment self-service (new, additive endpoints)

There is no OTP, so **a phone number alone never cancels a booking**. Otherwise anyone who knows
someone's number could wipe their appointment.

- `POST /public/businesses/:slug/appointments` now also returns **`appointmentKey`**. It is
  `ticketKey("appt:" + id)`; the prefix stops an appointment key from also working as a ticket key.
  The booking browser saves it in `tt_microsite_{slug}` under `appointments[]`. Entries are pruned
  6 hours after the appointment's start.
- `POST /public/businesses/:slug/appointments/lookup {phone}` (`publicWrite`, like `/track`)
  returns upcoming `pending`/`confirmed` bookings from today onward in the store's timezone. It
  **never returns keys**. Another device can therefore *see* a booking but cannot cancel it; it is
  told to call the store.
- `GET /public/appointments/:id` with header `X-Appointment-Key` (`publicRead`) reads the live
  status. A missing or wrong key returns **404, not 403**, so a guessed id cannot be confirmed.
  The key goes in a header so it never ends up in request logs.
- `POST /public/appointments/:id/cancel {key}` (`publicWrite`):
  - checks the key;
  - cancels in **one conditional UPDATE**
    (`status in ('pending','confirmed') and scheduled_start_at > now()`), so a check-in racing the
    cancel cannot be overwritten;
  - sends owners the same `appointment:updated` event as an owner-side cancel.

  A past, checked-in or already-cancelled booking returns 422. The freed time shows up in
  `/slots` again straight away.

No owner surface changes: owner-web and the app already react to `appointment:updated`.

### Leaving the waitlist needs the ticket key (same model)

`DELETE /public/tickets/:id` now requires header `X-Ticket-Key` — the key the **join** response
hands the joining browser (`socket.ticketKey`). A missing or wrong key is a 404. Status by phone
(`POST /track`) and a duplicate join now return **position only**: no ticket key and no customer
name. QA had shown a stranger looking up someone's number and removing them from the queue. A place
found by phone lookup on another device is shown live (5-second poll) but cannot be left there —
the chat says "This place was checked in from another device… ask at the counter", and the pop-up
hides its Leave button.

## 6. SMS consent in chat

The chat's SMS step shows the website checkbox's disclosure **word for word**
(`microsite.join.consentOptIn`), with the same Privacy and SMS Terms links, as body-size text.
The customer must tap [Yes, text me] or [No thanks]; nothing is pre-selected. One answer sets
both backend flags, as the website box does. This makes chat **a second website opt-in path**:
see [sms-opt-in-a2p.md](sms-opt-in-a2p.md) before the campaign is resubmitted.

## 7. Scenarios and how each is verified

"Engine" means covered by `npm run test:chat-flow` (158 assertions).
"Smoke" means covered by `backend/scripts/smoke-selfservice.mjs` or `smoke-booking-guards.mjs`.
"Unit" means `tests/unit/booking-slots.test.ts` / `public-booking-guards.test.ts`.
"Manual" means browser-only; there is no browser test runner (the Tier-2 gap).

| # | Scenario | Expected | Verified by |
|---|---|---|---|
| 1 | Open store with services and staff | full check-in and booking | engine |
| 2 | Hospital | visitor type asked first | engine |
| 3 | No services | services step skipped | engine |
| 4 | No staff (shared lane) | stylist step skipped | engine |
| 5 | Closed now | "opens X" + Book instead; no walk-in fallback | engine |
| 6 | No hours configured | check-in allowed | engine |
| 7 | Closed weekday | disabled; picking it anyway says so | engine |
| 8 | No times left today | "No times left" + another day; walk-in fallback only today and open | engine |
| 9 | A stylist goes busy mid-flow | label updates live | manual |
| 10 | Chosen stylist deactivated | pre-flight asks to re-pick | engine |
| 11 | Slot taken while typing — or by another customer in the same second | pre-flight or server 409 → "just taken" + fresh times; exactly one booking | engine + unit + smoke |
| 12 | Slot time passes | pre-flight shows "already passed" | engine |
| 13 | Services changed after picking a time | time cleared, slots for the new length | engine |
| 14 | Holding a ticket, then Check in | live ticket + Leave / Different number | engine |
| 15 | Holding a ticket, then Book | allowed | engine |
| 16 | Same number already in line on another device | "already on the waitlist", same ticket | engine + smoke |
| 17 | Different number | new name and number asked | engine |
| 18 | Blocked (3 joins / 429) | walk-in: "call the store" + Book offered; **booking still allowed** | engine |
| 19 | Leave while waiting | confirm → left → Rejoin | engine + smoke |
| 20 | Leave while being served | refused (also on a 409 race) | engine + smoke |
| 21 | Owner completes / no-shows | card flips; chat posts a message | manual |
| 22 | Your turn / 15 min left | chat posts a message | manual |
| 23 | Status: found / not found / another number | live card (no Leave without the key) / Check in / re-ask | engine + unit + smoke |
| 24 | Cancel on the same device | cancelled; the time returns to `/slots` | engine + smoke |
| 25 | Booking made on another device | visible, not cancellable, Call | engine + smoke |
| 26 | Cancel a past, checked-in or cancelled booking | 422 with the reason | engine + unit + smoke |
| 27 | Bad name or phone | re-asked | engine |
| 28 | "stop", "back", a question mid-flow, typed answers | handled | engine |
| 29 | Network failure | Try again keeps the details | engine |
| 30 | Reload mid-flow | flow restarts; the held ticket and saved bookings restore | manual |
| 31 | "yes" after an off-topic question at the summary | summary re-shown, nothing booked | engine |
| 32 | Overlap / past / closed / 11 PM / beyond window / foreign or malformed stylist (direct API) | 409 or 400, nothing written | unit + smoke |
| 33 | Leave by someone without the ticket key | 404, place kept | unit + smoke |

**Commands**

```bash
npm run test:chat-flow                          # engine scenarios (repo root)
cd backend && npm test                          # includes booking-slots, public-booking-guards, public-appointments
# E2E: fresh API + migrated, seeded THROWAWAY db (never the real one)
node backend/scripts/smoke-selfservice.mjs      # SMOKE_BASE_URL / SMOKE_SLUG to override
node backend/scripts/smoke-booking-guards.mjs   # restart the API first (see below)
```

Both are separate scripts, not sections of `smoke-rest.mjs`: the `publicWrite` limit (20 per hour
per IP) is shared, and the three scripts spend 14 + 14 + 10. Restart the API between them — the
limiter is in-memory.
