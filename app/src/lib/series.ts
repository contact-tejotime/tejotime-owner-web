/**
 * Wording for repeating bookings (docs/recurring-appointments.md) — the app's half of the copy
 * owner-web prints from the same spec. Keep the two in step by hand: they share no code.
 *
 * Two kinds of time cross the API and are treated differently on purpose:
 * - The series RULE is store-local text — `startTime` "10:00", `anchorDate` / `laterDates` /
 *   `end.date` "2026-10-10", and a slot's `label`. Those are only re-worded here, never converted,
 *   so a regular's "Sat 10:00 AM" stays that even when the phone is set to another timezone.
 * - A VISIT is a UTC instant (`nextVisitAt`, `scheduledStartAt`). Those are put on the STORE's
 *   clock (lib/zoned.ts), like every other appointment time in the app (`mappers.ts fmtTime`).
 */
import { format, t } from '@/i18n';
import type { SeriesDTO, SeriesIssueReason, SeriesPauseReason, SeriesStatus } from '@/lib/api';
import { formatClock, isDayKey } from '@/lib/commission';
import { zonedParts } from '@/lib/zoned';

/** "Every week", "Every 2 weeks", "Every 18 days". */
export function everyLabel(everyDays: number): string {
  if (everyDays === 7) return t.series.everyWeek;
  if (everyDays > 0 && everyDays % 7 === 0) return format(t.series.everyWeeks, { n: everyDays / 7 });
  return format(t.series.everyDays, { n: everyDays });
}

/** "Sat" for a store-local day — read in UTC so the phone's timezone cannot move it a day. */
function shortWeekday(day: string): string | null {
  if (!isDayKey(day)) return null;
  const long = t.days.long[new Date(`${day}T00:00:00Z`).getUTCDay()];
  return long ? long.slice(0, 3) : null;
}

/**
 * "Every 2 weeks · Sat 10:00 AM". The weekday only when the interval is whole weeks — every 18
 * days lands on a different weekday each time, so naming one would be a promise the rule breaks.
 */
export function rhythmLabel(s: Pick<SeriesDTO, 'everyDays' | 'anchorDate' | 'startTime'>): string {
  const rhythm = everyLabel(s.everyDays);
  const time = formatClock(s.startTime);
  const weekday = s.everyDays % 7 === 0 ? shortWeekday(s.anchorDate) : null;
  return weekday
    ? format(t.series.rhythmWeekday, { rhythm, weekday, time })
    : format(t.series.rhythmTime, { rhythm, time });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Sat 24 Oct", and "Sat 24 Oct 2027" only when it is not this year — an "until" end can be a
 * year away. The same shape owner-web prints, so the two surfaces read alike.
 */
function dayText(year: number, month: number, date: number, weekday: number): string {
  const wd = (t.days.long[weekday] ?? '').slice(0, 3);
  // "This year" on the store's calendar — on New Year's Eve the phone's may already be the next.
  const y = year !== zonedParts(new Date()).year ? ` ${year}` : '';
  return `${wd} ${date} ${MONTHS[month]}${y}`;
}

/** A store-local "YYYY-MM-DD" → "Sat 24 Oct". Read in UTC, so no timezone can move it a day. */
export function seriesDay(day: string): string {
  if (!isDayKey(day)) return day;
  const d = new Date(`${day}T00:00:00Z`);
  return dayText(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCDay());
}

/** "Until cancelled" · "6 visits · last on 21 Nov" · "Until 3 Apr 2027". */
export function endLabel(s: Pick<SeriesDTO, 'end' | 'lastDate'>): string {
  if (s.end.type === 'count') {
    // The API always works out `lastDate` for a count; the dash only covers a malformed row.
    return format(t.series.endCount, {
      n: s.end.count,
      date: s.lastDate ? seriesDay(s.lastDate) : t.common.dash,
    });
  }
  if (s.end.type === 'until') return format(t.series.endUntil, { date: seriesDay(s.end.date) });
  return t.series.endNever;
}

/**
 * Who the series is with. A chosen stylist who has since gone (`staffLocked` with no `staffId`)
 * is not "Any stylist" — the series is waiting for the owner to pick someone, and "any" would
 * hide that. Same rule as owner-web.
 */
export function stylistLabel(s: Pick<SeriesDTO, 'staffName' | 'staffId' | 'staffLocked'>): string {
  if (s.staffLocked && !s.staffId) return t.series.reasonStylistUnavailable;
  return s.staffName || t.series.anyStylist;
}

export function statusLabel(status: SeriesStatus): string {
  switch (status) {
    case 'paused':
      return t.series.statusPaused;
    case 'ended':
      return t.series.statusEnded;
    case 'cancelled':
      return t.series.statusCancelled;
    default:
      return t.series.statusActive;
  }
}

export function pauseReasonLabel(reason: SeriesPauseReason | null): string | null {
  switch (reason) {
    case 'owner':
      return t.series.pausedOwner;
    case 'stylist_unavailable':
      return t.series.pausedStylist;
    case 'no_shows':
      return t.series.pausedNoShows;
    default:
      return null;
  }
}

export function issueReasonLabel(reason: SeriesIssueReason): string {
  switch (reason) {
    case 'slot_taken':
      return t.series.reasonSlotTaken;
    case 'outside_hours':
      return t.series.reasonOutsideHours;
    case 'stylist_unavailable':
      return t.series.reasonStylistUnavailable;
    case 'service_missing':
      return t.series.reasonServiceMissing;
    default:
      return reason;
  }
}

/**
 * "Sat 24 Oct, 10:00 AM" on the STORE's clock, as owner-web prints it. Built from date parts
 * rather than toLocale*, so it reads the same as owner-web on every locale.
 */
export function visitWhen(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return iso;
  const p = zonedParts(iso);
  const day = dayText(p.year, p.month - 1, p.day, p.weekday);
  return `${day}, ${formatClock(`${p.hour}:${String(p.minute).padStart(2, '0')}`)}`;
}

/** A picked slot, for a confirmation: "Sat 24 Oct, 10:00 AM" — the API's own store-local label. */
export function slotWhen(date: string, label: string): string {
  return `${seriesDay(date)}, ${label}`;
}

/** "Sat 24 Oct · Sat 7 Nov" for the dates the job has not booked yet. */
export function laterDatesLabel(dates: string[]): string {
  return format(t.series.laterDates, { dates: dates.map(seriesDay).join(' · ') });
}
