# SMS opt-in (Twilio A2P 10DLC)

Website opt-in for transactional waitlist/appointment texts. Privacy (`/privacy` §5) and Terms
(`/terms` §18) already describe the program; this is the **checkbox + send gate** those pages
now match.

Do **not** submit the Twilio campaign until this is live on `www.tejotime.com`. Reviewers open
the real store URL. Keep `SMS_ENABLED=false` until the campaign is **Approved**. The $15
vetting fee is not refunded on rejection. If rejected, **edit and resubmit the same campaign**
— creating a new one bills another $15.

Owner-web and Expo are **not** an opt-in path. `message_flow` is website-only. Owner walk-ins
and owner-created appointments default `sms_opt_in = false` and are never texted unless that
visit's flag is true (it is not set from those surfaces).

## Product rule

Phone stays required so the shop can identify the visit. SMS consent is optional, unchecked by
default, and not tied to Confirm (Twilio errors **30923** / **30925**).

- Box off → join/book succeeds → no Twilio send
- Box on → stamp `queue_entry.sms_opt_in` / `appointment.sms_opt_in`, set
  `customer.sms_opt_in_at`, clear `sms_opt_out_at` → join / ~15 min / ~2 min / your-turn only

`queue_add` is not given a new parameter (overload trap; migrations 0016 / 0020). Consent is
an `UPDATE` after the RPC. Appointment check-in copies `appointment.sms_opt_in` onto the new
queue row the same way.

Schema: migration `0027_sms_opt_in.sql`. Defaults are **false**.

## Campaign paste (after production deploy)

| Field | Value |
|---|---|
| Use case | Account Notifications (not Marketing) |
| Privacy | `https://www.tejotime.com/privacy` |
| Terms | `https://www.tejotime.com/terms` |
| Opt-in method | Website |
| Opt-in URL | The live store, e.g. `https://www.tejotime.com/{store-phone}` — not the marketing homepage |
| Opt-out | STOP / HELP / START — enable **Advanced Opt-Out** on the Messaging Service. `/webhooks/sms` stays inert. |

**`message_flow`:**

> End users opt in on the public booking page at https://www.tejotime.com/{store-phone}. They enter name and mobile number, then may check an optional, unchecked-by-default box agreeing to receive transactional waitlist/appointment texts from that business via TejoTime (join confirmation, ~15 minute and ~2 minute wait alerts, and “it’s your turn”). Checking the box is not required to complete a booking or waitlist join; we do not text numbers that did not opt in. Message frequency is up to 4 messages per visit. Privacy: https://www.tejotime.com/privacy Terms: https://www.tejotime.com/terms

**Sample messages** (must match production `sms-copy.ts` word for word; bracketed parts are the
variables). List all four — message 1 promises up to 3 more updates (4 per visit, matching the checkbox and
Privacy/Terms), and the 15 min and 2 min
alerts share one body (`smsBodyEta`) with a different minute value:

1. `[Business Name] via TejoTime: You're on the waitlist. Token [A-24]. We'll text you up to 3 more updates for this visit. Reply STOP to opt out, HELP for help.`
2. `[Business Name] via TejoTime: You're about [15] minutes away.`
3. `[Business Name] via TejoTime: You're about [2] minutes away.`
4. `[Business Name] via TejoTime: It's your turn, please head in.`

STOP / HELP / frequency appear **only in message 1** by design — it is the CTIA opt-in
confirmation, and repeating the line on every alert read as spam to customers. Advanced Opt-Out
still honours STOP/HELP replies to any message. Bodies stay GSM-7 (no em dash) so each is one segment.

The minute value is the live estimate, so a real text may read "about 13 minutes". If any body
in `sms-copy.ts` changes, edit the campaign samples too.

There is no booking-confirmation SMS. Do not list one in the samples.

## Pre-submit checklist

- [ ] **US only.** This is a 10DLC campaign; texts go to +1 numbers only.
- [ ] Opt-in URL is a **real US store page** (+1 phone, `$` pricing) live on `www.tejotime.com` —
      an Indian number / `₹` pricing page reads as a mismatch to a US reviewer.
- [ ] Consent text on that page is readable (body size, full contrast — not grey fine print).
- [ ] Screenshots of Check-in **and** Book with the box **unchecked**.
- [ ] Privacy §5 and Terms §18 carry the stock line "Text messaging originator opt-in data and
      consent will not be shared with any third parties", and say STOP stops texts from TejoTime
      (Advanced Opt-Out blocks the whole number, not one visit).
- [ ] Support line +1 (239) 506-1324 is answered, and matches the HELP reply.
- [ ] **Advanced Opt-Out** enabled on the Messaging Service.
- [ ] Campaign description says TejoTime is a SaaS queue/booking platform sending service
      notifications on behalf of the businesses that use it.

## Tests

`cd backend && npm test` covers `shouldDispatchSms`, `shouldNotifyEta` (refuses `smsOptIn: false`),
and the A2P message bodies.

`backend/scripts/smoke-rest.mjs` was **not** extended to prove “no SMS row”: notifications are
not on the public HTTP surface, the scripts have no DB handle, and they need a running API plus
a seeded throwaway database. The existing public join still omits `smsOptIn` (zod default
`false`) and must keep returning 201.
