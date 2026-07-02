import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { env } from '../config/env';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

/** Start/end of "today" for a business timezone, as UTC ISO strings. */
export function businessDayRange(tz = env.DEFAULT_TIMEZONE, date?: string) {
  const base = date ? dayjs.tz(date, tz) : dayjs().tz(tz);
  const start = base.startOf('day');
  const end = base.endOf('day');
  return { startIso: start.utc().toISOString(), endIso: end.utc().toISOString() };
}

/** yyyymmdd key in the business timezone — used for daily token sequences. */
export function businessDayKey(tz = env.DEFAULT_TIMEZONE): string {
  return dayjs().tz(tz).format('YYYYMMDD');
}

/**
 * Human "last visit" label from a timestamp — Today / 3d / 1w / 2w …
 * Mirrors the Customer.last strings in app/src/data/sample.ts.
 */
export function lastVisitLabel(iso: string | null, tz = env.DEFAULT_TIMEZONE): string {
  if (!iso) return '—';
  const now = dayjs().tz(tz);
  const then = dayjs(iso).tz(tz);
  const days = now.startOf('day').diff(then.startOf('day'), 'day');
  if (days <= 0) return 'Today';
  if (days === 1) return '1d';
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

export { dayjs };
