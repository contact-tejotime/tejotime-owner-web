import { z } from 'zod';
import { env } from '../config/env';
import { dayjs } from './time';

/**
 * The period a report covers — shared by the dashboard, the commission reports and the admin
 * commission view, so "This week" means the same days on every screen and revenue on one card
 * matches commission on the next.
 *
 * Two rules that every caller relies on:
 *
 *  - Days are the STORE's calendar days (business.timezone), and "today" is only ever worked out
 *    here, on the server. Clients cannot do it: the Expo app never learns the store timezone, and
 *    owner-web renders on a UTC server where `new Date()` is the wrong day for half of India's
 *    mornings.
 *  - A window is HALF-OPEN: `startIso` is the first instant of `from`, `endIso` the first instant
 *    of the day AFTER `to`, and queries use `completed_at < endIso`. No end-of-day millisecond
 *    can fall between two adjacent windows.
 */

export const REPORT_RANGES = ['today', 'week', 'month', 'custom'] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

/** Longest custom window — the same cap as the admin visit ledger. */
export const MAX_REPORT_SPAN_DAYS = 366;

/**
 * A real `YYYY-MM-DD` calendar day. The strict parse matters: the regex alone lets `2026-02-30`
 * through, and Postgres would then fail the whole report with a 500 instead of a 400.
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')
  .refine((s) => dayjs(s, 'YYYY-MM-DD', true).isValid(), 'That is not a real date');

/** Calendar arithmetic on a `YYYY-MM-DD` key — in UTC, so a DST changeover can never slip it. */
export function addDays(day: string, n: number): string {
  return dayjs.utc(day).add(n, 'day').format('YYYY-MM-DD');
}

function daysBetween(from: string, to: string): number {
  return dayjs.utc(to).diff(dayjs.utc(from), 'day');
}

/** Today's calendar date in the store's timezone — NOT `startIso.slice(0, 10)`, the UTC date. */
export function businessToday(tz?: string | null): string {
  return dayjs().tz(tz || env.DEFAULT_TIMEZONE).format('YYYY-MM-DD');
}

const reportQueryObject = z.object({
  range: z.enum(REPORT_RANGES).default('today'),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

function refineReportQuery(q: { range?: ReportRange; from?: string; to?: string }, ctx: z.RefinementCtx) {
  if (q.range !== 'custom') return;
  if (!q.from || !q.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [q.from ? 'to' : 'from'], message: 'Pick a start and an end date' });
    return;
  }
  if (q.from > q.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: 'The start date must be on or before the end date' });
    return;
  }
  if (daysBetween(q.from, q.to) > MAX_REPORT_SPAN_DAYS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: `Pick a range of at most ${MAX_REPORT_SPAN_DAYS} days` });
  }
}

/** `?range=today|week|month|custom&from=&to=` — `from`/`to` are required for (only) `custom`. */
export const reportQuerySchema = reportQueryObject.superRefine(refineReportQuery);

/** The same query plus route-specific fields (e.g. the commission visit list's `staffId`). */
export function reportQueryWith<T extends z.ZodRawShape>(shape: T) {
  return reportQueryObject.extend(shape).superRefine(refineReportQuery);
}

export type ReportQuery = z.infer<typeof reportQueryObject>;

export interface ReportWindow {
  range: ReportRange;
  /** First store-local day in the window. */
  from: string;
  /** Last store-local day in the window (inclusive). */
  to: string;
  /** The store's today, so clients never have to work it out. */
  today: string;
  startIso: string;
  /** EXCLUSIVE: the first instant after the window. Query with `< endIso`. */
  endIso: string;
  periodLabel: string;
}

/** The UTC instant a store-local day starts. */
function dayStartIso(tz: string, day: string): string {
  return dayjs.tz(day, tz).utc().toISOString();
}

function label(range: ReportRange, from: string, to: string): string {
  const a = dayjs.utc(from);
  const b = dayjs.utc(to);
  if (range === 'month') return a.format('MMMM YYYY');
  if (from === to) return a.format('ddd, D MMM YYYY');
  return a.year() === b.year()
    ? `${a.format('D MMM')} – ${b.format('D MMM YYYY')}`
    : `${a.format('D MMM YYYY')} – ${b.format('D MMM YYYY')}`;
}

/**
 * Resolve a (validated) report query into store-local days and UTC bounds.
 *
 *  - today:  [today, today]
 *  - week:   Monday → today. Weeks start on Monday (ISO); see docs/staff-commission.md.
 *  - month:  the 1st → today (month-to-date, as Reports has always shown)
 *  - custom: as given — a future `to` is allowed; it simply has no visits yet
 */
export function resolveReportWindow(
  tz: string | null | undefined,
  q: { range?: ReportRange; from?: string; to?: string } = {},
): ReportWindow {
  const zone = tz || env.DEFAULT_TIMEZONE;
  const today = businessToday(zone);
  const range: ReportRange = q.range === 'custom' && !(q.from && q.to) ? 'today' : (q.range ?? 'today');

  let from = today;
  let to = today;
  if (range === 'week') {
    // dayjs: 0 = Sunday … 6 = Saturday. Steps back to Monday.
    from = addDays(today, -((dayjs.utc(today).day() + 6) % 7));
  } else if (range === 'month') {
    from = `${today.slice(0, 8)}01`;
  } else if (range === 'custom') {
    from = q.from!;
    to = q.to!;
  }

  return {
    range,
    from,
    to,
    today,
    startIso: dayStartIso(zone, from),
    endIso: dayStartIso(zone, addDays(to, 1)),
    periodLabel: label(range, from, to),
  };
}
