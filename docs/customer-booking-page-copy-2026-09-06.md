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

- **Phone helper text** at the field: *"We'll text your appointment confirmation and updates to
  this number."* (booking) / *"We'll text you when your turn is approaching."* (waitlist).
- **Text consent**, above the confirm button: *"By confirming, you agree to receive appointment
  updates by text from {Business}. Message and data rates may apply. Reply STOP to opt out."*
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

**Not verified by automated tests:** every rendering change in `MicrositeClient.tsx` and
`sections.tsx` — the `$0` rule, the closed-state gate, the per-store page title and all wording.
The repo has **no UI test runner** for any of its four front ends, and `CLAUDE.md` §12.3 says not
to add a browser runner speculatively. The backend `openStatus` logic — the part with real
timezone and week-wrap arithmetic — is covered by the new unit test; the rest needs manual QA, or
the Playwright tier that §12.3 keeps proposing.
