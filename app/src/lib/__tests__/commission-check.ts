/**
 * Commission helpers: the app's and owner-web's copies must agree.
 *
 * Framework-free, like `responsive-check.ts`: it runs under the `tsx` that backend/ already depends
 * on, so it adds no dependency and needs no test runner, simulator or bundler.
 *
 *   npm run test:commission
 *   # or: cd backend && npx tsx ../app/src/lib/__tests__/commission-check.ts
 *
 * Why: `app/src/lib/commission.ts` and `owner-web/src/lib/commission.ts` are hand-kept copies (each
 * app builds from its own folder, CLAUDE.md §1) of the functions that turn a typed "37,5" into
 * 3750 basis points and a stored rate back into "37.5%". An owner sets a rate on the phone and reads
 * it on the laptop, so the two must parse and print identically. Every case below runs through BOTH
 * copies, then is checked against the expected value — a drift in either copy fails here.
 * Also covers lib/date-grid.ts, the month arithmetic behind the app's date pickers.
 *
 * Failures throw. A non-zero exit code is the signal; the log is for humans.
 */

import * as appLib from '../commission';
import { buildGrid, dayKeyOf, GRID_CELLS, monthOfKey } from '../date-grid';
import * as webLib from '../../../../owner-web/src/lib/commission';

let checks = 0;

function eq(actual: unknown, expected: unknown, label: string): void {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** The shared functions, by name, from each copy. Listing them is also the contract. */
const pick = (lib: typeof appLib | typeof webLib) => ({
  parseRateInput: lib.parseRateInput,
  rateInputValue: lib.rateInputValue,
  formatRate: lib.formatRate,
  isDayKey: lib.isDayKey,
  shiftDayKey: lib.shiftDayKey,
  formatDayKey: lib.formatDayKey,
  formatDayRange: lib.formatDayRange,
  formatClock: lib.formatClock,
  reportQueryString: lib.reportQueryString,
});
const APP = pick(appLib);
const WEB = pick(webLib);

/** Run one case through both copies; they must agree with each other and with `expected`. */
function both<A extends unknown[], R>(name: keyof typeof APP, args: A, expected: R): void {
  const app = (APP[name] as unknown as (...a: A) => R)(...args);
  const web = (WEB[name] as unknown as (...a: A) => R)(...args);
  eq(app, web, `${name}(${JSON.stringify(args).slice(1, -1)}) — app vs owner-web`);
  eq(app, expected, `${name}(${JSON.stringify(args).slice(1, -1)})`);
}

// --- parseRateInput: what the owner typed → basis points --------------------------------------
both('parseRateInput', ['20'], 2000);
both('parseRateInput', ['30'], 3000);
both('parseRateInput', ['37.5'], 3750);
both('parseRateInput', ['12,25'], 1225); // an iOS decimal pad types a comma in some locales
both('parseRateInput', [' 20 % '], 2000);
both('parseRateInput', ['0'], 0); // an explicit 0% is a real rate (salary instead)
both('parseRateInput', ['100'], 10000);
both('parseRateInput', ['100.01'], null); // above 100%
both('parseRateInput', ['101'], null);
both('parseRateInput', ['-5'], null);
both('parseRateInput', ['12.345'], null); // at most two decimals (basis points)
both('parseRateInput', [''], null);
both('parseRateInput', ['abc'], null);
both('parseRateInput', ['1e2'], null);

// --- formatRate / rateInputValue: basis points → text, and back -------------------------------
both('formatRate', [2000], '20%');
both('formatRate', [3000], '30%');
both('formatRate', [3750], '37.5%');
both('formatRate', [1225], '12.25%');
both('formatRate', [2010], '20.1%');
both('formatRate', [0], '0%');
both('rateInputValue', [3750], '37.5');
both('rateInputValue', [2000], '20');
for (const bp of [0, 1, 99, 2000, 2005, 2010, 3750, 9999, 10000]) {
  eq(appLib.parseRateInput(appLib.rateInputValue(bp)), bp, `round trip ${bp} bp (app)`);
  eq(webLib.parseRateInput(webLib.rateInputValue(bp)), bp, `round trip ${bp} bp (owner-web)`);
}

// --- store-local day keys: no timezone anywhere -----------------------------------------------
both('isDayKey', ['2026-10-16'], true);
both('isDayKey', ['2026-02-30'], false);
both('isDayKey', ['16-10-2026'], false);
both('isDayKey', [null], false);
both('shiftDayKey', ['2026-10-15', 1], '2026-10-16');
both('shiftDayKey', ['2026-03-01', -1], '2026-02-28');
both('shiftDayKey', ['2026-12-31', 1], '2027-01-01');
both('formatDayKey', ['2026-10-16'], '16 Oct');
both('formatDayKey', ['2026-10-16', { weekday: true }], 'Fri, 16 Oct');
both('formatDayKey', ['2026-10-02', { year: true }], '2 Oct 2026');
both('formatDayRange', ['2026-10-02', '2026-10-15'], '2 Oct – 15 Oct');
both('formatDayRange', ['2026-10-16', '2026-10-16'], '16 Oct');
both('formatClock', ['00:30'], '12:30 AM');
both('formatClock', ['09:05'], '9:05 AM');
both('formatClock', ['12:00'], '12:00 PM');
both('formatClock', ['23:30'], '11:30 PM');

// --- the period in the API query string -------------------------------------------------------
both('reportQueryString', [{ range: 'today' }], 'range=today');
both('reportQueryString', [{ range: 'week' }], 'range=week');
both('reportQueryString', [{ range: 'custom', from: '2026-10-02', to: '2026-10-15' }], 'range=custom&from=2026-10-02&to=2026-10-15');
both('reportQueryString', [{ range: 'month', from: '2026-10-02', to: '2026-10-15' }], 'range=month'); // dates only for custom

// --- date-grid: the month a picker draws ------------------------------------------------------
const october = buildGrid(2026, 9); // 1 Oct 2026 is a Thursday
eq(october.length, GRID_CELLS, 'a month view is 42 days');
eq(dayKeyOf(october[0]), '2026-09-27', 'October 2026 starts on Sunday 27 September');
eq(dayKeyOf(october[41]), '2026-11-07', '…and ends on Saturday 7 November');
eq(october.filter((d) => d.getMonth() === 9).length, 31, 'all 31 October days are in it');
eq(monthOfKey('2026-10-16'), { year: 2026, month: 9 }, 'a day opens its own month');
const keys = october.map(dayKeyOf);
eq(new Set(keys).size, GRID_CELLS, 'no day repeats (a DST change cannot double a day)');
eq([...keys].sort().join(), keys.join(), 'days run in order');

console.log(`commission-check: ${checks} checks passed (app and owner-web agree)`);
