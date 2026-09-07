import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `computeOpenStatus` decides whether a store's public booking page shows a live walk-in call to
 * action or a closed one. It shipped broken in the customer-facing sense: a closed store returned
 * a bare "Closed today" with nothing to act on, while the same page kept rendering "0 min wait ·
 * Walk in now" beside it. The microsite now gates the whole walk-in flow on `isOpen` and prints
 * `nextOpenLabel`, so both fields are load-bearing customer copy — pinned here because the
 * week-wrap and timezone arithmetic underneath them fails silently.
 *
 * No database and no server: the function is pure given (hours, tz, clock), and the clock is
 * frozen per test.
 */
describe('computeOpenStatus', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
      S3_ENDPOINT: 'https://example.storageapi.dev',
      S3_ACCESS_KEY_ID: 'test-access-key-id',
      S3_SECRET_ACCESS_KEY: 'test-secret-access-key',
      S3_BUCKET: 'test-bucket',
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      CUSTOMER_TOKEN_SECRET: 'test-customer-secret',
      TICKET_URL_HMAC_SECRET: 'test-ticket-secret',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  const TZ = 'America/New_York';

  /** business_hour rows as the DB hands them over: day_of_week 0 = Sunday, `time` as a string. */
  const row = (day: number, opens: string | null, closes: string | null, isClosed = false) => ({
    day_of_week: day,
    opens_at: opens,
    closes_at: closes,
    is_closed: isClosed,
  });

  /** Mon–Sat 10:00–19:00, closed Sunday — the shape the report was written against. */
  const monToSat = [
    row(0, null, null, true),
    ...[1, 2, 3, 4, 5, 6].map((d) => row(d, '10:00:00', '19:00:00')),
  ];

  /** Freeze the clock at a wall-clock instant in the business's own timezone. */
  const at = (isoLocal: string) => vi.setSystemTime(new Date(`${isoLocal}-04:00`)); // EDT

  async function compute(hours: unknown[], tz = TZ) {
    const { computeOpenStatus } = await import('../../src/modules/public/public.service');
    return computeOpenStatus(hours as any[], tz);
  }

  it('is open mid-shift and says when it closes, minutes included', async () => {
    vi.useFakeTimers();
    at('2026-09-08T14:00:00'); // Tuesday 2pm
    const s = await compute(monToSat);
    expect(s.isOpen).toBe(true);
    expect(s.label).toBe('Open now · till 7:00 PM');
  });

  it('closed all day points at the next open day by name', async () => {
    vi.useFakeTimers();
    at('2026-09-06T14:00:00'); // Sunday 2pm — the day the store is shut
    const s = await compute(monToSat);
    expect(s.isOpen).toBe(false);
    expect(s.nextOpenLabel).toBe('tomorrow at 10:00 AM');
    expect(s.label).toBe('Closed · Opens tomorrow at 10:00 AM');
  });

  it('before opening, the next opening is later today — not tomorrow', async () => {
    vi.useFakeTimers();
    at('2026-09-08T08:30:00'); // Tuesday, 90 minutes before the doors open
    const s = await compute(monToSat);
    expect(s.isOpen).toBe(false);
    expect(s.nextOpenLabel).toBe('today at 10:00 AM');
  });

  it('after closing, today’s opening is in the past and is skipped', async () => {
    vi.useFakeTimers();
    at('2026-09-08T21:00:00'); // Tuesday 9pm
    const s = await compute(monToSat);
    expect(s.isOpen).toBe(false);
    expect(s.nextOpenLabel).toBe('tomorrow at 10:00 AM');
  });

  it('Saturday night rolls over the closed Sunday to Monday', async () => {
    vi.useFakeTimers();
    at('2026-09-12T20:00:00'); // Saturday 8pm
    const s = await compute(monToSat);
    expect(s.nextOpenLabel).toBe('Monday at 10:00 AM');
  });

  it('a store open one day a week still resolves an opening', async () => {
    vi.useFakeTimers();
    at('2026-09-10T12:00:00'); // Thursday — the next Wednesday is six days out, so it is named
    const wednesdayOnly = [
      ...[0, 1, 2, 4, 5, 6].map((d) => row(d, null, null, true)),
      row(3, '09:30:00', '17:00:00'),
    ];
    const s = await compute(wednesdayOnly);
    expect(s.isOpen).toBe(false);
    // Minutes must survive: the old formatter stripped ":00" and would have printed "9 AM" here
    // for a 9:00 store, which is the same class of bug that made 9:30 look intentional.
    expect(s.nextOpenLabel).toBe('Wednesday at 9:30 AM');
  });

  it('no configured hours yields no next opening, and never invents one', async () => {
    vi.useFakeTimers();
    at('2026-09-08T12:00:00');
    const s = await compute([]);
    expect(s.isOpen).toBe(false);
    expect(s.nextOpenLabel).toBeNull();
    expect(s.label).toBe('Closed today');
  });

  it('every day marked closed yields no next opening', async () => {
    vi.useFakeTimers();
    at('2026-09-08T12:00:00');
    const s = await compute([0, 1, 2, 3, 4, 5, 6].map((d) => row(d, null, null, true)));
    expect(s.nextOpenLabel).toBeNull();
    expect(s.label).toBe('Closed today');
  });

  it('open/closed is judged in the business timezone, not the server’s', async () => {
    vi.useFakeTimers();
    // 2026-09-08T23:00 UTC is Tuesday 7pm in New York (closed, doors just shut) but Wednesday
    // 4:30am in Kolkata. Reading the server clock instead of the tz would flip both answers.
    vi.setSystemTime(new Date('2026-09-08T23:00:00Z'));
    const ny = await compute(monToSat, 'America/New_York');
    expect(ny.isOpen).toBe(false);
    expect(ny.nextOpenLabel).toBe('tomorrow at 10:00 AM');

    const kolkata = await compute(monToSat, 'Asia/Kolkata');
    expect(kolkata.isOpen).toBe(false);
    expect(kolkata.nextOpenLabel).toBe('today at 10:00 AM'); // Wednesday morning there
  });
});
