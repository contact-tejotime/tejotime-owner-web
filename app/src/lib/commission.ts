/**
 * Commission helpers and DTOs for Reports and Settings → Commission rates.
 *
 * The functions below the line marked SHARED are a hand-kept copy of
 * `owner-web/src/lib/commission.ts`, and `npm run test:commission` (repo root) runs both copies
 * through the same cases so the two owner surfaces cannot drift apart. Change both together. This
 * file stays import-free for that reason — the check runs it with plain `tsx`, no Metro, no `@/`.
 *
 * Rates travel as basis points (2000 = 20%), like money travels as paise. Days are `YYYY-MM-DD`
 * STORE-local calendar days that the API already worked out — the app never learns the store's
 * timezone, so nothing here converts one, and nothing here asks the device what day it is.
 */

/* ----------------------------------------------------------------- app: periods + DTOs ----- */

export type ReportRange = 'today' | 'week' | 'month' | 'custom';
export const REPORT_RANGES: ReportRange[] = ['today', 'week', 'month', 'custom'];

/** A Reports period. `from`/`to` only for `custom`. */
export interface ReportQuery {
  range: ReportRange;
  from?: string;
  to?: string;
}

/** `range=custom&from=…&to=…` for the API. */
export function reportQueryString(q: ReportQuery): string {
  const parts = [`range=${q.range}`];
  if (q.range === 'custom' && q.from && q.to) parts.push(`from=${q.from}`, `to=${q.to}`);
  return parts.join('&');
}

interface Money {
  amount: number;
  currency: string;
}

/** A run of days paid at one rate inside the period. `rateBp` null = no rate was set. */
export interface CommissionSegment {
  rateBp: number | null;
  from: string;
  to: string;
  visits: number;
  revenue: Money;
  commission: Money;
}

export interface CommissionStaffRow {
  staffId: string;
  name: string;
  isActive: boolean;
  visits: number;
  revenue: Money;
  commission: Money;
  unratedVisits: number;
  currentRateBp: number | null;
  currentRateFrom: string | null;
  /** The next scheduled change; owners only (null in a stylist's own view). */
  nextRate: { rateBp: number; from: string } | null;
  segments: CommissionSegment[];
}

export interface CommissionSummary {
  range: ReportRange;
  from: string;
  to: string;
  today: string;
  periodLabel: string;
  /** `self` = a staff login reading its own earnings. */
  scope: 'store' | 'self';
  totals: { visits: number; revenue: Money; commission: Money; salonKeeps: Money | null };
  staff: CommissionStaffRow[];
  unassigned: { visits: number; revenue: Money } | null;
}

export interface CommissionVisit {
  id: string;
  completedAt: string;
  /** The store's own day and clock for the visit, worked out by the API. */
  localDate: string;
  localTime: string;
  serviceName: string | null;
  /** Absent for a login without customer access. */
  customerName?: string | null;
  amount: Money;
  rateBp: number | null;
  commission: Money | null;
}

export interface CommissionVisits {
  range: ReportRange;
  from: string;
  to: string;
  today: string;
  periodLabel: string;
  staff: { staffId: string; name: string; isActive: boolean };
  totals: { visits: number; revenue: Money; commission: Money };
  segments: CommissionSegment[];
  data: CommissionVisit[];
  meta: { shown: number; total: number; limit: number };
}

export interface CommissionRateItem {
  rateBp: number;
  from: string;
  /** Last day this rate applies; null while it is the latest. */
  to: string | null;
  /** Today's and future rates can still be replaced or removed; earlier days are locked. */
  editable: boolean;
}

export interface CommissionStaffRates {
  staffId: string;
  name: string;
  current: CommissionRateItem | null;
  upcoming: CommissionRateItem[];
  history: CommissionRateItem[];
}

export interface CommissionRates {
  today: string;
  data: CommissionStaffRates[];
}

/* ---------------------------------------------- SHARED with owner-web/src/lib/commission.ts ---- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A real calendar day written `YYYY-MM-DD`. */
export function isDayKey(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** `YYYY-MM-DD` ± n days, on the calendar. */
export function shiftDayKey(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * What the owner typed into the rate box, as basis points: "20" → 2000, "37.5" → 3750, and
 * "12,25" → 1225 (an iOS decimal pad types a comma in some locales). Null unless it is 0–100 with
 * at most two decimals.
 */
export function parseRateInput(raw: string): number | null {
  const s = raw.trim().replace(/%$/, '').trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}

/** The rate box's text for a stored rate: 2000 → "20", 3750 → "37.5". */
export function rateInputValue(bp: number): string {
  const pct = bp / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0$/, '');
}

/** 2000 → "20%", 3750 → "37.5%", 1225 → "12.25%". */
export function formatRate(bp: number): string {
  return `${rateInputValue(bp)}%`;
}

/** "2026-10-16" → "16 Oct" · with `weekday` "Fri, 16 Oct" · with `year` "16 Oct 2026". */
export function formatDayKey(day: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  if (!isDayKey(day)) return day;
  const d = new Date(`${day}T00:00:00Z`);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${opts.year ? ` ${d.getUTCFullYear()}` : ''}`;
  return opts.weekday ? `${WEEKDAYS[d.getUTCDay()]}, ${date}` : date;
}

/** "14:05" (the store's clock, from the API) → "2:05 PM". */
export function formatClock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2 Oct – 15 Oct"; a single day reads "2 Oct". */
export function formatDayRange(from: string, to: string): string {
  return from === to ? formatDayKey(from) : `${formatDayKey(from)} – ${formatDayKey(to)}`;
}
