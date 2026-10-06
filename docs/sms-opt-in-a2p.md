# SMS opt-in (Twilio A2P 10DLC)

TejoTime sends **exactly three** customer texts, all behind **one** website consent box:

| # | Message | Sent when | Carrier category |
|---|---|---|---|
| 1 | Booking confirmation | right after a website booking — and, for a repeating booking, each time the series job books the next visit (about 3 weeks ahead). **Also** right after a website **Check in** (since 2026-10-06) | Customer care |
| 2 | 15-minute reminder | 15 min before a booked appointment (scheduler, every minute). **Also** for a Check in that joined with **more than 15 minutes** to wait, once its wait drops to 15 or less | Customer care |
| 3 | Thank-you + Google review link | after the visit is checked out — booked or checked in | **Marketing** |

The old waitlist set (joined / ~15 min / ~2 min / your turn) was **retired**. Since 2026-10-06
Check in sends the same three approved texts as a booking (see [Check in](#check-in-2026-10-06)
below), not the old set. The ticket socket events (`ticket:ready`, `ticket:eta_15`,
`ticket:eta_2`) are unchanged; only the ~15-minute one also triggers a text.

> **Status (2026-10-06): campaign APPROVED.** Sending is switched on per environment with
> `SMS_ENABLED=true`, `TWILIO_TRIAL_MODE=false` and a blank `TWILIO_TEST_TO` (see
> [Going live](#going-live) below). The bodies were changed the same day to the approved wording.

Do **not** submit the Twilio campaign until this is live on `www.tejotime.com`. Reviewers open
the real store URL. Keep `SMS_ENABLED=false` until the campaign is **Approved**. The $15
vetting fee is not refunded on rejection. If rejected, **edit and resubmit the same campaign**
— creating a new one bills another $15. The existing campaign was registered as *Account
Notifications* with the four waitlist samples: **edit it** to the use case, flow and samples
below and resubmit; do not create a second one.

**Brand ↔ website (rejection, 2026-10-01).** The Twilio brand is the legal entity **INFRANET IT
SOLUTIONS LLC**, but the site only ever said "TejoTime", so a reviewer could not tie the website,
privacy policy and terms to the registered brand. The site now says **"TejoTime is operated by
INFRANET IT SOLUTIONS LLC."** in four places: at the top of the /privacy and /terms intros, in the
"Legal entity name" row of every legal page's contact box, in the marketing footers (homepage and
`MarketingChrome`), and in the store booking page's footer, which is the opt-in URL. The name comes
from one value, `t.legal.entity`, and the footers render `t.brand.operatedBy` with it. The consent
box wording was deliberately **not** changed, so `message_flow` below still quotes it word for word.

Owner-web and Expo are **not** an opt-in path. `message_flow` is website-only. Owner walk-ins
and owner-created appointments default both flags to `false` and are never texted.

**Second website opt-in path: the store chat (2026-09-30).** Checking in or booking from the
microsite's help chat ([customer-chatbot-booking.md](customer-chatbot-booking.md)) has an SMS
step. It shows **the same disclosure word for word** (`microsite.join.consentOptIn`), with the
Privacy and SMS Terms links, as body-size text. Nothing is pre-selected: the customer must tap
[Yes, text me] or [No thanks]. The answer is not tied to Confirm, and it sets both flags exactly
as the box does. Before resubmitting the campaign, mention in `message_flow` that consent may also
be collected in the on-page chat with identical wording, and add a chat screenshot next to the
checkbox one.

## Product rule

Phone stays required so the shop can identify the visit. There is **one** consent box, on both
Book an Appointment and Check in: optional, unchecked by default, and not tied to Confirm (Twilio
errors **30923** / **30925**). Its wording (client-approved, `microsite.join.consentOptIn`):

> I agree to receive appointment texts from {Business} via TejoTime, including booking
> confirmations, reminders, and a review request after my visit. Up to 3 messages per visit.
> Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not required to book.

The box sets **both** backend flags, which stay separate on purpose:

- `appointment.sms_opt_in` / `customer.sms_opt_in_at` → messages 1 + 2
- `appointment/queue_entry.review_sms_opt_in` / `customer.review_sms_opt_in_at` → message 3,
  **only if** the store has set a Google review link
- Ticking the box clears a prior `customer.sms_opt_out_at` (a fresh consent)

> **Bundling risk.** Carriers read message 3 as marketing, and this one box bundles it with the
> customer-care texts. The wording names it explicitly ("a review request after my visit"), which
> is the usual mitigation, but a reviewer may still reject the campaign for it. If so, the fix is
> UI-only: restore a separate review box in `MicrositeClient.tsx` sending `reviewSmsOptIn` on its
> own — the API, schema and send logic already treat the two consents separately.
- Appointment check-in copies **both** flags onto the new queue entry; checkout reads the review
  flag from there

`queue_add` is not given a new parameter (overload trap; migrations 0016 / 0020). Consent is an
`UPDATE` after the RPC.

Schema: `0027_sms_opt_in.sql` (appointment flags), `0028_appointment_sms_lifecycle.sql`
(`business.google_review_url`, one-shot claims `appointment.reminder_sent_at`,
`queue_entry.thank_you_sent_at`), `0032_review_sms_opt_in.sql` (review flags + reminder index).
Defaults are **false**.

### Where the code lives

| Concern | File |
|---|---|
| Message bodies (**= campaign samples**) + reminder window | `backend/src/lib/sms-copy.ts` |
| Send gate, notification row, the three senders, reminder sweep | `backend/src/modules/notifications/sms-dispatch.ts` |
| Confirmation trigger | `public.service.ts` `bookSlot`; for recurring visits the job books, `series.service.ts` `afterGeneration`; for Check in, `public.service.ts` `joinQueue` → `sendCheckInConfirmation` |
| Reminder trigger | `jobs/scheduler.ts` (every minute; one-shot claim on `reminder_sent_at`); for Check in, `queue.service.ts` `processTicketBroadcasts` → `sendWaitlistReminder` (one-shot claim on `notified_eta_15_at`) |
| Review trigger | `queue.service.ts` `checkout` (one-shot claim on `thank_you_sent_at`) |
| Consent box | `frontend/src/components/microsite/MicrositeClient.tsx`, string `microsite.join.consentOptIn` |
| Review link field | owner-web `StoreProfileEditor`, app `OwnerStoreProfileForm`, admin `StoreForm` |
| Review short link | `frontend/src/app/[phone]/r/route.ts` → API `GET /public/businesses/by-phone/:phone/review-link` |

The review link is `https://` only (carriers filter plain http), max 500 chars, and is not on the
public microsite payload — its only public read is the short-link lookup below. Empty = message 3
is simply not sent. The reminder skips a booking made less than 15 minutes before its start (it
just got its confirmation).

### Review short link — `www.tejotime.com/{store-phone}/r`

Message 3 does **not** text the raw Google URL. Carriers filter bit.ly-style public shorteners,
and Google's write-review URLs are long enough to add SMS segments, so we shorten on our own
domain — the same domain as the opt-in page. The SMS carries `{PUBLIC_WEB_URL}/{phone_full}/r`.

- The frontend route reads the link from the API on **every click** (`no-store`) and answers
  **302** (never 301, which a phone would cache), so an owner who changes their Google link later
  still reaches customers holding an older text.
- No usable link (cleared, unknown store, API down) → 302 to `/{phone}`, the store's booking page.
  A malformed phone → `/`.
- Only redirects to `https://` — the value is owner-saved and validated, never from the request,
  so this is not an open redirect.
- A store with no phone number has no short link; its review text falls back to the raw URL.

## Check in (2026-10-06)

Client request: a website **Check in** (walk-in waitlist) with the box ticked gets the same approved
texts as a booking. No new wording and no new template ids. A check-in text's `notification` row
carries `queue_entry_id` instead of `appointment_id`.

| Text | Check in rule |
|---|---|
| 1. Confirmation | Right after the check-in, **even with no wait**. A walk-in has no booked time, so the approved wording carries the waitlist's **estimate**: now + the estimated wait, on the store's clock (with no wait, simply now). The link is the store page, where Check Waitlist Status finds the place by phone. |
| 2. "starts in 15 minutes" | Only if the customer **joined with more than 15 minutes to wait**. Sent once, when their wait drops into 1–15 minutes. Joining with 15 or less ("Almost your turn", no wait) never gets it: it would arrive straight after the confirmation saying nothing new. A wait that falls straight to 0 (the chair freed up) never passes through the window, so no text. |
| 3. Review request | Unchanged. It always applied to Check in: after checkout, if the store has a Google review link. |

How it works:

- **The wait at check-in is stored.** `joinQueue` stores the estimated wait in
  `queue_entry.join_wait_minutes` (migration **0041**), and only when the box is ticked. Null
  everywhere else (owner walk-ins, appointment check-ins, unticked boxes, older rows), so none of
  those are ever texted. It is written **before** the join's own broadcast, because that broadcast
  can already take the 15-minute claim for a short wait.
- **Text 2 rides on the existing one-shot claim** `notified_eta_15_at`, in `queue.service.ts`
  `processTicketBroadcasts`. That runs after every queue change and every minute
  (`etaNotifySweep`), and it sends only if `isWaitlistReminderEligible(join_wait_minutes)` — wait
  at join > 15. The send is not awaited, so a Twilio round-trip never slows an owner's checkout.
- **A repeat check-in from the same number** ("You're already on the waitlist") returns the
  existing place before any of this, so it is never texted twice.
- **Every existing gate still applies:** the box, a prior STOP, `TWILIO_ALLOWED_COUNTRY_CODES` and
  `SMS_ENABLED`.
- **Up to 3 messages per visit** still holds: confirmation, at most one 15-minute text, and one
  review request.

## Campaign paste (after production deploy)

| Field | Value |
|---|---|
| Use case | **Mixed** (Customer Care + Marketing) — message 3 asks for a review |
| Privacy | `https://www.tejotime.com/privacy` |
| Terms | `https://www.tejotime.com/terms` |
| Opt-in method | Website |
| Opt-in URL | The live store, e.g. `https://www.tejotime.com/{store-phone}` — not the marketing homepage |
| Opt-out | STOP / HELP / START — enable **Advanced Opt-Out** on the Messaging Service. `/webhooks/sms` stays inert. |

**`message_flow`:**

> End users opt in on a business's public booking page at https://www.tejotime.com/{store-phone} when they book an appointment or check in. They enter name and mobile number, then may check one optional, unchecked-by-default box: "I agree to receive appointment texts from {Business} via TejoTime, including booking confirmations, reminders, and a review request after my visit. Up to 3 messages per visit. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not required to book." The messages are a booking confirmation, a reminder 15 minutes before the appointment, and one text after the visit asking the customer to leave the business a Google review. Checking the box is not required to book or check in; we do not text numbers that did not check it. Privacy: https://www.tejotime.com/privacy Terms: https://www.tejotime.com/terms

**Approved samples (2026-10-06)** — as registered on the campaign:

1. `TejoTime: Hi [Name], your appointment at [Business Name] is confirmed for [Date] at [Time]. Manage your booking: https://www.tejotime.com/[business-id]. Reply STOP to opt out.`
2. `TejoTime: Hi [Name], your appointment at [Business Name] starts in 15 minutes. Please head over now. Address: [Business Address]`
3. `TejoTime: Thanks for visiting [Business Name], [Name]! Please leave us a Google review: https://www.tejotime.com/[business-id]/r. Reply STOP to opt out.`

**What production sends** — `sms-copy.ts`, pinned word for word by `tests/unit/sms-copy.test.ts`:

1. `TejoTime: Hi Alexander, your appointment at 5th Avenue Barber & Shave Shop is confirmed for Sep 26 at 1:11 PM. Manage your booking: https://www.tejotime.com/12393160008 Reply STOP to opt out.`
2. `TejoTime: Hi Alexander, your appointment at 5th Avenue Barber & Shave Shop starts in 15 minutes. Please head over now. Address: 1011 5th Ave N, Naples, FL 34102`
3. `TejoTime: Thanks for visiting 5th Avenue Barber & Shave Shop, Alexander! Please leave us a Google review: https://www.tejotime.com/12393160008/r Reply STOP to opt out.`

Two deliberate differences from the approved samples, both decided 2026-10-06:

- **No `.` straight after a link.** The samples have `…/[business-id]. Reply STOP`; the bodies
  send `…/12393160008 Reply STOP`. Some handsets fold a trailing `.` into the URL, and
  `/12393160008.` or `/r.` opens a broken page. Wording is otherwise identical.
- **`[business-id]` is the store's phone (`phone_full`)**, because that is the booking page's
  real path on `www.tejotime.com`.

Every text opens with the registered brand `TejoTime:`, and the store is named inside the
sentence; a store with a blank name drops "at [Business Name]" rather than printing "at  is".
STOP appears in message 1 (the first a booking produces) and message 3 (the only one a walk-in gets). The reminder carries none by
design; Advanced Opt-Out still honours STOP/HELP replies to any message. Bodies stay GSM-7 (no
em dash or curly quotes). The greeting uses the customer's first name; a store with no address
drops the `Address:` tail. Dates and times are in the store's own timezone.

**Segments (cost).** The approved wording is longer than the earlier copy. The confirmation is
always **2 segments** (171 characters for "Sharp Cuts", 191 for "5th Avenue Barber & Shave Shop";
more for a recurring visit's longer `/v#token` link). The reminder and review request are 1
segment for a short store name and can tip into 2 for a long name or address.

### Going live

The backend reads these at boot, so restart it after changing any of them:

| Variable | Local test | Production |
|---|---|---|
| `SMS_ENABLED` | `true` | `true` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | account values | account values |
| `TWILIO_MESSAGING_SERVICE_SID` | the campaign's Messaging Service (`MG…`) | same |
| `TWILIO_FROM` | the campaign's 10DLC number — only used when the service SID is blank | same |
| `TWILIO_TRIAL_MODE` | `false` — `true` sends Twilio's placeholder ids, not this copy | `false` |
| `TWILIO_TEST_TO` | **your own number** — every send goes there | **blank** |
| `TWILIO_ALLOWED_COUNTRY_CODES` | `1`, or `1,91` with a +91 test number | `1` |
| `PUBLIC_WEB_URL` | as is (links point at it) | `https://www.tejotime.com` |

`backend/.env` points at the **live preprod database**, and the reminder sweep runs every minute
in any backend that has SMS on. So a local backend with SMS on and a blank `TWILIO_TEST_TO` would
text real preprod customers (those in an allowed country). Keep `TWILIO_TEST_TO` set for every
local run, or `SMS_ENABLED=false` when you are not testing.

**Sender: the Messaging Service (2026-10-06).** With `TWILIO_MESSAGING_SERVICE_SID` set, every
text is sent with `MessagingServiceSid` and no `From`, which is Twilio's recommended way for 10DLC:
Twilio picks the sender from the service's **Sender Pool** and applies the service's settings,
including Advanced Opt-Out. Blank falls back to `From=TWILIO_FROM`. A malformed value (not `MG` +
32 hex) stops the backend at boot. The campaign's number (**+1 239 666 7772**) must be in that
service's Sender Pool, or the service has no number to send from. In the Twilio console's number
inventory, a number in a service shows the service under Active Configuration, not "Set up".

### Allowed countries — `TWILIO_ALLOWED_COUNTRY_CODES` (2026-10-06)

The campaign covers **US (+1) numbers only**, so the backend refuses to text any other country
unless it is listed. The value is a comma-separated list of calling codes: `1` (the default), or
`1,91,44` to add India and the UK, with no code change, just an env change and a restart.

- **Unset or blank means `1`.** A typo (`US`, `1;91`, `1234`) stops the backend at boot, like
  any other bad setting.
- **The number that receives the text is checked**, so when `TWILIO_TEST_TO` is set it is the
  test number, not the customer. A +91 test phone needs `1,91`.
- **A number without a leading `+` is refused**: its country cannot be known. `normalizePhone`
  gives every number it accepts a `+`.
- **`1` is the whole North American plan.** US, Canada and most of the Caribbean share +1, and a
  calling code cannot tell them apart.
- **A refused text** shows `failed` with error `country_not_allowed` on its `notification` row,
  and `SMS skipped: country not allowed` in the log. Twilio is never called.
- The check lives in `smsSender` (`integrations/sms.ts`), the one place Twilio is called, with the
  rule in `lib/sms-country.ts` (`tests/unit/sms-country.test.ts`, `tests/unit/sms.test.ts`).

Listing another country only lets the backend try. That text goes out as international SMS,
outside the 10DLC campaign: it needs the country in Twilio's Geo Permissions (error 21408
otherwise), and India additionally filters traffic from senders without DLT registration, so a
+91 test number proves the code path and credentials but not 10DLC delivery.

Check a send in the backend log (`Twilio SMS sent` with the message sid, or `Twilio SMS send
failed` with Twilio's `code`) and in the `notification` row (`sent` / `failed`). Common codes:
30034 — the sending number is not in the campaign's Messaging Service; 21610 — the
recipient replied STOP; 21408 — that country is not enabled in Geo Permissions.

> **"Manage your booking" link** opens the store's booking page for a one-off booking. Since
> 2026-10-05 that page has a **My appointments** button: type the phone number to see, move or
> cancel the booking ([customer-my-appointments.md](customer-my-appointments.md)). So the link's
> wording is now true. A reviewer who clicks it lands one tap away from managing the booking.
> No new text was added for a move or a cancel.
>
> **Recurring appointments (2026-10-03, [recurring-appointments.md](recurring-appointments.md)).**
> For a visit of a repeating booking the same link opens the series' manage page,
> `https://www.tejotime.com/{store-phone}/v#{token}` (skip a visit, cancel the series) — same
> domain, longer path. Two consequences: that body is **two SMS segments** (since the 2026-10-06
> approved wording every confirmation is, see Segments above), and each visit the job books later gets this confirmation, so a regular
> receives it once per visit. That is still "up to 3 messages per visit", but consider saying
> "including each visit of a repeating booking" in `message_flow` when the campaign is next
> resubmitted. Nothing is texted for a skip, a cancellation, a pause, or a visit the job could not
> book — those go to the owner's Needs attention list. Phase 2 adds no text either: moving a visit,
changing all future visits and "Book another time" send nothing; a moved visit's 15-minute reminder
is re-armed for its new time (or marked sent if the new time is already inside the 15 minutes, so it
never fires at once with the wrong wording).

## Pre-submit checklist

- [ ] **US only.** This is a 10DLC campaign; texts go to +1 numbers only.
- [ ] Opt-in URL is a **real US store page** (+1 phone, `$` pricing) live on `www.tejotime.com` —
      an Indian number / `₹` pricing page reads as a mismatch to a US reviewer.
- [ ] That store has a Google review link set, so message 3 is real.
- [ ] Consent text on that page is readable (body size, full contrast — not grey fine print).
- [ ] Screenshots of **Book** and **Check in**, each with the single box **unchecked**.
- [ ] Privacy §5 and Terms §18 describe the three messages (including the review request) and the
      single box with "up to 3 messages per visit", and carry the stock
      line "Text messaging originator opt-in data and consent will not be shared with any third
      parties" (both updated with this change — have them reviewed before submitting).
- [ ] Privacy §5 also carries Twilio's exact sentence, verbatim and as its own paragraph — reviewers
      search for it and reject "similar but worded differently": "We do not sell or share your SMS
      opt-in data or personal information with third parties for marketing purposes."
- [ ] Support line +1 (239) 506-1324 is answered, and matches the HELP reply.
- [ ] **Advanced Opt-Out** enabled on the Messaging Service.
- [ ] Campaign description says "TejoTime, operated by INFRANET IT SOLUTIONS LLC, is a SaaS
      queue/booking platform sending messages on behalf of the businesses that use it."
- [ ] The legal entity INFRANET IT SOLUTIONS LLC (the registered brand) is visible live on
      /privacy and /terms (intro + contact box), the homepage footer, and the opt-in store page's
      footer.

## Tests

`cd backend && npm test`:
- `sms-copy.test.ts` — the three bodies word for word, no punctuation after a link, STOP
  placement, GSM-7, first-name/blank fallbacks, store-timezone date/time, and the reminder window
  (`isReminderDue`: 16/15/1/0 minutes, started, booked inside the window).
- `public-sms-consent.test.ts` — the two consent flags reach the service separately (the page
  currently sends both from one box), default false when omitted, non-boolean or unknown keys → 400.
- `sms-opt-in.test.ts`, `sms.test.ts` — the send gate and the Twilio seam.
- `checkin-sms.test.ts` — the two Check in senders (pool and Twilio stubbed): approved wording with
  the estimated time on the store clock, still sent with no wait, nothing for an unticked box,
  linked to the queue entry. `sms-copy.test.ts` pins `isWaitlistReminderEligible` (15 → no, 16 → yes).

`backend/scripts/smoke-checkin-sms.mjs` is the Check in end-to-end test. It needs a running API
with `SMS_ENABLED=false` and a seeded throwaway DB, which it also reads via `SMOKE_DATABASE_URL`;
it refuses `backend/.env`'s database. Over real HTTP it proves:

- a long-wait check-in → one confirmation, then exactly one 15-minute text once the visit ahead
  leaves, and never a second;
- the same number again → "already on the waitlist", no second confirmation;
- an unticked box → nothing;
- no wait → a confirmation only;
- a short wait (1–15) → a confirmation only, though the 15-minute claim was taken at check-in.

It backdates one started visit's `started_at` — the clock is the one thing HTTP cannot move.

`backend/scripts/smoke-rest.mjs` (block "SMS CONSENT + GOOGLE REVIEW LINK") books with both
flags, walks in with the review flag, and round-trips / refuses / clears the owner's review link,
checking it never reaches the public payload. It cannot see the SMS itself: notifications are not
on the HTTP surface and the script has no DB handle — the dispatch is covered by the units above.
It needs a running API plus a migrated, seeded **throwaway** database.
