import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reports' period selector (Today / This week / This month / Custom) on the dashboard endpoints,
 * and a regression: a stylist removed mid-period vanished from the per-stylist breakdown while
 * their revenue still counted in the summary total. No DB: the pool is stubbed. The clock is
 * frozen at 16 Oct 00:30 in India (still 15 Oct in UTC).
 */

const { one, many } = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(),
}));

vi.mock('../../src/db/pool', () => ({
  exec: vi.fn(async () => 0),
  many,
  one,
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

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

describe('dashboard report ranges', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    many.mockReset();
    one.mockImplementation(async (sql: string) => {
      if (/from business/.test(sql)) return { timezone: 'Asia/Kolkata', currency: 'INR' };
      if (/from visit/.test(sql)) return { completed: 3, revenue: '120000' };
      if (/from queue_entry/.test(sql)) return { active: 2, waiting: 1 };
      return { count: 4 };
    });
    many.mockImplementation(async (sql: string) => {
      if (/from user_permission/.test(sql)) return [];
      return [
        { id: 's1', name: 'John', is_active: true, appointments: 1, completed: 2, revenue: '80000' },
        { id: 's2', name: 'Left mid-week', is_active: false, appointments: 0, completed: 1, revenue: '40000' },
      ];
    });
    process.env = { ...originalEnv, ...TEST_ENV };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T19:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  async function app() {
    const { dashboardRouter } = await import('../../src/modules/dashboard/dashboard.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/dashboard', dashboardRouter);
    a.use(errorHandler);
    return a;
  }

  async function token(role: 'owner' | 'staff') {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    return `Bearer ${signAccessToken({ userId: 'u1', businessId: 'b1', role: role as any, plan: 'free' as any, staffId: role === 'staff' ? 's1' : null })}`;
  }

  it('summary covers a custom range of store days, end exclusive', async () => {
    const res = await request(await app())
      .get('/api/v1/dashboard/summary?range=custom&from=2026-10-02&to=2026-10-15')
      .set('authorization', await token('owner'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ range: 'custom', from: '2026-10-02', to: '2026-10-15', today: '2026-10-16' });
    const visitCall = one.mock.calls.find((c) => /from visit/.test(c[0] as string))!;
    expect(visitCall[0]).toMatch(/completed_at < \$3/);
    expect(visitCall[1]).toEqual(['b1', '2026-10-01T18:30:00.000Z', '2026-10-15T18:30:00.000Z']);
  });

  it('still answers the old today / month clients, with the store-local day as `date`', async () => {
    const a = await app();
    const auth = await token('owner');
    const today = await request(a).get('/api/v1/dashboard/summary?range=today').set('authorization', auth);
    expect(today.status).toBe(200);
    expect(today.body).toMatchObject({ range: 'today', date: '2026-10-16', periodLabel: 'Fri, 16 Oct 2026' });
    const month = await request(a).get('/api/v1/dashboard/summary?range=month').set('authorization', auth);
    expect(month.body).toMatchObject({ range: 'month', from: '2026-10-01', periodLabel: 'October 2026' });
  });

  it('refuses a custom range without both dates', async () => {
    const res = await request(await app())
      .get('/api/v1/dashboard/summary?range=custom&from=2026-10-02')
      .set('authorization', await token('owner'));
    expect(res.status).toBe(400);
  });

  it('by-staff keeps a stylist removed mid-period who still has work in it (regression)', async () => {
    const res = await request(await app())
      .get('/api/v1/dashboard/by-staff?range=week')
      .set('authorization', await token('owner'));

    expect(res.status).toBe(200);
    const [sql, params] = many.mock.calls.find((c) => /from staff s/.test(c[0] as string))!;
    expect(sql).toMatch(/s\.is_active or a\.staff_id is not null or v\.staff_id is not null/);
    expect(sql).not.toMatch(/s\.is_active = true/);
    expect(params).toEqual(['b1', '2026-10-11T18:30:00.000Z', '2026-10-16T18:30:00.000Z']);
    expect(res.body.data).toContainEqual(expect.objectContaining({ name: 'Left mid-week', isActive: false }));
  });

  it('by-staff stays closed to a staff login', async () => {
    const res = await request(await app()).get('/api/v1/dashboard/by-staff').set('authorization', await token('staff'));
    expect(res.status).toBe(403);
  });
});
