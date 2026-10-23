# WhatsApp for Indian (+91) customers

> Shipped 2026-10-23. Off until `WHATSAPP_ENABLED=true` is set (see [Going live](#going-live)).

TejoTime sends customers three messages: the booking or check-in confirmation, the 15-minute
reminder, and the post-visit review request ([sms-opt-in-a2p.md](sms-opt-in-a2p.md)). They go by
Twilio SMS, but the Twilio campaign covers US numbers only. So a customer with an **Indian (+91)
number** now gets the same three messages **on WhatsApp**, as the three templates approved in
Meta WhatsApp Manager. Every other number keeps getting texts, exactly as before.

| | +91 customer | any other customer |
|---|---|---|
| Channel | WhatsApp (Meta Cloud API) | SMS (Twilio) |
| Switch | `WHATSAPP_ENABLED` | `SMS_ENABLED` |
| Consent box wording | `microsite.join.consentOptInWhatsApp` | `microsite.join.consentOptIn` (the approved A2P text, unchanged) |
| `notification.channel` | `whatsapp` | `sms` |

The same consent rules apply to both channels:
- the **same unticked box** and the **same two flags** (`sms_opt_in`, `review_sms_opt_in`);
- the **same three triggers** (booking, check-in, checkout);
- the **same one-shot claims**;
- **up to 3 messages per visit**.

Only the provider and the box's wording differ.

## Routing

The channel is decided by the **customer's own number** (`messageChannelFor` in
`backend/src/modules/notifications/sms-dispatch.ts`):
- a number whose calling code is in `WHATSAPP_COUNTRY_CODES` (default `91`) goes to WhatsApp;
- everything else goes to SMS.

The page uses the same rule through `frontend/src/lib/message-channel.ts`. The page cannot read
the env, so a change to `WHATSAPP_COUNTRY_CODES` has to be copied into `WHATSAPP_DIAL_CODES` there.

- **The flag plays no part in routing.** `WHATSAPP_ENABLED` works exactly like `SMS_ENABLED`: it
  only decides whether the sender calls out. With it off, a +91 message is still recorded with
  `channel='whatsapp'`, `status='failed'` and error "WhatsApp send failed or deferred". Meta is
  never called, and the message never falls back to SMS. (+91 was never texted anyway:
  `TWILIO_ALLOWED_COUNTRY_CODES=1`.)
- **No consent, no row.** When the box was left unticked, or the customer has replied STOP since,
  nothing is sent on either channel and **nothing is written to `notification`**. (Until
  2026-10-23 an opted-out customer's message was still stored as an unsent `in_app` row, which
  showed up in the owner's notification list.) A row exists only for a message the customer
  agreed to. With the flag off, that row reads "deferred".
- **A failed WhatsApp send is never retried as SMS.** Meta reports some failures only later, on
  the webhook, so a retry could reach the customer twice.
- **`WHATSAPP_TEST_TO`** pins every send to one number, like `TWILIO_TEST_TO`. The country check
  runs on the number that actually receives the message, so the test number must be +91 too.

## The templates

Approved in WhatsApp Manager by the client:
- names = our SMS template ids;
- language `en`;
- wording = the SMS samples;
- body variables only, no buttons.

The variables are positional and fill in the order the values appear in the SMS
(`backend/src/lib/whatsapp-copy.ts`):

| Template | {{1}} | {{2}} | {{3}} | {{4}} | {{5}} |
|---|---|---|---|---|---|
| `booking_confirmed` | first name | store | date (`Oct 24`) | time (`1:30 PM`) | manage link |
| `appointment_reminder` | first name | store | address | | |
| `review_request` | store | first name | review short link `…/{store-phone}/r` | | |

Meta rejects the whole message when a variable is empty, or contains a newline, a tab or more than
four spaces in a row. Unlike an SMS body, a template's fixed words cannot drop out ("at {{2}}" is
always there). So every value is collapsed to single spaces and given a stand-in:
- a blank store name becomes "the store";
- a blank customer name becomes "there";
- a store with **no address** gets its booking page link after "Address:", since the page shows
  where the store is.

The links are the same as in the SMS:
- the store page, or `/{phone}/v#token` for a repeating booking;
- the review short link.

**Changing a template** in WhatsApp Manager (its name, its language or the order of its
variables) has to change `whatsapp-copy.ts` or the env names with it, or Meta refuses the message
(`132000`/`132001`). The names are env settings: `WHATSAPP_TEMPLATE_BOOKING_CONFIRMED`,
`_APPOINTMENT_REMINDER`, `_REVIEW_REQUEST` and `WHATSAPP_TEMPLATE_LANGUAGE`.

## Consent box

The box's wording follows the **dial code in the phone picker**, so it is right before a digit
is typed:

> I agree to receive appointment messages on WhatsApp from {Business} via TejoTime, including
> booking confirmations, reminders, and a review request after my visit. Up to 3 messages per
> visit. Reply STOP to opt out. Consent is not required to book.

- The links are Privacy and **Terms** (the US box says "SMS Terms").
- The helper line above the box says "WhatsApp messages" instead of "texts".
- The store chat's messages step does the same, keyed on the number given one step earlier:
  - the question, "Yes, message me on WhatsApp", the summary row and the disclosure card;
  - covered by `npm run test:chat-flow`.
- Every other number keeps the approved A2P wording **word for word**.

**The phone picker now starts on the store's own country** (`site.countryCode`), not +1. Before
this, an Indian store's customer who typed 10 digits was stored as a +1 number: wrong for the
store, and never sent the WhatsApp messages. A remembered number still restores its own country.

Privacy §5 and Terms §18 each gained one paragraph saying that +91 numbers get these messages on
WhatsApp through Meta's WhatsApp Business Platform, and that STOP stops them. Both pages' "Last
updated" dates moved to October 23, 2026. **Still for the client to decide:** Privacy §4 and §12
and Terms §1 and §3 describe the service as US-only. They were left as they are.

## Webhook: delivery and STOP

Endpoint: `GET|POST /api/v1/webhooks/whatsapp` (`modules/webhooks/whatsapp.service.ts`). It does
**not** depend on `WHATSAPP_ENABLED`, so the Meta setup can be finished before sending is on.

- **GET** is Meta's subscription handshake. When `hub.mode=subscribe` and `hub.verify_token`
  equals `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, it answers `hub.challenge` as plain text; otherwise 403.
- **POST** must carry `X-Hub-Signature-256`, which is `sha256=` plus the HMAC-SHA256 of the raw
  body under `WHATSAPP_APP_SECRET`.
  - A blank secret, or a missing or wrong signature, gets a **401** and nothing is processed. The
    endpoint is public, and a forged STOP would silence a customer.
  - `app.ts`'s `express.json` keeps the raw bytes for this path only.
  - Once the signature passes, the answer is always 200, even if one item fails. Meta retries the
    whole delivery otherwise.
- **`statuses[]`** update the `notification` row whose `provider_message_id` is the message id
  (`wamid…`). Only `channel='whatsapp'` rows are touched. Meta does not promise order, so a row
  only moves forward:

  | Meta status | Row becomes | Only if the row is |
  |---|---|---|
  | `sent` | `sent` | `queued` |
  | `delivered`, `read` | `delivered` (the enum has no `read`) | `queued` / `sent`, never `failed` |
  | `failed` | `failed`, `error = "<code>: <title>"` | any |

- **`messages[]`**: STOP, STOP ALL, UNSUBSCRIBE, CANCEL, END or QUIT (Twilio's opt-out words, any
  case), or a tap on the "Stop promotions" button Meta adds to marketing templates, sets
  `customer.sms_opt_out_at`.
  - It applies to **every store's** customer row with that number. The customer messaged
    TejoTime's one WhatsApp number, not a store's; this matches Twilio's Advanced Opt-Out on the
    one shared sender.
  - Nothing is sent back.
  - Ticking the box again on a later visit is a fresh consent and clears the stamp, as it always
    has.
  - Until now nothing ever set `sms_opt_out_at`, so it now means "opted out of these messages, on
    any channel".

Migration **0044** indexes `notification.provider_message_id` (partial, non-null only), which
these lookups use. It is numbered 0044 because 0042 and 0043 are taken by the PayPal POS work.

## Environment

All of these are in `backend/src/config/env.ts`. The four `backend/.env*.example` files list
all of them except the template names and language: their defaults already match the approved
templates, so set them only if a template is renamed.
The backend reads them at boot, so restart it after a change.

| Variable | Default | |
|---|---|---|
| `WHATSAPP_ENABLED` | `false` | the only switch that lets a message reach Meta |
| `WHATSAPP_ACCESS_TOKEN` | — | a **system user** permanent token with `whatsapp_business_messaging` |
| `WHATSAPP_PHONE_NUMBER_ID` | — | the sender's **Phone number ID** in WhatsApp Manager (not the number) |
| `WHATSAPP_API_VERSION` | `v23.0` | Graph API version |
| `WHATSAPP_API_BASE_URL` | `https://graph.facebook.com` | only the smoke test changes it; never set it in a deployed environment |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `en` | |
| `WHATSAPP_TEMPLATE_BOOKING_CONFIRMED` / `_APPOINTMENT_REMINDER` / `_REVIEW_REQUEST` | the SMS ids | approved template names |
| `WHATSAPP_COUNTRY_CODES` | `91` | comma-separated calling codes; a typo stops boot |
| `WHATSAPP_TEST_TO` | — | every send goes here; **set it for any local run** |
| `WHATSAPP_APP_SECRET` | — | Meta app → Settings → Basic → App secret |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | — | any string; typed into Meta's webhook setup too |

A blank `VAR=` falls back to the default for the version, base URL, language and template names.

`backend/.env` points at the **live preprod database**, and the reminder sweep runs every minute.
A local backend with `WHATSAPP_ENABLED=true` and a blank `WHATSAPP_TEST_TO` would message real
preprod customers with +91 numbers. Keep `WHATSAPP_TEST_TO` set, or the flag off.

## Going live

1. **Meta:**
   - In WhatsApp Manager, check the three templates are **Approved**, with the names and language
     above.
   - In Business Settings → System users, create a token with `whatsapp_business_messaging` (and
     `whatsapp_business_management`) for the app.
   - Note the sender's Phone number ID.
2. **Deploy** the backend with migration 0044. The Coolify pre-deploy step runs migrations.
3. **Set the env** on the backend service:
   - `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
     `WHATSAPP_WEBHOOK_VERIFY_TOKEN`;
   - leave `WHATSAPP_ENABLED=false` for now;
   - restart.
4. **Webhook.** In the Meta app → WhatsApp → Configuration:
   - Callback URL `https://api.tejotime.com/api/v1/webhooks/whatsapp` (preprod:
     `https://api-preprod.tejotime.com/api/v1/webhooks/whatsapp`);
   - Verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`;
   - subscribe to the **`messages`** field. That one field carries both statuses and incoming
     messages.
5. **Test on preprod.** Set `WHATSAPP_ENABLED=true` and `WHATSAPP_TEST_TO=<your +91 number>`, then
   restart. Book on a store page with the box ticked, then check:
   - the backend log shows `WhatsApp message sent`;
   - the `notification` row is `whatsapp`/`sent` and soon after `delivered`;
   - replying STOP sets `sms_opt_out_at`.
6. **Production.** Set `WHATSAPP_ENABLED=true` with `WHATSAPP_TEST_TO` blank, then restart.

**Reading a failure.** A refusal at send time puts `meta_<code>` on the row; a later failure from
the webhook puts `<code>: <title>`. Common codes:

| Code | Meaning |
|---|---|
| `131026` | the number is not on WhatsApp, or cannot receive the message |
| `131030` | a test number not on the app's allowed list (development mode only) |
| `131049` | Meta held back a **marketing** message to protect engagement |
| `132000` / `132001` | template variables or name/language do not match the approved template |
| `190` | the token expired or was revoked |

`131049` deserves attention. `review_request` is likely categorised Marketing, and Meta caps how
many marketing messages one person receives in India. Some review requests may be held back; that
is Meta's decision, not a bug.

## Tests

`cd backend && npm test`:
- `whatsapp.test.ts` covers the seam:
  - the Graph API URL, bearer token and template payload;
  - digits only;
  - the env template names and language;
  - `WHATSAPP_TEST_TO`;
  - the flag off or unset sends nothing;
  - blank credentials;
  - Meta's error code;
  - the country list, and a bad list stopping boot.
- `whatsapp-copy.test.ts` covers the variable order per template, the stand-ins, and that no
  variable is empty or multi-line.
- `message-routing.test.ts` covers the dispatch layer:
  - +91 goes to WhatsApp and +1 to SMS;
  - the flag off gives a deferred WhatsApp row and never an SMS;
  - `WHATSAPP_COUNTRY_CODES`;
  - STOP and an unticked box;
  - the reminder sweep's address stand-in.
- `whatsapp-webhook.test.ts` drives the real `createApp()`:
  - the handshake;
  - signature checks, including re-spaced JSON failing;
  - STOP across stores;
  - status ordering;
  - a 200 even when one update fails.

`npm run test:chat-flow` covers the chat's WhatsApp wording for +91 and the SMS wording for +1.

**End to end: `backend/scripts/smoke-whatsapp.mjs`.** It needs a running API and a seeded
throwaway database, which the script also reads; it refuses `backend/.env`'s database. It runs its
own stand-in for Meta's Graph API on port 8790, and the API is pointed at it with
`WHATSAPP_API_BASE_URL`, so nothing leaves the machine. The phones are +91 5… and +1 555 numbers,
which nobody owns. The script's header has the exact commands.

- With `--expect-disabled`, against an API with `WHATSAPP_ENABLED=false`, it proves the flag:
  - a +91 booking is recorded as a deferred `whatsapp` row;
  - the stand-in receives nothing.
- Without the flag, against `WHATSAPP_ENABLED=true`, it proves:
  - a +91 booking goes to Meta as `booking_confirmed`/`en` with its five variables in order;
  - a +1 booking stays SMS;
  - an unticked box sends nothing;
  - a +91 check-in gets a confirmation, then `review_request` after checkout;
  - the handshake;
  - a signed delivered/failed report moves the row, a forged one is a 401, and a late "delivered"
    does not hide a failure;
  - a STOP (a forged one is refused) blocks the next review request.
- It spends 5 public writes (1 with `--expect-disabled`) and 1 login.

**Last run: 2026-10-23**, on a throwaway database on local Postgres 18:
- `--expect-disabled`: 8 passed, 0 failed;
- the full run: 36 passed, 0 failed.

No real Meta send has been made yet; that is step 5 of [Going live](#going-live).
