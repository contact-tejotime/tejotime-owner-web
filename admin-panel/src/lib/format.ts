import { currencySymbol } from "./currencies";
import type { Money } from "./types";

/**
 * Display formatting for analytics values. Pure functions — safe in both server
 * and client components. Money arrives as integer minor units (e.g. 100 paise = ₹1)
 * plus the store's ISO currency code, which picks the symbol and notation:
 * INR keeps en-IN grouping + L/Cr compact; other currencies use en-US + k/M.
 */

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Minor units → major-unit number, for chart props and math. */
export function rupees(m: Money): number {
  return m.amount / 100;
}

/** Major-unit number → ₹1,840 / $1,840 (symbol + grouping from the currency code). */
export function formatAmount(value: number, currency: string): string {
  const grouped = (currency === "INR" ? inr : usd).format(Math.round(value));
  return `${currencySymbol(currency)}${grouped}`;
}

/** Major-unit number → compact notation: INR ₹840/₹18.4k/₹4.2L/₹1.2Cr; others $840/$18.4k/$4.2M. */
export function formatAmountCompact(value: number, currency: string): string {
  const sym = currencySymbol(currency);
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const short = (v: number, suffix: string) => {
    const n = Math.round(v * 10) / 10;
    return `${sign}${sym}${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}${suffix}`;
  };
  if (currency === "INR") {
    if (abs >= 1_00_00_000) return short(abs / 1_00_00_000, "Cr");
    if (abs >= 1_00_000) return short(abs / 1_00_000, "L");
    if (abs >= 1_000) return short(abs / 1_000, "k");
    return `${sign}${sym}${inr.format(Math.round(abs))}`;
  }
  if (abs >= 1_000_000) return short(abs / 1_000_000, "M");
  if (abs >= 1_000) return short(abs / 1_000, "k");
  return `${sign}${sym}${usd.format(Math.round(abs))}`;
}

/** Full amount in the money's own currency: ₹1,840 / $1,840. */
export function formatMoney(m: Money): string {
  return formatAmount(rupees(m), m.currency);
}

/** Compact amount in the money's own currency: ₹4.2L / $4.2M. */
export function formatMoneyCompact(m: Money): string {
  return formatAmountCompact(rupees(m), m.currency);
}

/** ISO or YYYY-MM-DD → "10 Jun" (axis ticks / tooltip labels). */
export function formatDayShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Ratio (0..1) → "42%"; null/undefined → "—". */
export function formatPercent(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${Math.round(x * 100)}%`;
}

/** ISO → "9 Jul 2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** ISO → "9 Jul 2026, 2:30 pm". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** ISO → relative label: Today / 3d ago / 2w ago / 5mo ago; null → "Never". */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Never";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days < 7) return `${days}d ago`;
  if (days < 35) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Whole number with Indian grouping: 3,847. */
export function formatCount(n: number): string {
  return inr.format(n);
}

/** True when the timestamp is older than `days` days (false for null/invalid). */
export function isOlderThanDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return false;
  return Date.now() - then.getTime() > days * 86_400_000;
}
