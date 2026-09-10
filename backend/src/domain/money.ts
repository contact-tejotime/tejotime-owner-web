import { env } from '../config/env';
import type { ServicePriceType } from './enums';

/** Money is always integer minor units (paise). See docs/02 §NFR-UX3. */
export interface Money {
  amount: number;
  currency: string;
}

export const money = (amount: number, currency = env.DEFAULT_CURRENCY): Money => ({
  amount: Math.round(amount),
  currency,
});

/** Parse "₹1,200" / "$350" / "₹6.2k" → minor units. Strips any currency symbol/grouping. */
export function parsePriceToPaise(input: string): number {
  const raw = input.replace(/[^0-9.k-]/gi, '').toLowerCase();
  const k = raw.endsWith('k');
  const n = parseFloat(k ? raw.slice(0, -1) : raw);
  if (Number.isNaN(n)) return 0;
  const rupees = k ? n * 1000 : n;
  return Math.round(rupees * 100);
}

/** Parse "45 min" / "90 min" → minutes. */
export function parseDurationToMinutes(input: string): number {
  const n = parseInt(input, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * A service row's price, resolved into the shape every client renders and the checkout screen
 * reasons about.
 *
 * One function because the three surfaces that show a price — the owner service list, the
 * public microsite and the checkout sheet — previously each decided for themselves what a
 * `price_paise` of 0 meant, and disagreed: the microsite said "Price varies", the checkout
 * sheet banked ₹0. Modes now come out of the database (migration 0024), and the derived
 * `amountRequired` is the single answer to "can this be checked out without asking?".
 */
export interface ServicePricing {
  priceType: ServicePriceType;
  /** The fixed amount, or the range MINIMUM. Zero only when `priceType` is 'unset'. */
  price: Money;
  /** The range maximum. Null in every other mode. */
  priceMax: Money | null;
  /**
   * True when deriving a total would be a guess — a band the shop deliberately left open, or a
   * service nobody has priced. `queue_checkout` raises TEJO:AMOUNT_REQUIRED for exactly these,
   * so a client that ignores the flag still cannot bank a made-up figure.
   */
  amountRequired: boolean;
}

export function servicePricing(
  row: { price_type?: string | null; price_paise?: number | string | null; price_max_paise?: number | string | null },
  currency = env.DEFAULT_CURRENCY,
): ServicePricing {
  // A backend running ahead of migration 0024 has no price_type column; treating the absence as
  // the old rule (priced ⇒ fixed) keeps this readable rather than throwing on a null.
  const min = Number(row.price_paise ?? 0) || 0;
  const rawType = row.price_type ?? (min > 0 ? 'fixed' : 'unset');
  const priceType = (rawType === 'range' || rawType === 'unset' ? rawType : 'fixed') as ServicePriceType;
  const max = row.price_max_paise == null ? null : Number(row.price_max_paise);
  return {
    priceType,
    price: money(min, currency),
    priceMax: priceType === 'range' && max != null ? money(max, currency) : null,
    amountRequired: priceType !== 'fixed',
  };
}
