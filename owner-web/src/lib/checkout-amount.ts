/**
 * The checkout sheet's amount arithmetic — what the box starts at, how it moves when an add-on is
 * put on or taken off, and what Complete & start next charges (docs/checkout-add-ons.md).
 *
 * The box means one of two things, decided by the booked service's pricing mode:
 *
 *   fixed        → the box is the WHOLE BILL. It starts at the server's suggestion (service +
 *                  add-ons) and moves by an add-on's price as it goes on or off, so a figure
 *                  typed by hand is corrected, never thrown away.
 *   range/unset  → the box is the BOOKED SERVICE'S price only. There is no honest figure for it,
 *                  so it starts empty; the add-ons are added on top and the sheet shows the sum as
 *                  "Total to charge". That sum is what gets banked.
 *
 * The second mode is the client's bug of 2026-10-06: an unpriced "Hair cut" with ₹180 of add-ons
 * showed an empty box and no total at all, because the server (rightly) suggests nothing when the
 * main service has no price — and nothing on either surface added up the parts that DID.
 *
 * An entry with no service at all reports `unset` until it has an add-on and `fixed` (service 0)
 * after, so the box flips meaning there. `boxAfterExtrasChange` moves it by the add-on's price on
 * either side of the flip, which is exactly right: with no add-ons, "the service's price" and
 * "the whole bill" are the same number.
 *
 * Hand-kept copies: `owner-web/src/lib/checkout-amount.ts` and `app/src/lib/checkout-amount.ts`
 * must agree, and `npm run test:checkout` runs both through one case table. Keep this file free of
 * imports so that check can run it as plain TypeScript.
 */

export type CheckoutPriceType = "fixed" | "range" | "unset";

/** The parts of `GET /queue/:id` this arithmetic reads. Amounts are paise. */
export interface CheckoutBilling {
  servicePriceType: CheckoutPriceType;
  extrasAmount: { amount: number };
  suggestedAmount: { amount: number } | null;
}

/** True when the box holds the whole bill; false when it holds only the booked service's price. */
export function boxIsTotal(billing: Pick<CheckoutBilling, "servicePriceType">): boolean {
  return billing.servicePriceType === "fixed";
}

/**
 * Typed rupees → paise. Null for empty, unreadable or negative. Math.round keeps 249.99 from
 * arriving as 24998.999999999996.
 */
export function parseRupees(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Paise → the rupee string the box shows: "350", or "349.5" when there are paise. */
export function rupeesText(paise: number): string {
  return String(Math.round(paise) / 100);
}

/** What the box shows when the sheet opens. */
export function initialBox(billing: CheckoutBilling): string {
  return boxIsTotal(billing) && billing.suggestedAmount ? rupeesText(billing.suggestedAmount.amount) : "";
}

/**
 * The box after an add-on went on or came off. `before`/`next` are the billing either side of it.
 *
 * Moves by the change in the add-ons' total rather than re-syncing to the new suggestion, so an
 * amount the owner already corrected by hand survives — that correction is the one thing the box
 * exists for. A box holding only the service's price is left alone: the total below it moves.
 */
export function boxAfterExtrasChange(text: string, before: CheckoutBilling, next: CheckoutBilling): string {
  if (!boxIsTotal(before) && !boxIsTotal(next)) return text;
  const typed = parseRupees(text);
  if (typed === null) {
    return boxIsTotal(next) && next.suggestedAmount ? rupeesText(next.suggestedAmount.amount) : text;
  }
  const delta = next.extrasAmount.amount - before.extrasAmount.amount;
  return rupeesText(Math.max(0, typed + delta));
}

/**
 * What Complete & start next banks, in paise — the box as the whole bill, or the service's price
 * plus the add-ons. Null when the box is empty or unreadable: nothing is charged until someone has
 * decided what the service cost.
 */
export function chargePaise(text: string, billing: CheckoutBilling): number | null {
  const typed = parseRupees(text);
  if (typed === null) return null;
  return boxIsTotal(billing) ? typed : typed + billing.extrasAmount.amount;
}

/**
 * Whether an add-on chip is on — it is highlighted, and a tap takes it off. Case-insensitive,
 * like the server's catalog lookup and `queue_extend`'s one-per-label rule (0039).
 */
export function isExtraOn(extras: readonly { label: string }[], label: string): boolean {
  const key = label.trim().toLowerCase();
  return extras.some((x) => x.label.trim().toLowerCase() === key);
}
