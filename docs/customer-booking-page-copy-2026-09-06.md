# Customer booking page — copy and correctness pass

**Date:** 2026-09-06 · branch `feat-jay`
**Scope:** the public customer microsite (`frontend`, route `/{phone}`), plus the one backend field
it needed. Nothing in `owner-web`, `admin-panel` or `app` was touched.

**Source:** a U.S.-market copy review of the live page
`https://www.tejotime.com/12395613995` (Curv Beauty, Fort Myers FL), captured 2026-09-05.

---

## 1. The rule the page now follows

> **"Book an Appointment" means a scheduled visit. "Join the Waitlist" means a walk-in.**
> Never use "Free" to mean *available*, and never print a price of `$0` unless the service is
> genuinely free.

Every string below was chosen to keep those two sentences true. The two surfaces are now cleanly
split:

> **Update 2026-09-07 — booking became multi-day.** The rule above is unchanged and the two flows
> stay separate; what changed is that "Book an Appointment" no longer means *today only*. The
> modal now opens on a 14-day date strip (closed weekdays greyed, not hidden), loads that day's
> slots, and keeps the preferred-provider chips — a named provider narrows the times to their own
> chair. `timeLabel` is now **"Choose a date and time"**, and the empty state names the day
> (`slotsEmptyDay` / `slotsClosedDay`). **"Join the walk-in waitlist instead" is now a fallback
> only**: it appears when the selected day has no times AND that day is today AND the store is
> open — the only situation where joining the live queue is a real alternative. Check in remains
> its own entry point and Book an Appointment never doubles as one. See §"Booking date strip"
> below.

| Surface | Means | Entry points |
|---|---|---|
| **Waitlist** (live queue) | walk in now, we hold your place | header CTA, hero card, per-provider cards in the Team section, sticky mobile bar, closing CTA band |
| **Appointment** (booking) | reserve a time slot | hero secondary CTA, every service card, and *every* waitlist entry point once the store is closed |

---

## 2. Correctness fixes (behaviour, not just wording)

### 2.1 `$0` no longer means free

`business` stores service prices as integer paise; a store that has not priced its menu stores
`0`. The page rendered that as `$0` on the service strip, the service cards, the picker inside the
booking modal, the pre-confirm summary and the marquee — telling every visitor the service was
free.

`MicrositeClient` now builds one `priceLabel` per service (`priceLabelFor`) and passes **that**
everywhere. Zero renders as **"Price varies"**. `ServiceItem.priceLabel` replaced
`ServiceItem.price: number`, and `ServiceList` no longer takes a `currencySymbol` — so no call
site can reintroduce a bare `{symbol}{number}`.

### 2.2 A closed store no longer invites walk-ins

The page showed `CLOSED TODAY` in the hero badge and, two lines below it, a green **"0 min wait ·
Walk in now"** with a live check-in button. Joining a queue at a closed shop mints a token nobody
is there to serve.

`walkInsClosed` now gates the whole walk-in surface:

- hero "Right now" card — booking is promoted to the primary action, the walk-in button is
  **removed** (not disabled: an inert button reads as a broken page), and the reason plus the next
  opening is printed beneath it;
- `QueueWaitSummary` — no longer green, no longer "0 min wait"; shows **Closed**, and still shows
  a real count if anyone is queued;
- header CTA, sticky mobile bar and the closing CTA band — swap to **Book an Appointment**;
- Team section per-provider CTAs — disabled, labelled **Closed**;
- `openQueue()` / `openWith()` — fall back to the booking flow, so a page left open past closing
  time cannot join from a stale render.

> **Deliberate escape hatch:** the gate is `site.hours.length > 0 && !openStatus.isOpen`, **not**
> `!isOpen` alone. `computeOpenStatus` returns `isOpen: false` for a store that never configured
> business hours, so gating on the raw flag would have silently switched check-in off for every
> store that skipped the hours step. "No hours configured" is treated as *unknown → stay joinable*.

> **Not enforced server-side.** `POST /public/businesses/:slug/queue` still accepts a join outside
> business hours. This pass gates the UI only; a server-side rule needs a product decision (shops
> that run late are a real case).

### 2.3 The store's own name in the browser tab

`/{phone}` had no `generateMetadata`, so every store's booking page inherited the root layout's
marketing title — *"TejoTime | Online Booking and Scheduling for Service Businesses"* — in every
tab, share card and search result. It is now **"{Business Name} | Book an Appointment"**, with a
matching description. A failed lookup falls back to the layout default rather than 500ing.

### 2.4 "Verified reviews" is no longer claimed

TejoTime does not verify reviewers. The review summary and the star stat card now read
**"{n} reviews"**. Ratings render with one decimal (`5.0`, not `5`) in the hero, the reviews block
and the stat card.

### 2.5 "Free" meant *available* in the live status line

The sticky mobile bar and the Team section's dark tile both render `LiveStatusLine`, whose text was
**hardcoded English**: *"All 4 free · no wait"*, *"Lisa free · 3 waiting"*, *"5 in the queue right
now"*. "Free" beside a page full of prices is the exact ambiguity the review opened with, and it
was in two of the most prominent slots on the page. Now *"All 4 available"* / *"Lisa available"* /
*"5 on the waitlist right now"*, every fragment from `t`, plus a closed variant.

### 2.5b "Closed" said once, not six times (2026-09-29)

Fixing 2.2 and 2.6 left a closed store announcing it everywhere: the hero pill (`CLOSED · OPENS
TOMORROW…`), the Right now card, a "Walk-in check-in is closed" line under its button, the dark
"Walk-in availability — Closed" tile in the Team section, a **Closed** chip on every provider, a
"Closed / Walk-ins closed" stat card, and the sticky mobile bar. Owners read it as the page shouting.

It is now said **once**, in the Right now card: **Closed**, then "Opens tomorrow at 9:00 AM" as plain
centred text (it was in the bordered `ttWaitEstimate` pill, which is meant for an ETA and looked like
an input). Everything else goes quiet rather than changing wording:

- hero status pill — hidden while closed (still shown while open);
- the "Walk-in check-in is closed" line under Book an Appointment — removed;
- Team section — the dark summary tile and the per-provider chip are hidden; each card keeps its
  photo, name, role and "Book with {name}";
- stat cards — the wait tile is dropped, and the team card reads "3 Team members", not "…available".
  An odd card count lets the last card take the full row on a phone (`salon.css`);
- sticky mobile bar — **kept as is** ("Walk-ins closed / Opens tomorrow at …" + Book Appointment).
  It is the one closed message still on screen once the hero card has scrolled away.

`t.microsite.sections.closedNow` is now unused. The walk-in gating itself (2.2) is unchanged.

### 2.6 A closed store's Team section still said "Available now"

The closed-state gate reached the hero and the CTAs but not the inside of the provider cards, so a
shut salon showed **"Available now"** chips, **"0 min / wait"** and **"0 / waiting"** counters, and
a *disabled* CTA. Now: the chip reads **Closed**, the live counters are **removed** (not zeroed —
"0 min wait" beside a Closed chip still reads as an invitation), and the button becomes a live
**"Book with {name}"** that opens the appointment flow **with that provider preselected**. A
disabled button was a dead end; this is the one action that still works.

The same applied to `QueueWaitSummary`'s per-seat breakdown, which listed "Available" against every
idle chair. It is hidden while closed unless somebody is genuinely still queued.

### 2.7 Two walk-in entry points bypassed the gate

- `joinAfterTrack` — the **"Join the Waitlist"** button on *"No active booking found"* — called
  `setMode("queue")` directly, so a customer could join a closed store from the tracking dialog.
  It now follows the same gate and relabels to **Book an Appointment**.
- `openWith` routed a closed store's provider card to `openJoin("book")` and **dropped the chosen
  provider**. It now passes the id through, so the selection survives the switch.

### 2.8 Booking could dead-end on a walk-in-only store

Because service cards now open the *appointment* flow (§2.9), a store with no bookable slots landed
the customer on *"No appointments are available today"* with nothing to press. There is now a
**"Join the walk-in waitlist instead"** button that switches mode in place, keeping the name, phone,
service and provider already entered. It is hidden when the store is closed, where it would be a
lie.

### 2.9 Service cards open the flow they advertise

A service card said "Book" and opened the **live-queue** flow. It now opens the **appointment**
flow and reads **"Book Appointment"** — consistent with §1, and it keeps the Services section
useful when the store is closed. The walk-in flow keeps four other entry points.

### 2.10 An empty About band on stores with reviews

`trustCells` lost its renderer when the About trust row became the v3 stat cards, but it stayed in
the About section's guard: `showAbout || trustCells.length > 0`. A store with reviews but no About
copy and no About photo therefore rendered an **empty ~112px band**. The guard is now just
`showAbout`; `trustCells`, `yearsOpen` and six now-dead `ticker.*` strings are gone.

---

## 3. Backend change

`computeOpenStatus` (`backend/src/modules/public/public.service.ts`):

- new field **`nextOpenLabel`** — `"today at 10:00 AM"` / `"tomorrow at 9:30 AM"` /
  `"Monday at 10:00 AM"`, resolved in the business's own timezone. Walks today → today+7, skipping
  openings that have already passed, so a shop open one day a week still resolves and an 8pm
  visitor is told *tomorrow*, not this morning's time. `null` when no opening exists at all.
- `label` when closed is now **`Closed · Opens {nextOpenLabel}`** (was a bare `Closed today`, or
  `Opens 10 AM` for a store that had not opened yet).
- `fmtTime` no longer strips `:00`, so business hours read **`10:00 AM – 7:00 PM`**. This also
  fixes the rows in the Business Hours table.

Mirrored in `frontend/src/lib/api.ts` (`openStatus.nextOpenLabel?: string | null`) — optional, so
a response from an older backend degrades to the generic closed copy instead of rendering
`undefined`.

---

## 4. Wording changes

All customer-facing strings live in `frontend/src/i18n/en.json` under `microsite.*` and
`domains.*`. Highlights:

| Where | Was | Now |
|---|---|---|
| Header / hero / mobile bar | Check in → | Join the Waitlist |
| Header / hero / nav | Book a time slot | Book an Appointment |
| Header | Track my turn | Check Waitlist Status |
| Nav | Visit us | Location |
| Hero note | No app, no account — just your number | No app or account needed. We'll use your phone number to confirm. |
| Hero wait | Walk in now / ~10 min wait | No wait right now / About 10 min wait |
| Team eyebrow | Live floor | Our Team |
| Team heading (beauty) | Our stylists · live availability | Choose Your Provider |
| Provider chip | Free now | Available now |
| Provider CTA (beauty) | Book with {name} | Join {name}'s Waitlist |
| Provider cells | wait / walk in / in line | wait / waiting |
| Live status line | All 4 free · no wait | All 4 available · no wait |
| Live status line | Lisa free · 3 waiting | Lisa available · 3 waiting |
| Live status line | 5 in the queue right now | 5 on the waitlist right now |
| Provider chip (closed) | Available now | Closed |
| Provider CTA (closed) | *(disabled)* | Book with {name} |
| Services eyebrow | The menu | Services |
| Services heading (beauty) | Treatments & pricing | Choose a Service |
| Service card CTA | Book → | Book Appointment |
| Stat card | {n} yrs / serving {area} | Since {year} / Serving {area} |
| Stat card | {n} verified reviews | {n} reviews |
| Stat card | {n} / on the floor | {n} / team member(s) available |
| About eyebrow | About Us | About {Business Name} |
| Visit | Opening hours | Business Hours |
| Visit | *(address was plain text)* | address · **Get Directions** (maps link) |
| Closing CTA | Skip the wait — join the live queue | Save time — join the walk-in waitlist |
| Closing CTA sub | 0 in the queue · Walk in now · we'll text you when you're close | No one is waiting right now. Join the waitlist and we'll text you when your turn is approaching. |
| Modal | Your name / Phone number | Full Name / Mobile Number |
| Modal | Preferred member (optional) · Any | Preferred Provider (optional) · No preference |
| Modal | Pick a time (today) | Choose a Time (Today) |
| Modal | Confirm booking → / Check in → | Confirm Appointment / Join the Waitlist |
| Success | You're booked! | Your appointment is confirmed! |
| Success | You're in the queue! | You're on the waitlist! |
| Success | We'll text you when you're 2 away. | We'll text you when your turn is approaching. |
| Leave | Leave queue / Rejoin queue | Leave Waitlist / Rejoin the Waitlist |
| Ticket card | Your token | Your number |
| Already in line | This number already holds a live token… | This phone number is already on today's waitlist… |
| Leave confirm | You'll lose token {token}… | You'll lose your place ({token})… |
| Your turn | Head to the chair — see you inside. | It's your turn — head in, we're ready for you. |
| Blocked / Left | call the shop | call the business |
| 404 page | We couldn't find that salon | We couldn't find that business |
| Error page | Could not load this salon | We couldn't load this page |

**Vertical-neutral vocabulary.** "Salon", "shop", "chair" and "stylist" were reaching hospitals,
restaurants and gyms through shared strings. Only genuinely domain-gated copy keeps its vertical
voice (clinics still "Take a Token"; `domains.clinic.*` still says doctor and consultation).
`queueWord.queue` — the word in the Team section's note — is now **"waitlist"**, matching the rest
of the page.

**Dead copy removed.** `DomainProfile.liveNote` and `.ctaSub` had no renderer, and their ten
strings still carried the old wording (*"It's the queue · Walk in soon"*, *"pick your stylist when
you join"*) — a landmine for whoever wired them up next. Both fields are gone from the interface,
all five profiles and `en.json`. A dead-key audit over `microsite.*`, `domains.*`, `notFound` and
`errorPage` now reports **zero** unreferenced keys and zero references to missing keys.

Nav order is now **Services · Team · Gallery · Reviews · About · Location** (Reviews is new; the
reviews `<Section>` gained `id="reviews"` so the anchor resolves).

### Added, not just reworded

- **Phone helper text** at the field: *"We'll use this number to identify your visit. Check the
  box below if you want appointment/waitlist texts."*
- **SMS opt-in**, unchecked by default, after the phone field — not bundled with Confirm. Full
  A2P language + Terms/Privacy links. See [sms-opt-in-a2p.md](sms-opt-in-a2p.md).
- **Payment expectation**: *"Payment is due at the business."* — accurate while
  `PAYMENTS_ENABLED=false`. **Revisit this line when online payments ship.**
- **Pre-confirmation summary** now shows service · duration, then the actual chosen slot label ·
  provider, then price. It used to read `THREADING · choose a time above · $0`.

### Copy that was deliberately *not* taken from the report

| Recommended | Why not |
|---|---|
| "Choose a Date and Time" | The booking modal only ever loads **today's** slots. The heading reads "Choose a Time (Today)" so it does not promise a date picker that does not exist. |
| Success screen: "Add to Calendar · Get Directions · Reschedule · Cancel Appointment" | Reschedule, cancel and calendar export **do not exist**. Advertising them would be a false affordance. |
| "By confirming, you agree to {Business}'s cancellation and no-show policy. View policy." | There is **no cancellation-policy field** on `business`, so there is nothing to link. Needs an owner-editable field first — see §6. |
| "We sent a confirmation to [mobile number]." | Messaging is behind `WHATSAPP_ENABLED` / `SMS_ENABLED`, both **off**. The page already over-promises texts; it was not made more specific. |

---

## 5. What is store data, not code

These items in the report are values the owner typed into the admin panel. **No code change can
fix them** — they have to be corrected per store:

| Report item | Where it comes from |
|---|---|
| `CURV BEAUTY` should be `Curv Beauty` | `business.name` |
| `BEAUTY CARE` as the hero headline | `business.tagline` |
| `FLORIDA` should be `Fort Myers, FL` | `business.area` |
| About text ending mid-word in `Contact Cape Coral Contac` | `business.description` |
| `Air Condition` → `Air-conditioned salon` | `amenity.label` |
| The business name appearing as the stylist's name | `staff.name` / `staff.role_label` |
| Every service priced `$0` | `service.price_paise` — now renders as **"Price varies"** until priced |

---

## 6. Still open

1. **Cancellation / no-show policy.** Needs a field on `business` and an editor in the owner
   portal before the page can state or link one.
2. **Server-side closed-hours rule** for `POST /public/businesses/:slug/queue` — currently UI-only
   (§2.2).
3. **Appointment management** — reschedule, cancel, add-to-calendar do not exist; the success
   screen stays minimal until they do.
4. **Multi-day booking.** Slots are today-only, which constrains the booking copy (§4).
5. **Currency/timezone defaults** are still `INR` / `Asia/Kolkata` while the marketing site is
   U.S.-facing — tracked in `.claude/docs/current-work.md` §3.

---

## 7. Verification

| Check | Result |
|---|---|
| `backend` `npm test` | **52 passed / 52** (6 files) — includes the new `tests/unit/open-status.test.ts` (9 cases) |
| i18n dead-key audit (`microsite`, `domains`, `notFound`, `errorPage`) | 0 unreferenced keys, 0 missing references |
| New test against the *unfixed* `computeOpenStatus` | **9 failed / 9** — confirmed it is a real regression test |
| `backend` `tsc --noEmit` | clean |
| `frontend` `tsc --noEmit` | clean |
| `frontend` `npm run lint` | clean |
| `frontend` `npm run build` | succeeds, all 17 routes |

## Team card avatars (2026-09-07)

Staff photos never appeared on the microsite. The chain was complete except for its last link:
`staff.avatar_url` is saved by the admin panel, the public DTO exposes it as `avatarUrl`, and
`MicrositeClient` maps it onto `LiveMember.photo` — but `LiveBoard`'s card rendered the status
chip, name, role, counters and CTA, and never drew the photo. `photo` and `avBg` had been on the
`LiveMember` interface, unused, since the section was written.

`MemberAvatar` now renders it: round, `object-fit: cover`, with the member's **initials on
`avBg`** when there is no photo. It is a plain `<img>` (matching the gallery, with the same
`eslint-disable` for `no-img-element`), because the stored URL is `{API}/media/{key}` which
302-redirects to a freshly signed bucket URL on a host `next/image` would need declared in
`remotePatterns` in advance. `onError` falls back to the monogram — that redirect can fail, and a
broken-image icon is worse than initials. `alt=""` because the name is rendered directly below.

## Booking date strip (2026-09-07)

Backend needed **no change**: `GET /public/businesses/:slug/slots` already took `date` and
`staffId`, resolved the weekday's hours, excluded taken appointments and filtered past times via
`cursor.isAfter(now)` — which is a no-op for a future day. `bookSlot` already accepted any
`slotStart` and any `preferredStaffId`. The whole gap was `fetchSlotsForToday()` in
`MicrositeClient.tsx` hardcoding one date.

What the client now does:

- `bookDate` state, defaulted to **`localYmd(new Date())`** — local date parts, *not*
  `toISOString().slice(0,10)`. The old UTC form meant a customer in IST at 2am asked for
  yesterday and was told nothing was available.
- `fetchSlots(serviceId, date, staffId)` takes its inputs as **arguments**, because every caller
  fires from the event that changes one of them and the corresponding state is not updated yet.
  A `slotReq` ref discards out-of-order responses when days are tapped faster than the network.
- The day strip renders only inside the modal, which cannot be open during SSR, so `new Date()`
  there can never cause a hydration mismatch.

Covered by Tier-1 E2E in `backend/scripts/smoke-rest.mjs` ("MULTI-DAY BOOKING + PREFERRED
PROVIDER", 12 assertions): a future date returns a full day of slots where today returned only
its remainder, a closed weekday returns none, slots narrow to one provider, a future booking
lands on exactly the chosen slot with the provider kept, and the booked time disappears from that
provider's list.

**Out of scope, still absent:** cancel, reschedule and calendar export.

**Not verified by automated tests:** the date strip's *rendering* — chip states, greyed closed
days, scroll behaviour — along with every earlier rendering change in `MicrositeClient.tsx` and
`sections.tsx`: the `$0` rule, the closed-state gate, the per-store page title and all wording.
The repo has **no UI test runner** for any of its four front ends, and `CLAUDE.md` §12.3 says not
to add a browser runner speculatively. The backend `openStatus` logic — the part with real
timezone and week-wrap arithmetic — is covered by the new unit test; the rest needs manual QA, or
the Playwright tier that §12.3 keeps proposing.

## Repeat this booking (2026-10-03)

Recurring appointments, Phase 1 — full design in [recurring-appointments.md](recurring-appointments.md).
Strings live in `frontend/src/i18n/en.json` under `microsite.repeat` (booking modal, success
screen) and `microsite.series` (the manage page).

- **Where:** in the booking modal after a time is picked, only when the store's
  `recurringEnabled` is on. "Book an Appointment" still means one scheduled visit; the repeat is an
  option on it, never a separate button.
- **Defaults that protect the customer:** "Just this once" is pre-selected and reset every time the
  modal opens; when repeating, "After 6 visits" is pre-selected. Confirm is disabled while a chosen
  repeat is half-filled (custom days outside 7–90, no end date) — it never silently books a single
  visit instead.
- **Honest preview:** "Your visits" lists the first six dates in the store's timezone, marking
  "Shop closed — skipped" and "Not free — skipped", plus "{n} visits · last on {date}" or "… and
  more". Fine print: "Same service, stylist and time. If your usual time isn't free, the salon will
  contact you." — true because the owner is told (Needs attention), and no text is sent.
- **Custom intervals** that are not whole weeks warn "Every {n} days falls on a different weekday
  each time."
- **The SMS consent box and its wording are unchanged** — they are part of the Twilio registration.
- **After booking:** "You're booked! Repeats every 2 weeks.", the visits booked now, any date that
  was not ("Not booked: {date} — shop closed / not free"), and "Save your link to skip or cancel
  visits" with Copy. The link is `/{store phone}/v#{token}`; a store reached without a phone URL
  shows "To skip or cancel a visit, call {store}." instead.
- **Manage page** `/{store phone}/v` (`SeriesManage.tsx`, `noindex`): rhythm, end, status banner,
  upcoming visits with Skip, "Cancel repeating booking", both confirmed inline. A missing or wrong
  token reads "This link doesn't open a booking…" with Call the salon.
- The store chat stays single-booking; its appointment cards show a "Repeating booking" marker.

Not verified in a browser end to end: pressing Confirm on a repeating booking, the success screen,
Copy, and the manage page against a real backend (checked with mocked responses only). The API
side is covered by `backend/scripts/smoke-recurring.mjs` (39 assertions, run on a throwaway DB).

### Phase 2 — move a visit, change all future visits (2026-10-03)

On the manage page (`SeriesManage.tsx`, strings under `microsite.series.*` and
`microsite.slotPicker.*`), using a new `SlotPicker.tsx` and `lib/booking-days.ts`. The day strip is
built from the API's `today`/`lastDay` (today … today+20), never the phone's clock. The booking
modal itself is unchanged; it only imports the helpers that moved.

- **Reschedule** sits next to Skip on each visit.
  - It opens the picker inline (day, stylist with the current one marked "(current)", time).
  - Then it asks "Move this visit to {when}?" with [Move visit] / [Back]; the row then shows "Moved".
- **"Change all future visits"** opens a panel above Cancel, with From, Stylist, New time (or "Keep current time") and a Preview. The stylist comes before the time because the free times depend on the stylist.
  - Preview statuses:
    - "Moved earlier — keeps its time"
    - "Not free at the new time — pick another time or skip", with [Pick another time] / [Skip this date]
    - "Skipped"
    - "Shop closed — skipped"
    - "Booked about 3 weeks ahead"
  - "Change visits" stays disabled until every taken date has a choice.
  - If a date is taken meanwhile: "Some dates are no longer free — pick again".
- **Wording:** "skip or cancel" became "skip, move or cancel" on the success screen, in the no-link line and in the page description.

Driven end to end in headless Chrome against a throwaway API (390px): book a weekly series → move a visit → change the time with two taken dates (one moved, one skipped) → a third customer takes the chosen time first (409, pick again) → confirm. The walk-through caught one bug, now fixed: the rhythm line's weekday came from the first visit, so a moved first visit turned "Mon" into "Tue".

## My Appointments (2026-10-05)

A **My Appointments** button sits beside **Check Waitlist Status**: in the desktop header, and in the
mobile menu. It opens a pop-up where a customer sees, moves and cancels their upcoming bookings.
It starts from the phone number on every device, pre-filled with the last one used, like Check
Waitlist Status, and lists only that number's bookings. This follows the client's decision that the phone number alone is enough;
the decision record is [customer-my-appointments.md](customer-my-appointments.md). Title case
matches the header's other buttons. The store chat's suggestion button and its answer use the same
words.

Page strings are in `frontend/src/i18n/en.json` under `microsite.myAppts.*`,
`microsite.header.myAppointments` and `chat.flow.starters.appts` (the chat's starter chip). The
answer bot's suggestion button and its reply come from the backend (`backend/src/lib/chat-faq.ts`,
`LABELS.appts`).

| Where | Copy |
|---|---|
| Header / mobile menu | My Appointments |
| Pop-up, phone step | Find your appointments · "Enter the phone number you booked with to see, move or cancel your upcoming appointments." · Show My Appointments |
| List heading | Upcoming appointments for {phone} (the "Booked on this device" list was removed the same day) |
| One-off row | Reschedule · Cancel → "Cancel this appointment — {what}?" Yes, cancel it / Keep it |
| Visit of a repeating booking (no token on this page) | Reschedule · Skip this visit → "Skip this visit — {what}? The rest of your repeating booking stays booked." |
| Repeating booking | Repeats every 2 weeks · Next: {when} · Manage visits → the manage view inline, with "All my appointments" to go back |
| Too late | Too late to change online (a booking from earlier today that has started) |
| Empty | No upcoming appointments for this number · Book an Appointment |
| 429 | Too many tries for now. Please wait a few minutes and try again. |
| Booking success | "See you at your appointment. To move or cancel it, tap My Appointments on this page and enter your number." |
| Repeating booking success | "To skip, move or cancel a visit, tap My Appointments on this page and enter your number." The link box ("Save your link…" + Copy) was **removed** the same day: customers didn't keep the link. |
| Manage page with a broken link | "…On the booking page, tap My Appointments and enter your number to find it — or call the salon." |
| Chat answer to "cancel / reschedule my booking" | "You can change or cancel a booking yourself: tap My Appointments on this page and enter the phone number you booked with." + a **My Appointments** button |

**Removed:** the chat's "This was booked on another device, so it can't be changed here. Please call
the store…" (`chat.flow.apptOtherDevice`). A booking made elsewhere is now cancellable from the chat
too.

**Not changed:** the SMS wording. It is a registered template, and its "Manage your booking" link
already lands on this page.

## Store setup review (2026-10-05)

From the client's review ([store-setup-review-2026-10-05.md](store-setup-review-2026-10-05.md)), on
this page:

- **Gallery heading:**
  - The photo section's heading is the owner's choice when they set one: a ready-made heading for
    the store type, or their own text.
  - Otherwise it is the store type's default, as before: "See our recent work", "Our facility",
    "From our kitchen", "Inside the gym", "Our Work".
- **Neighborhood → city:** wherever the neighborhood used to show — the line under the headline,
  the "Serving {area}" card, the scrolling strip, the Visit section and map — the **city** shows
  when the owner left the neighborhood blank.
- **Headline:** an empty stored headline shows the store's name instead of an empty heading.
- **Sample reviews on /demo-store:** the example store's reviews are made up, so the section's
  eyebrow reads **"Sample reviews"** (not "Customer Reviews") and each card carries a **"Sample"**
  tag. Real stores are unchanged. The store itself is now a US example: Naples FL, $ prices,
  Card / Apple Pay / Cash.
