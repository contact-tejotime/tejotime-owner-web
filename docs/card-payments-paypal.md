# Card payments on the PayPal reader, and "Paid by" at checkout

**Status:** code written 2026-10-15 on `feat-jay`, not yet run against a database or a real
reader. See [What has and has not been verified](#what-has-and-has-not-been-verified) before
shipping.

**Applies to:**
- backend (migrations 0042, 0043)
- owner-web (records and displays only)
- app, iOS + Android (charges and refunds)

## What the client asked for

The client wants PayPal's POS hardware (paypal.com/us/business/pos-system/hardware) inside
TejoTime. Decisions, all 2026-10-15:

| Decision | Detail |
|---|---|
| US stores, PayPal **Card Reader** | Every store already has a PayPal POS account |
| Only the **main owner** charges and refunds | `app_user.is_super_owner`, on their phone |
| Final amount only | No tips, no tax |
| Refunds | Whole amount, back to the card. Card payments only |
| **US stores only** | "Paid by" and card payments exist only on a **US store**, meaning one priced in **USD** (`business.currency`, set in the admin panel). Every other store checks out exactly as before: no "Paid by" question, no Card payments row, and the API refuses card payments there (409 `CARD_PAYMENTS_US_ONLY`) |
| **"Paid by" is required** on a US store's checkout **while Card payments is switched on** | **Card · Cash** only. The first version offered more (USD: Venmo · Zelle · Cash App · Other; others: UPI · Other). Those codes stay valid in the database, so widening the list is a code change, not a migration |
| **Card payments off = the old checkout** (client 2026-10-16) | A US store that has not switched Card payments on (Settings → Card payments), or has switched it off, gets no "Paid by" question: Complete & start next is ready as soon as the bill is, exactly as before |
| Staff and co-owners cannot pick Card | Once card charging is on, they leave the customer for the main owner |
| A refund takes money out | Leaves revenue, the stylist's commission and the customer's total spend, **on the original visit's day** |
| A refunded visit still counts | It is still a completed visit in every count |

## Why the website cannot charge cards

PayPal sells two devices. The **Terminal** runs only PayPal's own app and cannot be integrated at
all. The **Card Reader** can, but only through PayPal's native **Zettle Payments SDK** on a phone,
over Bluetooth. There is no web or server API that starts a charge on a reader. The older PayPal
Here SDK is deprecated and takes no new integrations.

So card charging lives in the app, and owner-web only records and shows. That is a deliberate
exception to the "owner surfaces move together" rule (CLAUDE.md §11.1); see
[owner-web-app-parity.md](./owner-web-app-parity.md).

PayPal POS is not offered in India, and the client wants all of this for US stores only. A store
that is not priced in USD (an INR store, for example) sees none of it.

## How it works

### Which stores: US stores only

**Two rules decide it:**
- **A store is a US store** when `business.currency` is `USD`. That's `isUsStore` in
  `backend/src/domain/enums.ts` and in both `lib/checkout-amount.ts` copies. Only a US store can
  have card payments, so this decides the Settings row.
- **"Paid by" is asked only while the US store has Card payments switched on** (client
  2026-10-16). That's `paidByAsked` / `paidByChoices` in both `lib/checkout-amount.ts` copies,
  fed by the billing's `cardPaymentsEnabled` from `GET /queue/:id`. The API already reports that
  flag as off on any store that isn't a US store.

| | US store, Card payments **on** | US store, Card payments **off** (the default) | Any other store |
|---|---|---|---|
| "Paid by" on checkout | Card · Cash, required | **not shown**: the old checkout, Complete as before | **not shown**: the old checkout |
| A `paymentMethod` sent to the API | `card` / `cash` accepted, others 400 | `card` / `cash` still accepted, so a sheet opened before the switch still lands; others 400 | any method → 400 (a bare checkout works as always) |
| Settings → Card payments row and page | main owner | main owner, to switch it on | **hidden**; the page redirects to Settings |
| `PUT /card-payments/settings {enabled: true}`, `POST /card-payments` | allowed (main owner) | allowed (main owner) | **409 `CARD_PAYMENTS_US_ONLY`** |
| `cardPaymentsEnabled` (GET /business, GET /queue/:id, settings) | `true` | `false` | always `false`, even if the column was left on from before a currency change |

Completing, failing and refunding a charge are **not** US-gated. If a store changes currency with
a charge already taken, that money is still recorded and can still be refunded.

### "Paid by" (0042) — all three owner surfaces, US stores with Card payments on

- **The sheet.** Under the bill, the checkout sheet of a US store **with Card payments switched
  on** asks "Paid by". Nothing is pre-picked, and Complete stays disabled until a method is chosen.
  Every other sheet doesn't ask, including a US store that has it off.
- **History.** On 2026-10-15 every US store was asked. On 2026-10-16 the client narrowed it:
  "only when card payments is on from Settings; if off, as the old version, nothing asked,
  Complete & start next enabled directly".
- **The lists.** What a store *may record* depends on its currency (`paymentMethodsFor`). It is
  hand-kept in three places and pinned by `npm run test:checkout`, which also compares it with
  the backend's list:
  - `backend/src/domain/enums.ts`
  - `owner-web/src/lib/checkout-amount.ts`
  - `app/src/lib/checkout-amount.ts`
- **Storage.** The answer is stored on `visit.payment_method`.
- **Old app builds.** Builds already on phones send no method. The API still accepts that, and
  the visit reads "not recorded". A method the store doesn't offer is a 400: anything but Card or
  Cash on a US store, and any method at all elsewhere.
- **Asking vs accepting.** The API checks the method against the currency only, not the switch. A
  Cash picked on a sheet that was open when the owner switched card payments off is a true answer,
  so it is recorded rather than failing the checkout.
- **Builds from 2026-10-15** (before the narrowing) ask "Paid by" on every US store. Their answers
  are still accepted, so nothing breaks; they just ask when they no longer need to.
- **Widening it later.** Change `paymentMethodsFor` in all three files; the
  `ck_visit_payment_method` check already allows the other codes.

### Card on the reader (0043) — the app, main owner only

1. The main owner picks **Card** on a store with card payments on, on a phone signed in to PayPal.
   The button becomes **"Charge $45 on the card reader"**.
2. `POST /card-payments` creates a `pending` row. Its id is the **reference** handed to the reader.
3. PayPal's SDK takes the card. Tipping is always off.
4. `POST /card-payments/:id/complete` records it **and** completes the visit in one database
   transaction (`card_payment_complete`). The visit banks what the card was actually charged.
5. A decline or a cancel calls `.../fail`, and the visit can be finished another way.

Below the charge button, **"Charged outside TejoTime"** records a card the owner charged in
PayPal's own app (for a flat reader). It is a plain checkout with `paymentMethod: card`.

### Who may record Card

| Card charging | Main owner | Co-owner / staff |
|---|---|---|
| off (default) | Card is a plain record | Card is a plain record |
| on | charges on the reader, or records "charged outside" | **Card disabled**: "Card payments are taken on the owner's phone" (API: 403 `CARD_OWNER_ONLY`) |

`GET /queue/:id` returns three fields:
- **`cardAllowed`**, answered for whoever asks, so neither client keeps its own copy of the rule;
- `cardPaymentsEnabled`;
- `pendingCardPayment`.

### The rule: once money has moved, record it

- **A charge in flight blocks the visit.** While a charge is in flight (a `pending` row younger
  than **15 minutes**):
  - `queue_checkout` and `queue_no_show` refuse that visit with 409 `CARD_PAYMENT_IN_PROGRESS`;
  - both sheets show "The owner is taking this customer's card payment";
  - the 4-hour stale sweep skips the visit.
- **An abandoned attempt stops blocking after 15 minutes.** An attempt left behind by a crashed
  phone does not lock the chair for the day.
- **The server never refuses a card the reader approved.** If the visit was finished or cancelled
  meanwhile, or the reader charged a different amount, the payment is still written `paid`. It is
  flagged **`needs_review`** with no visit, and the owner refunds or keeps it.
- **A lost result stays pending.** The app was killed mid-charge, or the network was down when the
  result came back: the row stays `pending` and is never failed on a guess. On the next launch,
  `recoverPendingCardPayments` asks the reader about each pending reference and records or fails
  it. Settings → Card payments has **Check with PayPal** and **It was not charged** for the rest.
- **A repeat is harmless.** Starting twice returns the same reference. Before re-charging a
  reference, the app asks the reader whether it already went through. Completing or refunding
  twice changes nothing.

### Refunds

From the app only, on Settings → Card payments, and always the whole amount:

1. The reader refunds first.
2. `card_payment_refund` then marks the payment `refunded` and sets `visit.refunded_at`.
3. It reduces `customer.total_spend_paise` by the visit amount. `visits_count` is unchanged.

A refund made in PayPal's own app is not seen by TejoTime.

### What a refund does to the figures

A refunded visit stays in every list. Its money leaves every sum, and every count keeps it.

| Figure | Where | Change |
|---|---|---|
| Revenue (Home, Reports, per stylist) | `dashboard.routes.ts` | `sum(...) filter (where refunded_at is null)` |
| Stylist commission | `visit_commission` view | `commission_paise` = 0 for a refunded visit; the row stays; `refunded_at` appended |
| Commission revenue | `commission.service.ts` | filtered the same way |
| Admin analytics | 0010 functions, recreated in 0043 | revenue sums filtered, counts unchanged |
| Customer total spend | `card_payment_refund` | reduced |
| Lists (customer history, commission visits, admin ledger) | DTOs | `refunded: true`; owner-web's commission list says "Refunded · no commission" |

Past reports change: a refund takes the money out of the visit's own day, even if that period's
commission was already paid. This was the client's choice ([staff-commission.md](./staff-commission.md)).

## Data model

| Migration | What |
|---|---|
| 0042 | `visit.payment_method` (text + check). `queue_checkout` gains `p_payment_method`; the 3-argument version is dropped after the create (overload trap) |
| 0043 | Store columns: `business.card_payments_enabled`, `paypal_org_ref` |
| 0043 | Visit columns: `visit.refunded_at`, `refunded_by` |
| 0043 | `card_payment` table: one row per attempt, its id is the reference; unique pending row per visit |
| 0043 | `card_payment_start`, `card_payment_complete`, `card_payment_refund` |
| 0043 | `queue_checkout` and `queue_no_show` get the pending guard, with their signatures unchanged |
| 0043 | `visit_commission` gets refunds; the 0010 admin functions get refund-aware revenue |

`card_payment` stores the brand and **last four digits only**, never the masked card number. The
schema and the app's mapping both enforce it.

## API — `/api/v1/card-payments`, main owner only (`requireSuperOwner`)

Everyone else gets 403 from every route.

| Route | Does |
|---|---|
| `GET /settings` · `PUT /settings {enabled, paypalOrgRef?}` | Card charging on/off, and the PayPal account it was turned on with |
| `POST / {queueEntryId, amountPaise}` | Start a charge, returning `{payment, resumed}` |
| `POST /:id/complete {providerPaymentId?, cardBrand?, cardLast4?, entryMode?, chargedAmountPaise?}` | Approved: paid + visit completed, returning the board like a checkout |
| `POST /:id/fail {reason}` | Declined, cancelled, or given up |
| `POST /:id/refund {refundReference?}` | Refunded on the reader |
| `GET /?status=&needsReview=&limit=` | Recent attempts, newest first |

The card details come from the owner's own phone. The API cannot check them with PayPal. That is
the same trust as the amount box at every checkout, and only the merchant whose PayPal account
takes the money can call these routes.

## The surfaces

- **owner-web.**
  - "Paid by" on the checkout sheet.
  - Card rules as above, but the web never charges: the main owner's Card means "charged
    outside".
  - The pending banner.
  - Settings → **Card payments**, a read-only status and list, main owner only.
  - "Refunded" on the commission visit list.
- **App (iOS + Android).**
  - "Paid by".
  - Charge on the reader.
  - Settings → **Card payments** (main owner, hidden on the web target): sign in to PayPal, turn
    on, pair the reader (PayPal's own screen), recent payments with Refund / Check with PayPal /
    It was not charged.
  - Recovery on launch.

## The native module — `app/modules/paypal-reader`

A local Expo module, autolinked from `app/modules/`:
- Swift and Kotlin wrappers around PayPal's SDK.
- A config plugin, `app.plugin.js`, registered in `app.json`.
- JS reaches it only through `app/src/lib/card-reader.ts`, which uses
  `requireOptionalNativeModule`. Expo Go, the web target and older builds simply have no card
  reader.

| | iOS | Android |
|---|---|---|
| SDK | `iZettleSDK` **4.70.4**, CocoaPods (public) | `com.zettle.sdk:core` + `feature.cardreader:ui` **2.52.0**, GitHub Packages |
| Needs | nothing extra | **`GITHUB_PACKAGES_TOKEN`** (a GitHub PAT with `read:packages`), in the environment of every Android build — EAS secret for cloud builds, exported for `npm run build:*` |
| Written from | PayPal's example app, `iZettle/sdk-ios` `Example/` | PayPal's example app, `iZettle/sdk-android` `Examples/Example-Kotlin` |

**Config (`app/.env*`):**
- `EXPO_PUBLIC_PAYPAL_CLIENT_ID_IOS` and `_ANDROID`: one app per platform on PayPal's developer
  portal, developer.zettle.com. They are not secrets.
- `EXPO_PUBLIC_PAYPAL_REDIRECT_URL` (default `tejotime-paypal://login.callback`). It must equal the
  plugin's `redirectUrl` and the redirect registered on the portal. It has its own scheme, because
  expo-router owns `tejotime://`.
- `EXPO_PUBLIC_PAYPAL_DEV_MODE`: PayPal's **developer mode** answers charges and refunds with no
  merchant account and no money, from any country. It is how this is tested from India.
  - `true` for local and preprod; **never** in production.
  - The Card payments screen shows a banner while it is on.

**Not declared:** `UISupportedExternalAccessoryProtocols`. It is only for PayPal's older
Bluetooth-classic reader, and it would make Apple ask PayPal to register the app (MFi) before
review. The plugin can add it with `externalAccessory: true`.

**App Store:** guideline 3.1.3(e) lets an app take payment outside in-app purchase for services
used outside the app (a haircut). Reviewers have no reader, so the submission needs review notes
and a short video of a charge.

## Testing

| What | Command | Needs |
|---|---|---|
| "Paid by" + card rule, HTTP boundary | `cd backend && npx vitest run tests/unit/queue-payment-method.test.ts tests/unit/card-payments-routes.test.ts` | nothing |
| Method lists agree (app, web, API) | `npm run test:checkout` | nothing |
| "Paid by" end to end | `node backend/scripts/smoke-payment-method.mjs` | running API + seeded **throwaway** DB + an admin login |
| Card flow end to end (reader simulated) | `node backend/scripts/smoke-card-payments.mjs` | running API + seeded **throwaway** DB + an admin login |
| Real charges | manual checklist below | a native build, PayPal client ids, dev mode or a real reader |

**The US store in the end-to-end scripts.**
- The seeded `sharp-cuts` store is priced in rupees, so it covers the "not a US store" side.
- For the US side, each script **creates its own US store through the admin API** and deactivates
  it at the end. Its owner is therefore a real main owner.
- **The admin login:** `SMOKE_ADMIN_MOBILE` / `SMOKE_ADMIN_PASSWORD` or `SMOKE_ADMIN_TOKEN`. By
  default it is the demo admin `npm run migrate` gives a throwaway database (`919399385943` /
  `admin456`).
- **They never change an existing store's currency.** The admin store save is a full save that
  rebuilds hours, services and staff.

`smoke-payment-method.mjs` covers:
- **The rupee store:** Card and Cash are refused, and the old bare checkout works.
- **The US store:**
  - A new store reports Card payments off (so the sheets ask nothing) and checks out the old way.
  - Switched on, it reports on, and Card and Cash are recorded on the visit and its history.
  - Switched off again, it reports off, and a Cash from a sheet opened before the switch still lands.
  - UPI, Venmo, Other and unknown methods are refused, and a bare checkout from an old app still works.
- Last run 2026-10-16: **53 passed, 0 failed** (local throwaway DB `tejotime_card_smoke`, API on
  port 8090).

`smoke-card-payments.mjs` covers:
- US stores only: the rupee store can't turn card payments on (409 `CARD_PAYMENTS_US_ONLY`) and
  reads them as unavailable;
- main owner only, and off by default;
- the pending guard;
- paid completes the visit, and a repeated report changes nothing;
- decline;
- a late charge recorded as needs review;
- a refund taking revenue and commission out while counts stay;
- turning card charging off.

**Manual device checklist** (iOS **and** Android, dev mode first, then one real $1 charge and
refund in the US):
1. Sign in to PayPal.
2. Turn card charging on.
3. Pair the reader.
4. Charge.
5. Decline.
6. Cancel on the reader.
7. Kill the app mid-charge, then relaunch: it should be recovered.
8. Refund.
9. A staff phone shows Card disabled.
10. A second phone shows the "charging" banner.
11. owner-web shows the method, the banner, the Refunded tag and the list.

## What has and has not been verified

**Run, 2026-10-15:**
- backend typecheck: clean apart from 2 errors in an untouched test file, `store-drafts.test.ts`;
- backend unit tests: 553 passed (534 existing + 19 new);
- backend lint;
- `npm run test:checkout`: 138 checks;
- owner-web: `tsc` + `eslint` on the changed files;
- app: `tsc` + `eslint` on the changed files;
- `npx expo config --type introspect`: the plugin writes the Info.plist keys and the Android OAuth
  activity, and `paypal-reader` autolinks.

**Run on a throwaway local Postgres 18.4 (`tejotime_card_smoke`, API on :8090), 2026-10-15:**
- every migration 0001–0043 from empty. 0042 and 0043 also re-run cleanly a second time.
- **one** `queue_checkout` signature afterwards, `(uuid, uuid, bigint, text)`, so the overload
  trap is avoided;
- the seed;
- `smoke-payment-method.mjs` 35/35 and `smoke-card-payments.mjs` 67/67;
- regressions: `smoke-seatless.mjs` 20/20, `smoke-commission-db.mjs` 31/31,
  `smoke-checkout-addons.mjs` 84/84, `smoke-commission.mjs` 60/60.
  - The commission script first read 429s, because it ran straight after the add-ons script and
    used up the in-memory owner-write limit. A restarted API fixed that.
  - It also had an old wrong path for `/auth/me` (`permissions` sits under `user`), fixed in the
    same change.

**After the US-only change, the same day:**
- backend unit tests 556/556 (44 files);
- `npm run test:checkout` 150 checks;
- `smoke-payment-method.mjs` 40/40, `smoke-card-payments.mjs` 76/76;
- `smoke-checkout-addons.mjs` 84/84;
- owner-web and app `tsc` + `eslint` clean.

**Preprod was migrated through 0043 on 2026-10-15** (`npm run migrate`, nothing else). **Never**
seed preprod: that deletes the `sharp-cuts` store.

Any backend from this branch needs a database migrated through 0043. Pointed at an older one, it
fails:
- the admin store overview returns 500 on `visit.refunded_at`;
- checkout fails on the 4-argument `queue_checkout`.

That happened once, on 2026-10-15: a local `npm run dev` read preprod from `backend/.env` before
preprod was migrated.

**Not run yet:**
- **The native module has never been compiled.** It needs:
  - a Mac for iOS;
  - the GitHub token for Android;
  - PayPal client ids for both.
- **Spike items to settle on the first build:**
  - the exact names of the iOS `iZettleSDKPaymentInfo` properties used;
  - how the iOS SDK reports a cancel;
  - the Android signed-in account's property names (read reflectively, so a wrong guess gives
    null rather than a broken build);
  - whether Kotlin 2.1 (RN 0.85) reads the SDK's Kotlin 2.2 metadata, or needs
    `expo-build-properties` `android.kotlinVersion`.
