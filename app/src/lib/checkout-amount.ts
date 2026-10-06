/**
 * The checkout sheet's amount arithmetic: what "Amount to charge" starts at, how it moves when an
 * add-on or a typed service price changes, and when Complete & start next may be pressed
 * (docs/checkout-add-ons.md).
 *
 * The box is always the WHOLE BILL, and Complete charges exactly what it holds.
 *
 *   fixed        → it starts at the server's suggestion (service + add-ons).
 *   unset        → the service has no price, so its breakdown row asks for one (a REQUIRED price),
 *                  and Complete stays disabled until it is filled. The box starts at what IS known
 *                  (the add-ons) and the typed price is added into it.
 *   range        → no required row (the client's call): the box starts at the add-ons' total and
 *                  the owner adds what the service cost, by hand.
 *
 * Required prices are not only for the first-picked service. A no-price service picked SECOND is
 * an add-on row stored at ₹0, and the server flags it `priceRequired` (migration 0040) — otherwise
 * "Hair wash, then Hair cut" banked a free haircut while "Hair cut, then Hair wash" asked for it.
 *
 * Whenever something on the bill changes, the box MOVES by that change rather than resetting to a
 * fresh total. So a figure the owner corrected by hand (a discount, a round number) survives every
 * later add-on and every typed price; that correction is the one thing the box exists for.
 *
 * History (all 2026-10-06, all from the client on preprod): a separate "Hair cut price" box with a
 * "Total to charge" row was rejected for the single box holding the total; then the box alone let
 * a haircut be completed unpriced, hence the required row and the disabled button.
 *
 * Hand-kept copies: `owner-web/src/lib/checkout-amount.ts` and `app/src/lib/checkout-amount.ts`
 * must agree, and `npm run test:checkout` runs both through one case table. Keep this file free of
 * imports so that check can run it as plain TypeScript.
 */

export type CheckoutPriceType = 'fixed' | 'range' | 'unset';

/** The parts of `GET /queue/:id` this arithmetic reads. Amounts are paise. */
export interface CheckoutBilling {
  /** The booked (first-picked) service on its own; null when the visit has none. */
  serviceName: string | null;
  servicePriceType: CheckoutPriceType;
  serviceAmount: { amount: number };
  extrasAmount: { amount: number };
  suggestedAmount: { amount: number } | null;
  extras: readonly { id: string; label: string; priceRequired?: boolean }[];
}

/** The API refuses a checkout above this (`checkoutSchema`), so nothing above it is an amount. */
export const MAX_AMOUNT_PAISE = 100_000_000;

/** The required-price key of the booked service; an add-on row's key is its id. */
export const SERVICE_KEY = 'service';

/** Typed prices for the required rows, by key. Rupees as typed, so a field can be empty. */
export type TypedPrices = Readonly<Record<string, string>>;

/**
 * Typed rupees → paise. Null for empty, unreadable, negative or over the API's cap. Math.round
 * keeps 249.99 from arriving as 24998.999999999996.
 */
export function parseRupees(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  const paise = Math.round(value * 100);
  return paise > MAX_AMOUNT_PAISE ? null : paise;
}

/** Paise → the rupee string the box shows: "350", or "349.5" when there are paise. */
export function rupeesText(paise: number): string {
  return String(Math.round(paise) / 100);
}

/**
 * The rows whose price somebody has to type before the visit can be completed: the booked service
 * when it has no price, and every add-on row the server flags as a no-price service.
 */
export function requiredItems(billing: CheckoutBilling): { key: string; label: string }[] {
  const items: { key: string; label: string }[] = [];
  if (billing.servicePriceType === 'unset' && billing.serviceName) {
    items.push({ key: SERVICE_KEY, label: billing.serviceName });
  }
  for (const x of billing.extras) if (x.priceRequired) items.push({ key: x.id, label: x.label });
  return items;
}

/**
 * Everything on the bill that already has a price: the server's suggestion when it has one;
 * otherwise a fixed service's own price plus the add-ons (no-price rows are stored at 0, so they
 * add nothing until someone types them).
 */
export function knownPaise(billing: CheckoutBilling): number {
  if (billing.suggestedAmount) return billing.suggestedAmount.amount;
  const service = billing.servicePriceType === 'fixed' ? billing.serviceAmount.amount : 0;
  return service + billing.extrasAmount.amount;
}

/** The sum of the typed required prices that are valid, for the rows this billing still has. */
export function typedPaise(billing: CheckoutBilling, typed: TypedPrices): number {
  return requiredItems(billing).reduce((sum, item) => sum + (parseRupees(typed[item.key] ?? '') ?? 0), 0);
}

/** What the box shows when the sheet opens. Empty when nothing on the bill has a price yet. */
export function initialBox(billing: CheckoutBilling): string {
  const paise = knownPaise(billing);
  return paise > 0 ? rupeesText(paise) : '';
}

/**
 * Move the box by `deltaPaise`. An empty or unreadable box is seeded instead, from everything
 * known plus `typedSum` (the typed required prices after the change). A box that comes down to 0
 * with no server suggestion goes back to empty: the visit must not sit one tap from a ₹0 bill.
 */
function moveBox(text: string, deltaPaise: number, billing: CheckoutBilling, typedSum: number): string {
  const current = parseRupees(text);
  if (current === null) {
    const seeded = knownPaise(billing) + typedSum;
    return seeded > 0 ? rupeesText(seeded) : '';
  }
  const moved = Math.max(0, current + deltaPaise);
  return moved === 0 && !billing.suggestedAmount ? '' : rupeesText(moved);
}

/**
 * The box after an add-on went on or came off. `before`/`next` are the billing either side of it.
 * `droppedTyped` is what had been typed into required rows that are gone in `next` (a booked
 * no-price service whose chip was tapped off) — it comes out of the box with the row.
 */
export function boxAfterExtrasChange(
  text: string,
  before: CheckoutBilling,
  next: CheckoutBilling,
  typed: TypedPrices = {},
  droppedTyped = 0,
): string {
  const delta = next.extrasAmount.amount - before.extrasAmount.amount - droppedTyped;
  return moveBox(text, delta, next, typedPaise(next, typed));
}

/**
 * The box after a required row's typed price changed from `fromText` to `toText`. `typed` is the
 * set of typed prices AFTER the change. An unreadable value counts as nothing typed.
 */
export function boxAfterPriceChange(
  text: string,
  billing: CheckoutBilling,
  fromText: string,
  toText: string,
  typed: TypedPrices,
): string {
  const delta = (parseRupees(toText) ?? 0) - (parseRupees(fromText) ?? 0);
  return moveBox(text, delta, billing, typedPaise(billing, typed));
}

/** Required rows still empty or unreadable, by label, for the "Enter the price for …" line. */
export function missingLabels(billing: CheckoutBilling, typed: TypedPrices): string[] {
  return requiredItems(billing)
    .filter((item) => parseRupees(typed[item.key] ?? '') === null)
    .map((item) => item.label);
}

/** Complete & start next is allowed only with a readable total and every required price typed. */
export function canComplete(text: string, billing: CheckoutBilling, typed: TypedPrices): boolean {
  return parseRupees(text) !== null && missingLabels(billing, typed).length === 0;
}

/**
 * Whether to show the server's "Suggested" figure under the bill: only when the box no longer
 * matches it (the owner changed a fixed price), as a reference. Otherwise it would just repeat
 * the total line.
 */
export function suggestionDiffers(text: string, billing: CheckoutBilling): boolean {
  return !!billing.suggestedAmount && parseRupees(text) !== billing.suggestedAmount.amount;
}

/**
 * Whether an add-on chip is on — it is highlighted, and a tap takes it off. Case-insensitive,
 * like the server's catalog lookup and `queue_extend`'s one-per-label rule (0039).
 */
export function isExtraOn(extras: readonly { label: string }[], label: string): boolean {
  const key = label.trim().toLowerCase();
  return extras.some((x) => x.label.trim().toLowerCase() === key);
}
