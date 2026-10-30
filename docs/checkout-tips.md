# Checkout tips

Client request, 2026-10-29: let the customer tip the stylist at checkout, as a percentage or a fixed
amount. Migration `0046_checkout_tips.sql`.

## The rule

**A tip is not part of the bill.** `visit.amount_paise` stays the service bill only. Revenue,
`visit_commission`, `customer.total_spend_paise` and the admin analytics all read it, so a tip can
never earn commission or inflate revenue. The tip lives beside it, and goes 100% to the chair that
served the visit (`visit.staff_id`).

| Where | Column | Meaning |
|---|---|---|
| `business.tip_enabled` | boolean, default `false` | **Unused.** Added by 0046 for an on/off switch the client then dropped (2026-10-30). Nothing reads or writes it. |
| `visit.tip_paise` | bigint, default 0, `>= 0` | What the customer tipped on this visit. |
| `card_payment.tip_paise` | bigint, default 0, `>= 0` | The tip **inside** a card charge. |

Applies to **every store, in the store's own currency** (rupees, dollars, …). It is not US-only.

## No switch, no permission

The client decided on 2026-10-30 that the tip is **not** a setting. There is no Settings → Tips row, no
`tipEnabled` on `PATCH /business` (the body is `.strict()`, so it is a 400), and no permission to hold: the Tip row is on
the checkout sheet of every store, for every role that can check a visit out, on owner-web and in the app.

## The checkout sheet

Always shown:

- **Tip chips:** `No tip | 10% | 15%` (`TIP_PERCENTS`, one list so another pick is one number).
- **A tip box** with the store's currency symbol, so any amount can be typed (e.g. `10`).
- A **Tip line** in the bill, and **Total to charge = bill + tip**.

The **Tip field is the single source of truth.**

- A % chip fills it with that percent **of the bill** (the "Amount to charge" box) and follows later
  bill changes (an add-on, a typed price, a hand correction).
- Typing in the field takes over: the chip lets go, and the figure is never touched again.
- `No tip` clears both.

The request body is `{ amountPaise: bill, tipPaise, paymentMethod }`. The box is still the bill. A tip
that cannot be sent (junk, negative, or bill + tip over the API cap) blocks Complete, as a bad amount
does. All the arithmetic is `lib/checkout-amount.ts` (`tipTextFor`, `tipFromPercent`, `parseTip`,
`totalWithTip`, `tipOk`), hand-kept in `owner-web` and `app` and pinned by `npm run test:checkout`.

## API

- `POST /queue/:id/checkout` takes an optional `tipPaise` (integer, 0 to 100,000,000). The schema is
  `.strict()`, so the field is declared; it is optional so shipped app builds still work. A negative,
  fractional or oversized tip is 400.
- Nothing gates the tip on a store setting. `GET /queue/:id` and `GET /business` carry no Tips flag.
- `GET /customers/:id/visits` carries each visit's `tip`.
- `queue_checkout(..., p_tip_paise)` gained a trailing parameter. The old four-argument signature is
  dropped in the same migration (the Postgres overload trap behind 0016, 0020 and 0042).

## Card payments (US stores, the PayPal reader)

The reader is charged **bill + tip**. PayPal's own on-reader tipping stays off; the tip is chosen on
the checkout sheet.

- `POST /card-payments { queueEntryId, amountPaise, tipPaise }`: `amountPaise` is the **whole charge**
  and `tipPaise` the part of it that is the tip. `tipPaise` must not exceed `amountPaise` (400).
- `card_payment_complete` banks `charged - tip` as the visit's bill and the tip as its tip. If the
  reader charged less than the tip, the tip is cut to what was charged. The amount mismatch already
  flags the payment for review.
- The app's `chargeVisit(entryId, billPaise, tipPaise)` sums them; `store.chargeCard(id, bill, tip)`.
- **A refund returns the whole charge**, so the tip leaves with it: every report that sums tips
  filters `refunded_at is null`. Customer spend only ever held the bill, so `card_payment_refund` is
  unchanged.
- The **web** never charges a card; it records one already charged. With Card picked it says to
  charge the bill plus the tip.

## Reports

`visit_commission` is dropped and recreated with `tip_paise` appended (a view may only gain columns at
the end, as 0043 did). `commission_paise` is still a percentage of `amount_paise`, the bill.

- `GET /commission/summary`: `tips` on each staff row, on `totals` and on `unassigned`, plus
  nothing else.
- `GET /commission/visits`: `tip` on each visit (0 once refunded), `totals.tips`.
- A staff login gets `scope: 'self'`, so it sees **its own chair's tips and no other chair's**.

Where it shows, **never inside Commission** (owner-web and the app):

- **Reports → Staff breakdown:** a **Tips** row **above** the Commission row on each stylist's card (client
  2026-10-30; first built below it), so Commission sits directly over its own `$12 × 10% = $1.20` line. It
  always shows, even at zero.
- **Commission section:** a note with the store's total tips and that they are not revenue.
- **My earnings (staff login):** a "Tips earned" figure under the commission figure.
- **The visits sheet:** a `Tip $x` line under each visit's commission, and the period total.

Revenue, commission and "Salon keeps" are unchanged by a tip. Salon keeps = revenue - commission, so
the salon never keeps a tip.

## Tests

- `npm run test:checkout` (root): the tip arithmetic in both `checkout-amount.ts` copies.
- `backend/tests/unit/checkout-tips.test.ts`: the checkout schema and the `GET /queue/:id` carrying no flag.
  `commission-summary.test.ts` and `card-payments-routes.test.ts` cover tips in the report and the
  charge.
- `backend/scripts/smoke-tips.mjs`: the real SQL end to end. A running API plus a seeded throwaway DB
  and an admin login for the card half. It covers:
  - there is no switch, and the old `tipEnabled` PATCH is refused;
  - revenue, commission and customer spend ignore the tip;
  - the staff login sees its own tips only;
  - bad tips are refused;
  - a card charge splits into bill and tip, and a refund removes the tip.

## Rollout

Run migration `0046` **before** promoting the new backend image: the new API calls
`queue_checkout(..., p_tip_paise)`. The old API cannot check out on the new schema (the old signature is gone), so
deploy the backend straight after the migration.

## Deliberately not done

- No tip on the public microsite or the customer's phone. The owner (or stylist) picks it at checkout.
- No tip splitting between chairs. It goes to the visit's chair.
- No admin-panel tip figures. Platform analytics read `amount_paise` and are unchanged.
