import { addDays, daysBetween } from './recurrence';

/**
 * "Due to come back" — the rules. Pure: no DB, no env, no clock of its own (docs/customer-due-list.md).
 *
 * A regular's rhythm comes from the days they visited, nothing else: every finished visit is a
 * `visit` row, and those rows are reduced to STORE-LOCAL calendar days ('YYYY-MM-DD') before they
 * reach this file. Two services checked out on one day are one visit day.
 *
 * The owner asked (2026-10-28) not to demand an exact gap: "if the gap is 15 to 25 days, allow it".
 * So the usual gap is the MEDIAN of the recent gaps, and a gap counts as normal anywhere inside a
 * band of ±25% around it (never narrower than ±3 days, so a weekly customer gets 4–10 days rather
 * than a useless ±2). A median, not a mean, so one holiday month cannot drag the rhythm.
 *
 * Only the recent window is judged (the last `maxGaps` gaps). Judging every gap ever would let one
 * long gap from a customer's first year rule out a loyal regular forever.
 */
export const DUE_RULES = {
  /** Visit days before anyone counts as a regular — 2 gaps, so one gap can't be chance. */
  minVisitDays: 3,
  /** Gaps judged: the most recent ones only. */
  maxGaps: 5,
  /** The band is usual ± max(bandMinDays, bandShare × usual). */
  bandMinDays: 3,
  bandShare: 0.25,
  /**
   * Shorter rhythms are left out (owner, 2026-10-28) — a restaurant's daily diner or a clinic's
   * every-few-days patient would flood the list. Same floor as a repeating booking
   * (`SERIES_LIMITS.minEveryDays`).
   */
  minUsualDays: 7,
  /** The customer is listed this many days before their expected day — time for the call. */
  callLeadDays: 2,
  /** "Not back for a while" once this many usual gaps have passed. */
  lapsedMultiple: 2,
  /** Dropped from every list after this long — a win-back call a year on is a cold call. */
  maxDaysSinceLast: 180,
  /** One gap outside the band is forgiven once there are at least this many gaps. */
  forgiveOneOutlierFrom: 3,
} as const;

export type DueStatus = 'due_soon' | 'overdue' | 'lapsed';
export type FollowupOutcome = 'no_answer' | 'call_later' | 'not_interested';

export interface Rhythm {
  /** The usual gap in whole days (median of the judged gaps, halves rounded up). */
  usualDays: number;
  /** Inclusive band edges, in days. */
  bandMin: number;
  bandMax: number;
  /** The most recent visit day. */
  lastVisit: string;
  /** The judged gaps, oldest first. */
  gaps: number[];
  /** True when one gap fell outside the band and was forgiven. */
  outlierForgiven: boolean;
}

export interface DueTiming {
  status: DueStatus;
  /** last visit + usual gap. */
  expectedDate: string;
  /** The first day the customer is listed. */
  callFrom: string;
  /** Overdue from the day after this (last visit + top of the band). */
  overdueAfter: string;
  /** "Not back for a while" from the day after this. */
  lapsedAfter: string;
  daysSinceLast: number;
}

export interface FollowupState {
  outcome: FollowupOutcome;
  /** Store-local day the customer shows again; null for not_interested. */
  snoozeUntil: string | null;
  /** The customer's last visit day when the outcome was logged. */
  aboutLastVisit: string;
}

/** Median of a non-empty list; the mean of the two middle values for an even count. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The customer's rhythm, or null when they are not a regular: fewer than 3 visit days, a usual gap
 * under a week, or more than one recent gap outside the band (or any, with only two gaps).
 */
export function rhythmOf(visitDays: string[]): Rhythm | null {
  const days = [...new Set(visitDays)].sort();
  if (days.length < DUE_RULES.minVisitDays) return null;

  const recent = days.slice(-(DUE_RULES.maxGaps + 1));
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) gaps.push(daysBetween(recent[i - 1], recent[i]));

  // Whole days, halves up (20.5 → 21): every date and every label downstream stays integral.
  const usualDays = Math.floor(median(gaps) + 0.5);
  if (usualDays < DUE_RULES.minUsualDays) return null;

  const half = Math.max(DUE_RULES.bandMinDays, usualDays * DUE_RULES.bandShare);
  const bandMin = Math.max(1, Math.ceil(usualDays - half));
  const bandMax = Math.floor(usualDays + half);

  const outside = gaps.filter((g) => g < bandMin || g > bandMax).length;
  const forgiven = outside === 1 && gaps.length >= DUE_RULES.forgiveOneOutlierFrom;
  if (outside > 0 && !forgiven) return null;

  return { usualDays, bandMin, bandMax, lastVisit: days[days.length - 1], gaps, outlierForgiven: forgiven };
}

/**
 * Where `today` falls on the customer's timeline, or null when they are not listed — too early to
 * call, or gone too long. With last visit 1 Oct and a 20-day rhythm (band 15–25): listed from
 * 19 Oct (expected 21 Oct − 2), overdue from 27 Oct, not back for a while from 11 Nov.
 */
export function dueTiming(r: Rhythm, today: string): DueTiming | null {
  const daysSinceLast = daysBetween(r.lastVisit, today);
  if (daysSinceLast > DUE_RULES.maxDaysSinceLast) return null;

  const expectedDate = addDays(r.lastVisit, r.usualDays);
  const callFrom = addDays(expectedDate, -DUE_RULES.callLeadDays);
  const overdueAfter = addDays(r.lastVisit, r.bandMax);
  // max(): the lapsed line never falls inside the band, whatever the constants become.
  const lapsedAfter = addDays(r.lastVisit, Math.max(DUE_RULES.lapsedMultiple * r.usualDays, r.bandMax));

  if (today < callFrom) return null;
  const status: DueStatus = today <= overdueAfter ? 'due_soon' : today <= lapsedAfter ? 'overdue' : 'lapsed';
  return { status, expectedDate, callFrom, overdueAfter, lapsedAfter, daysSinceLast };
}

/**
 * Whether a logged call outcome keeps the customer off the call list today. "Not interested" holds
 * until the owner undoes it. A snooze ("no answer", "call back on …") holds until its day, and only
 * while the visit it was about is still the latest — a customer who came in by themselves starts a
 * fresh cycle.
 */
export function followupHides(
  f: FollowupState | null,
  lastVisit: string,
  today: string,
): 'not_interested' | 'snoozed' | null {
  if (!f) return null;
  if (f.outcome === 'not_interested') return 'not_interested';
  if (f.aboutLastVisit === lastVisit && f.snoozeUntil !== null && today < f.snoozeUntil) return 'snoozed';
  return null;
}

const SECTION_ORDER: Record<DueStatus, number> = { overdue: 0, due_soon: 1, lapsed: 2 };

export interface DueSortable {
  status: DueStatus;
  expectedDate: string;
  lastVisit: string;
  name: string;
  customerId: string;
}

/**
 * The call order: Overdue first (they have already missed their usual day), then Due soon, both by
 * expected day; then "Not back for a while", most recent first — the likeliest to come back.
 */
export function compareDue(a: DueSortable, b: DueSortable): number {
  const bySection = SECTION_ORDER[a.status] - SECTION_ORDER[b.status];
  if (bySection) return bySection;
  if (a.status === 'lapsed') {
    if (a.lastVisit !== b.lastVisit) return a.lastVisit < b.lastVisit ? 1 : -1;
  } else if (a.expectedDate !== b.expectedDate) {
    return a.expectedDate < b.expectedDate ? -1 : 1;
  }
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  if (byName) return byName;
  return a.customerId < b.customerId ? -1 : a.customerId > b.customerId ? 1 : 0;
}
