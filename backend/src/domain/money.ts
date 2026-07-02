import { env } from '../config/env';

/** Money is always integer minor units (paise). See docs/02 §NFR-UX3. */
export interface Money {
  amount: number;
  currency: string;
}

export const money = (amount: number, currency = env.DEFAULT_CURRENCY): Money => ({
  amount: Math.round(amount),
  currency,
});

/** Parse "₹1,200" / "₹350" / "₹6.2k" → paise. Used when seeding from the mock. */
export function parsePriceToPaise(input: string): number {
  const raw = input.replace(/[₹,\s]/g, '').toLowerCase();
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
