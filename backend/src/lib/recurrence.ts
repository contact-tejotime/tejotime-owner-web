import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { isBookable, type SlotInput } from './booking-slots';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Recurring appointments — the date arithmetic. Pure: no DB, no env, no clock of its own.
 * See docs/recurring-appointments.md.
 *
 * A series is a RULE (first date, every N days, an end), not a list of bookings. Rule dates are
 * plain store-local calendar dates ('YYYY-MM-DD'); the visit's instant is that date at the
 * series' store-local start time, worked out only when a visit is booked. Keeping dates as
 * calendar dates is what holds "every 14 days at 10:00 AM" steady across daylight saving, which
 * a fixed 14 × 24h step in UTC would not.
 *
 * THE HORIZON. Public booking offers today … today+(windowDays-1) (`BOOKING_WINDOW_DAYS` = 14 →
 * today+13). The job books every series date up to today+(windowDays+6) = today+20, so each visit
 * exists 7 days before any other customer can even see its date. That margin is why the job may
 * miss runs (a deploy, an outage) without a regular losing their slot. The horizon is derived
 * from the window, never hard-coded: if the window grows, the horizon must grow with it.
 */

export const SERIES_LIMITS = {
  minEveryDays: 7,
  maxEveryDays: 90,
  /** Visits, the first one included. */
  minCount: 2,
  maxCount: 26,
  /** An "until" date at most this many days after today. */
  maxEndDays: 365,
} as const;

/** How many visits a rule-date preview shows the customer. */
export const PREVIEW_DATES = 6;

/** Days the store's public booking can't see yet that the job books into (today+14 … today+20). */
export const SERIES_MARGIN_DAYS = 7;

export type SeriesEnd = { type: 'never' } | { type: 'count'; count: number } | { type: 'until'; date: string };

export interface SeriesRule {
  /** Store-local 'YYYY-MM-DD' of the first visit under this rule. */
  anchorDate: string;
  everyDays: number;
  end: SeriesEnd;
  /**
   * How many rule dates came before `anchorDate` (`appointment_series.anchor_index`). A "change all
   * future visits" re-anchors the rule on the date it starts from; this keeps a "count" series
   * ending at its ORIGINAL total. 0 for a series never changed.
   */
  startIndex?: number;
}

/**
 * The job's booking window in `SlotInput.windowDays` terms (days from today, today included).
 * 14 → 21, i.e. today … today+20.
 */
export function seriesWindowDays(bookingWindowDays: number): number {
  return bookingWindowDays + SERIES_MARGIN_DAYS;
}

/** The last date the job books into: today + 20 for a 14-day public window. */
export function horizonDate(today: string, bookingWindowDays: number): string {
  return addDays(today, seriesWindowDays(bookingWindowDays) - 1);
}

/** Calendar arithmetic on 'YYYY-MM-DD'. Done in UTC, which has no daylight saving to skew it. */
export function addDays(date: string, n: number): string {
  return dayjs.utc(date).add(n, 'day').format('YYYY-MM-DD');
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  return dayjs.utc(b).diff(dayjs.utc(a), 'day');
}

/** Today's date on the store's clock. */
export function storeToday(now: Date, tz: string): string {
  return dayjs(now).tz(tz).format('YYYY-MM-DD');
}

/** The store-local 'YYYY-MM-DD' an instant falls on. */
export function storeDate(instant: Date | string, tz: string): string {
  return dayjs(instant).tz(tz).format('YYYY-MM-DD');
}

/** The store-local 'HH:mm' of an instant — what a series stores as its start time. */
export function storeTime(instant: Date | string, tz: string): string {
  return dayjs(instant).tz(tz).format('HH:mm');
}

/** A visit's instant: `date` at the store-local `startTime` ('HH:mm' or Postgres 'HH:mm:ss'). */
export function occurrenceStart(date: string, startTime: string, tz: string): Date {
  return dayjs.tz(`${date} ${startTime}`, tz).toDate();
}

/** The k-th rule date (k = 0 is the anchor), or null once the rule has ended. */
export function occurrenceAt(rule: SeriesRule, k: number): string | null {
  if (k < 0) return null;
  if (rule.end.type === 'count' && k + (rule.startIndex ?? 0) >= rule.end.count) return null;
  const d = addDays(rule.anchorDate, k * rule.everyDays);
  if (rule.end.type === 'until' && d > rule.end.date) return null;
  return d;
}

/** k such that `occurrenceAt(rule, k) === date`, or null when `date` is not one of the rule's dates. */
export function occurrenceIndex(rule: SeriesRule, date: string): number | null {
  const gap = daysBetween(rule.anchorDate, date);
  if (gap < 0 || gap % rule.everyDays !== 0) return null;
  const k = gap / rule.everyDays;
  return occurrenceAt(rule, k) === date ? k : null;
}

export function isRuleDate(rule: SeriesRule, date: string): boolean {
  return occurrenceIndex(rule, date) !== null;
}

/** Index of the first rule date strictly after `after`. */
function firstIndexAfter(rule: SeriesRule, after: string): number {
  const gap = daysBetween(rule.anchorDate, after);
  return gap < 0 ? 0 : Math.floor(gap / rule.everyDays) + 1;
}

/** Rule dates strictly after `after` and on or before `through`, in order. */
export function datesBetween(rule: SeriesRule, after: string, through: string): string[] {
  const out: string[] = [];
  for (let k = firstIndexAfter(rule, after); ; k += 1) {
    const d = occurrenceAt(rule, k);
    if (!d || d > through) break;
    out.push(d);
  }
  return out;
}

/** The next `n` rule dates strictly after `after` (fewer when the rule ends first). */
export function nextDates(rule: SeriesRule, after: string, n: number): string[] {
  const out: string[] = [];
  for (let k = firstIndexAfter(rule, after); out.length < n; k += 1) {
    const d = occurrenceAt(rule, k);
    if (!d) break;
    out.push(d);
  }
  return out;
}

/** True while the rule still has a date after `after` — false means the series has ended. */
export function hasDatesAfter(rule: SeriesRule, after: string): boolean {
  return occurrenceAt(rule, firstIndexAfter(rule, after)) !== null;
}

/** The first rule date strictly after `after`, or null once the rule has ended. */
export function firstDateAfter(rule: SeriesRule, after: string): string | null {
  return occurrenceAt(rule, firstIndexAfter(rule, after));
}

/** The final rule date, or null for a series that never ends. */
export function lastDate(rule: SeriesRule): string | null {
  if (rule.end.type === 'never') return null;
  if (rule.end.type === 'count') return occurrenceAt(rule, rule.end.count - 1 - (rule.startIndex ?? 0));
  const k = Math.floor(daysBetween(rule.anchorDate, rule.end.date) / rule.everyDays);
  return occurrenceAt(rule, Math.max(0, k));
}

/**
 * How many visits the series makes in total — the dates before a change included — or null for a
 * series that never ends.
 */
export function totalVisits(rule: SeriesRule): number | null {
  if (rule.end.type === 'never') return null;
  if (rule.end.type === 'count') return rule.end.count;
  return (rule.startIndex ?? 0) + Math.floor(daysBetween(rule.anchorDate, rule.end.date) / rule.everyDays) + 1;
}

/**
 * A series row's columns as a rule. In this pure module (not series.service.ts) so the slot loader
 * in booking.repo.ts can build rules without importing the series service — that would be a cycle.
 */
export function ruleFromColumns(c: {
  anchor_date: string;
  interval_days: number;
  end_type: string;
  end_count: number | null;
  end_date: string | null;
  anchor_index?: number | null;
}): SeriesRule {
  const end: SeriesEnd =
    c.end_type === 'count'
      ? { type: 'count', count: c.end_count ?? SERIES_LIMITS.minCount }
      : c.end_type === 'until'
        ? { type: 'until', date: c.end_date ?? c.anchor_date }
        : { type: 'never' };
  return { anchorDate: c.anchor_date, everyDays: c.interval_days, end, startIndex: c.anchor_index ?? 0 };
}

/** What `projectedBookings` needs of a series. */
export interface ProjectableSeries {
  id: string;
  status: string;
  rule: SeriesRule;
  /** 'HH:mm' store-local. */
  startTime: string;
  /** The job's cursor: dates on or before it are already booked (or handled). */
  generatedThrough: string;
  staffId: string | null;
  staffLocked: boolean;
  /** False when the locked stylist is inactive or deleted — such a series will pause, not book. */
  staffActive: boolean;
  /** The visit's length (sum of the series' current services). */
  minutes: number;
}

/**
 * A regular's NOT-YET-BOOKED dates, as bookings, for one store-local day.
 *
 * The horizon keeps public booking away from series dates the job has not reached; an edit (an
 * owner moving a visit up to 60 days out, or anything at the horizon's edge around store midnight)
 * has no such protection, so it counts these as taken. Paused series and ones whose stylist has
 * gone are left out — they will not book that date.
 */
export function projectedBookings(
  series: ProjectableSeries[],
  date: string,
  tz: string,
): { start: Date; end: Date; staffId: string | null }[] {
  const out: { start: Date; end: Date; staffId: string | null }[] = [];
  for (const s of series) {
    if (s.status !== 'active') continue;
    if (s.staffLocked && !s.staffActive) continue;
    if (date <= s.generatedThrough || !isRuleDate(s.rule, date)) continue;
    const start = occurrenceStart(date, s.startTime, tz);
    out.push({ start, end: new Date(start.getTime() + Math.max(1, s.minutes) * 60_000), staffId: s.staffId });
  }
  return out;
}

/**
 * What is wrong with a rule as a customer sent it, or null when it is fine. Returned as a sentence
 * the booking page can show as-is.
 */
export function ruleProblem(rule: SeriesRule, today: string): string | null {
  const { minEveryDays, maxEveryDays, minCount, maxCount, maxEndDays } = SERIES_LIMITS;
  if (!Number.isInteger(rule.everyDays) || rule.everyDays < minEveryDays || rule.everyDays > maxEveryDays) {
    return `Repeat every ${minEveryDays} to ${maxEveryDays} days`;
  }
  if (rule.end.type === 'count') {
    const c = rule.end.count;
    if (!Number.isInteger(c) || c < minCount || c > maxCount) return `Choose ${minCount} to ${maxCount} visits`;
  }
  if (rule.end.type === 'until') {
    const end = rule.end.date;
    if (daysBetween(today, end) > maxEndDays) return 'The end date can be at most one year away';
    // An end before the second visit is a single booking, not a series.
    if (end < addDays(rule.anchorDate, rule.everyDays)) return 'The end date must leave room for at least two visits';
  }
  return null;
}

/**
 * Why a series date can or cannot be booked.
 *  - ok                   bookable now
 *  - past                 its time has gone (a date the job reaches late, e.g. after an outage)
 *  - closed               the store is shut that weekday — skipped automatically, never flagged
 *  - stylist_unavailable  the chosen stylist is no longer active (or was deleted)
 *  - outside_hours        the usual time no longer fits the day's hours, even on an empty diary
 *  - taken                the time is free by the hours but someone else holds it
 */
export type DateVerdict = 'ok' | 'past' | 'closed' | 'stylist_unavailable' | 'outside_hours' | 'taken';

/**
 * Judges one series date with the SAME rule public booking uses (`isBookable`), so a series can
 * never be given a time a customer could not book. The caller passes a `SlotInput` whose
 * `windowDays` is the series window (today+20), not the public 14 days.
 */
export function judgeDate(input: SlotInput, startIso: string, opts: { staffLocked: boolean }): DateVerdict {
  if (new Date(startIso).getTime() <= input.now.getTime()) return 'past';
  const h = input.hours;
  if (!h || h.isClosed || !h.opensAt || !h.closesAt) return 'closed';
  if (opts.staffLocked && (!input.staffId || !input.activeStaffIds.includes(input.staffId))) {
    return 'stylist_unavailable';
  }
  if (isBookable(input, startIso)) return 'ok';
  // Bookable on an empty diary → only other bookings stand in the way.
  return isBookable({ ...input, bookings: [] }, startIso) ? 'taken' : 'outside_hours';
}
