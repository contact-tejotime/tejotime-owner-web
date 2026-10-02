import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Report periods are the STORE's calendar days. The clock is frozen at 2026-10-15T19:00Z, which is
 * already 16 Oct 00:30 in India but still 15 Oct in UTC — the half hour in which a server that
 * used its own (UTC) day would put an Indian store's "today", and a commission rate "from today",
 * on the wrong day.
 */

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
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

describe('report windows', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, ...TEST_ENV };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T19:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  const load = () => import('../../src/lib/report-window');

  it("today is the store's calendar day, not the server's UTC date", async () => {
    const { businessToday, resolveReportWindow } = await load();
    expect(businessToday('Asia/Kolkata')).toBe('2026-10-16');
    expect(businessToday('UTC')).toBe('2026-10-15');

    const w = resolveReportWindow('Asia/Kolkata', { range: 'today' });
    expect(w).toMatchObject({
      range: 'today',
      from: '2026-10-16',
      to: '2026-10-16',
      today: '2026-10-16',
      startIso: '2026-10-15T18:30:00.000Z',
      endIso: '2026-10-16T18:30:00.000Z', // exclusive: the first instant of 17 Oct
      periodLabel: 'Fri, 16 Oct 2026',
    });
  });

  it('a week starts on Monday and runs to today', async () => {
    const { resolveReportWindow } = await load();
    const w = resolveReportWindow('Asia/Kolkata', { range: 'week' });
    expect(w).toMatchObject({
      from: '2026-10-12', // Monday
      to: '2026-10-16', //   Friday (today)
      startIso: '2026-10-11T18:30:00.000Z',
      endIso: '2026-10-16T18:30:00.000Z',
      periodLabel: '12 Oct – 16 Oct 2026',
    });

    vi.setSystemTime(new Date('2026-10-12T06:00:00Z')); // a Monday: the week is just today
    expect(resolveReportWindow('Asia/Kolkata', { range: 'week' })).toMatchObject({ from: '2026-10-12', to: '2026-10-12' });
    vi.setSystemTime(new Date('2026-10-18T06:00:00Z')); // a Sunday: it still began on Monday
    expect(resolveReportWindow('Asia/Kolkata', { range: 'week' })).toMatchObject({ from: '2026-10-12', to: '2026-10-18' });
  });

  it('a month runs from the 1st to today, as Reports always has', async () => {
    const { resolveReportWindow } = await load();
    expect(resolveReportWindow('Asia/Kolkata', { range: 'month' })).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-16',
      startIso: '2026-09-30T18:30:00.000Z',
      periodLabel: 'October 2026',
    });
  });

  it('a custom range includes both of its days', async () => {
    const { resolveReportWindow } = await load();
    expect(resolveReportWindow('Asia/Kolkata', { range: 'custom', from: '2026-10-02', to: '2026-10-15' })).toMatchObject({
      from: '2026-10-02',
      to: '2026-10-15',
      startIso: '2026-10-01T18:30:00.000Z',
      endIso: '2026-10-15T18:30:00.000Z',
      periodLabel: '2 Oct – 15 Oct 2026',
    });
  });

  it('keeps local midnights across a US daylight-saving change', async () => {
    const { resolveReportWindow } = await load();
    // New York leaves daylight time on Sunday 1 Nov 2026: EDT (−4) before, EST (−5) after.
    expect(resolveReportWindow('America/New_York', { range: 'custom', from: '2026-10-26', to: '2026-11-01' })).toMatchObject({
      startIso: '2026-10-26T04:00:00.000Z',
      endIso: '2026-11-02T05:00:00.000Z',
    });
    // 15:00 EDT on Thursday 15 Oct — the week began on Monday 12 Oct, New York time.
    expect(resolveReportWindow('America/New_York', { range: 'week' })).toMatchObject({
      from: '2026-10-12',
      to: '2026-10-15',
      startIso: '2026-10-12T04:00:00.000Z',
    });
  });

  it('validates the query: dates are real, custom needs both, in order, within 366 days', async () => {
    const { reportQuerySchema } = await load();
    expect(reportQuerySchema.parse({})).toEqual({ range: 'today' });
    expect(reportQuerySchema.safeParse({ range: 'week' }).success).toBe(true);
    expect(reportQuerySchema.safeParse({ range: 'custom', from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);

    for (const bad of [
      { range: 'year' },
      { range: 'custom' },
      { range: 'custom', from: '2026-10-01' },
      { range: 'custom', from: '2026-10-05', to: '2026-10-01' },
      { range: 'custom', from: '2025-01-01', to: '2026-10-01' },
      { range: 'custom', from: '2026-02-30', to: '2026-03-02' }, // not a real day — a 400, not a Postgres 500
      { range: 'custom', from: '01-10-2026', to: '2026-10-02' },
    ]) {
      expect(reportQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('day arithmetic is calendar arithmetic', async () => {
    const { addDays } = await load();
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});
