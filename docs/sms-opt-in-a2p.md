# SMS opt-in (Twilio A2P 10DLC)

TejoTime sends **exactly three** customer texts, all behind **one** website consent box:

| # | Message | Sent when | Carrier category |
|---|---|---|---|
| 1 | Booking confirmation | right after a website booking | Customer care |
| 2 | 15-minute reminder | 15 min before a booked appointment (scheduler, every minute) | Customer care |
| 3 | Thank-you + Google review link | after the visit is checked out | **Marketing** |

The old waitlist set (joined / ~15 min / ~2 min / your turn) was **retired** and replaced by
these three. Walk-ins (Check in) therefore get **no** texts except the review request.
The ticket socket events (`ticket:ready`, `ticket:eta_15`, `ticket:eta_2`) are unchanged and no
longer send SMS.

Do **not** submit the Twilio campaign until this is live on `www.tejotime.com`. Reviewers open
the real store URL. Keep `SMS_ENABLED=false` until the campaign is **Approved**. The $15
vetting fee is not refunded on rejection. If rejected, **edit and resubmit the same campaign**
— creating a new one bills another $15. The existing campaign was registered as *Account
Notifications* with the four waitlist samples: **edit it** to the use case, flow and samples
below and resubmit; do not create a second one.

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
| Confirmation trigger | `public.service.ts` `bookSlot` |
| Reminder trigger | `jobs/scheduler.ts` (every minute; one-shot claim on `reminder_sent_at`) |
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

**Sample messages** — must match production `sms-copy.ts` word for word (pinned by
`tests/unit/sms-copy.test.ts`). Note there is **no punctuation straight after a link**: some
handsets fold a trailing `.` into the URL and open a 404.

1. `5th Avenue Barber & Shave Shop: Hi Alexander, your appointment is confirmed for Sep 26 at 1:11 PM. Manage your booking: https://www.tejotime.com/12393160008 Reply STOP to opt out.`
2. `5th Avenue Barber & Shave Shop: Hi Alexander, your appointment starts in 15 minutes. Please head over now. Address: 1011 5th Ave N, Naples, FL 34102`
3. `5th Avenue Barber & Shave Shop: Thanks for visiting, Alexander! Please leave us a Google review: https://www.tejotime.com/12393160008/r Reply STOP to opt out.`

STOP appears in message 1 (the first a booking produces) and message 3 (the only one a walk-in gets). The reminder carries none by
design; Advanced Opt-Out still honours STOP/HELP replies to any message. Bodies stay GSM-7 (no
em dash or curly quotes). The greeting uses the customer's first name; a store with no address
drops the `Address:` tail. Dates and times are in the store's own timezone.

> **"Manage your booking" link** opens the store's booking page — there is not yet a page where a
> customer can view or cancel one booking. Either build one or reword to "View details" (and the
> sample with it) before submitting, if a reviewer is likely to click it.

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
- [ ] Campaign description says TejoTime is a SaaS queue/booking platform sending messages on
      behalf of the businesses that use it.

## Tests

`cd backend && npm test`:
- `sms-copy.test.ts` — the three bodies word for word, no punctuation after a link, STOP
  placement, GSM-7, first-name/blank fallbacks, store-timezone date/time, and the reminder window
  (`isReminderDue`: 16/15/1/0 minutes, started, booked inside the window).
- `public-sms-consent.test.ts` — the two consent flags reach the service separately (the page
  currently sends both from one box), default false when omitted, non-boolean or unknown keys → 400.
- `sms-opt-in.test.ts`, `sms.test.ts` — the send gate and the Twilio seam.

`backend/scripts/smoke-rest.mjs` (block "SMS CONSENT + GOOGLE REVIEW LINK") books with both
flags, walks in with the review flag, and round-trips / refuses / clears the owner's review link,
checking it never reaches the public payload. It cannot see the SMS itself: notifications are not
on the HTTP surface and the script has no DB handle — the dispatch is covered by the units above.
It needs a running API plus a migrated, seeded **throwaway** database.
