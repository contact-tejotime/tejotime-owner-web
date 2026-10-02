/**
 * Commission helpers shared by Reports and Settings → Commission rates.
 *
 * Pure and import-free on purpose: `app/src/lib/commission.ts` is a hand-kept copy of the
 * functions below the line marked SHARED, and `npm run test:commission` (repo root) runs both
 * copies through the same cases so the two owner surfaces cannot drift apart. Change both together.
 *
 * Rates travel as basis points (2000 = 20%), like money travels as paise. Days are `YYYY-MM-DD`
 * STORE-local calendar days that the API already worked out — nothing here converts a timezone,
 * because a Server Component renders on a UTC machine and the store may be anywhere.
 */

/* ------------------------------------------------------------- web-only: the URL ------ */

export type ReportRange = "today" | "week" | "month" | "custom";
export const REPORT_RANGES: ReportRange[] = ["today", "week", "month", "custom"];

/** A Reports period. `from`/`to` only for `custom`. */
export interface ReportQuery {
  range: ReportRange;
  from?: string;
  to?: string;
}

/** Read a period from the page's search params; anything incomplete falls back to Today. */
export function parseReportQuery(p: { range?: string; from?: string; to?: string }): ReportQuery {
  const range = (REPORT_RANGES as string[]).includes(p.range ?? "") ? (p.range as ReportRange) : "today";
  if (range !== "custom") return { range };
  if (isDayKey(p.from) && isDayKey(p.to) && p.from <= p.to) return { range, from: p.from, to: p.to };
  return { range: "today" };
}

/** `range=custom&from=…&to=…` — the API's and the page's query alike. */
export function reportQueryString(q: ReportQuery): string {
  const params = new URLSearchParams({ range: q.range });
  if (q.range === "custom" && q.from && q.to) {
    params.set("from", q.from);
    params.set("to", q.to);
  }
  return params.toString();
}

/* ---------------------------------------------- SHARED with app/src/lib/commission.ts ----- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A real calendar day written `YYYY-MM-DD`. */
export function isDayKey(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
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
 * "12,25" → 1225 (some keypads type a comma). Null unless it is 0–100 with at most two decimals.
 */
export function parseRateInput(raw: string): number | null {
  const s = raw.trim().replace(/%$/, "").trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}

/** The rate box's text for a stored rate: 2000 → "20", 3750 → "37.5". */
export function rateInputValue(bp: number): string {
  const pct = bp / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0$/, "");
}

/** 2000 → "20%", 3750 → "37.5%", 1225 → "12.25%". */
export function formatRate(bp: number): string {
  return `${rateInputValue(bp)}%`;
}

/** "2026-10-16" → "16 Oct" · with `weekday` "Fri, 16 Oct" · with `year` "16 Oct 2026". */
export function formatDayKey(day: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  if (!isDayKey(day)) return day;
  const d = new Date(`${day}T00:00:00Z`);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${opts.year ? ` ${d.getUTCFullYear()}` : ""}`;
  return opts.weekday ? `${WEEKDAYS[d.getUTCDay()]}, ${date}` : date;
}

/** "14:05" (the store's clock, from the API) → "2:05 PM". */
export function formatClock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "2 Oct – 15 Oct"; a single day reads "2 Oct". */
export function formatDayRange(from: string, to: string): string {
  return from === to ? formatDayKey(from) : `${formatDayKey(from)} – ${formatDayKey(to)}`;
}

/**
 * A store-local day or wall time from the API. "2026-10-02" → "2 Oct".
 * "2026-10-02T13:05" → "2 Oct, 1:05 PM". Nothing here converts a timezone.
 */
export function formatWhen(value: string, opts: { year?: boolean } = {}): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(value);
  if (!m || !isDayKey(m[1]!)) return value;
  const day = formatDayKey(m[1]!, opts);
  return m[2] ? `${day}, ${formatClock(m[2])}` : day;
}

/** "2 Oct, 1:05 PM – 2 Oct, 4:00 PM"; one instant reads as itself. */
export function formatWhenRange(from: string, to: string): string {
  return from === to ? formatWhen(from) : `${formatWhen(from)} – ${formatWhen(to)}`;
}
