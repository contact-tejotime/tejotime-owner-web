/**
 * Month-grid arithmetic shared by the Calendar tab and the date pickers (`TMonthGrid`).
 *
 * Pure — no React, no react-native — so the repo-root `npm run test:commission` can check it with
 * plain `tsx`, the same way `test:responsive` checks lib/responsive.ts. The grid is calendar
 * arithmetic on the device's own calendar (local year/month/day parts); nothing here converts a
 * timezone, and `dayKeyOf` never uses `toISOString()`, which would be the UTC day.
 */

/** 6 weeks × 7 days — always covers a month plus lead/trail days. */
export const GRID_CELLS = 42;

/** The Sunday on or before the 1st of the month. */
export function startOfGrid(year: number, month: number): Date {
  const firstOfMonth = new Date(year, month, 1);
  return new Date(year, month, 1 - firstOfMonth.getDay());
}

/** The 42 days a month view shows, Sunday-first. `month` is 0-based, as in `Date`. */
export function buildGrid(year: number, month: number): Date[] {
  const start = startOfGrid(year, month);
  return Array.from(
    { length: GRID_CELLS },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

/** A grid cell → `YYYY-MM-DD` from its calendar parts. */
export function dayKeyOf(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The month a `YYYY-MM-DD` day falls in, for a grid to open on. `month` is 0-based. */
export function monthOfKey(key: string): { year: number; month: number } {
  const [y, m] = key.split('-').map(Number);
  return { year: y, month: (m || 1) - 1 };
}
