/**
 * The checkout sheet's amount arithmetic: what "Amount to charge" starts at, and how it moves when
 * an add-on is put on or taken off (docs/checkout-add-ons.md).
 *
 * The box is always the WHOLE BILL, and Complete & start next charges exactly what it holds.
 *
 *   fixed        → it starts at the server's suggestion (service + add-ons).
 *   range/unset  → there is no price for the booked service, so it starts at the add-ons' total
 *                  (empty when there are none). The owner adds what the service cost, by hand.
 *
 * When an add-on goes on or off, the box moves by that add-on's price, not back to a fresh
 * suggestion. So a figure the owner already corrected by hand survives; that correction is the one
 * thing the box exists for.
 *
 * Why not a separate box for the service's own price: that was tried on 2026-10-06 (a "Hair cut
 * price" box with a "Total to charge" row under it). The client tried it on preprod the same day
 * and asked for the old single box, holding the total. The bug it fixed stays fixed: an unpriced
 * "Hair cut" with ₹145 of add-ons used to show an empty box, because the server (rightly) suggests
 * nothing for it and nothing on either surface added up the add-ons.
 *
 * Hand-kept copies: `owner-web/src/lib/checkout-amount.ts` and `app/src/lib/checkout-amount.ts`
 * must agree, and `npm run test:checkout` runs both through one case table. Keep this file free of
 * imports so that check can run it as plain TypeScript.
 */

/** The parts of `GET /queue/:id` this arithmetic reads. Amounts are paise. */
export interface CheckoutBilling {
  extrasAmount: { amount: number };
  suggestedAmount: { amount: number } | null;
}

/**
 * Typed rupees → paise. Null for empty, unreadable or negative. Math.round keeps 249.99 from
 * arriving as 24998.999999999996.
 */
export function parseRupees(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Paise → the rupee string the box shows: "350", or "349.5" when there are paise. */
export function rupeesText(paise: number): string {
  return String(Math.round(paise) / 100);
}

/**
 * What the box shows when the sheet opens: the server's suggestion, or for a service with no price,
 * the add-ons' total. Empty when there is neither — nobody has decided anything yet.
 */
export function initialBox(billing: CheckoutBilling): string {
  if (billing.suggestedAmount) return rupeesText(billing.suggestedAmount.amount);
  return billing.extrasAmount.amount > 0 ? rupeesText(billing.extrasAmount.amount) : '';
}

/**
 * The box after an add-on went on or came off. `before`/`next` are the billing either side of it.
 *
 * Moves by the change in the add-ons' total. An empty box is seeded as if the sheet had just
 * opened. A box that comes down to 0 with no server suggestion goes back to empty: taking the last
 * add-on off an unpriced visit must not leave a ₹0 bill one tap from the ledger.
 */
export function boxAfterExtrasChange(text: string, before: CheckoutBilling, next: CheckoutBilling): string {
  const typed = parseRupees(text);
  if (typed === null) return initialBox(next);
  const moved = Math.max(0, typed + next.extrasAmount.amount - before.extrasAmount.amount);
  return moved === 0 && !next.suggestedAmount ? '' : rupeesText(moved);
}

/**
 * Whether an add-on chip is on — it is highlighted, and a tap takes it off. Case-insensitive,
 * like the server's catalog lookup and `queue_extend`'s one-per-label rule (0039).
 */
export function isExtraOn(extras: readonly { label: string }[], label: string): boolean {
  const key = label.trim().toLowerCase();
  return extras.some((x) => x.label.trim().toLowerCase() === key);
}
