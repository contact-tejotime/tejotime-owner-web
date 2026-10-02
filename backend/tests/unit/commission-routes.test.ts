import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The commission API through its real router, guards and error handler, with the pool stubbed —
 * no DB, no server. The clock is frozen at 2026-10-15T19:00Z: 16 Oct 00:30 in the store's zone
 * (Asia/Kolkata) but still 15 Oct in UTC, so "today" being the STORE's day is actually tested.
 *
 * What it does NOT cover, because it needs a real Postgres: the `visit_commission` view itself
 * (backend/scripts/smoke-commission-db.mjs) and the end-to-end flow (smoke-commission.mjs).
 */

const { one, many, exec, overrides } = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(),
  exec: vi.fn(),
  overrides: { rows: [] as { module: string; access: string }[] },
}));

vi.mock('../../src/db/pool', () => ({
  exec,
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

const JOHN = '0b6a5b1c-3f0e-4b8e-9a51-6c2d7e8f9a01';
const LISA = '1c7b6c2d-4a1f-4c9f-8b62-7d3e8f9a0b12';

/** Answers the service's queries the way Postgres would for a small store in India. */
function stubStore() {
  one.mockImplementation(async (sql: string) => {
    if (/from staff s\s+join business b/.test(sql)) {
      return { id: JOHN, name: 'John', is_active: true, timezone: 'Asia/Kolkata' };
    }
    if (/from staff where id = \$1/.test(sql)) return { id: JOHN, name: 'John', is_active: true };
    if (/from business where id/.test(sql)) return { timezone: 'Asia/Kolkata', currency: 'INR' };
    return null;
  });
  many.mockImplementation(async (sql: string) => {
    if (/from user_permission/.test(sql)) return overrides.rows;
    if (/from visit_commission vc\s+left join/.test(sql)) return []; // the visit list
    if (/from visit_commission/.test(sql)) {
      return [
        { staff_id: JOHN, rate_bp: 2000, rate_from: '2026-10-02', visits: 2, revenue: '150000', commission: '30000' },
        { staff_id: null, rate_bp: null, rate_from: null, visits: 1, revenue: '40000', commission: '0' },
      ];
    }
    if (/from staff_commission_rate/.test(sql)) {
      return [{ staff_id: JOHN, rate_bp: 2000, effective_from: '2026-10-02' }];
    }
    if (/from staff/.test(sql)) {
      return [
        { id: JOHN, name: 'John', is_active: true },
        { id: LISA, name: 'Lisa', is_active: true },
      ];
    }
    return [];
  });
  exec.mockImplementation(async () => 1);
}

describe('commission API', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    many.mockReset();
    exec.mockReset();
    overrides.rows = [];
    stubStore();
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
    const { commissionRouter } = await import('../../src/modules/commission/commission.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/commission', commissionRouter);
    a.use(errorHandler);
    return a;
  }

  async function token(role: 'owner' | 'co_owner' | 'manager' | 'staff') {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    return `Bearer ${signAccessToken({
      userId: 'u1',
      businessId: 'b1',
      role: role as any,
      plan: 'free' as any,
      staffId: role === 'staff' ? JOHN : null,
    })}`;
  }

  const bucketCall = () => many.mock.calls.find((c) => /group by vc\.staff_id/.test(c[0] as string))!;

  describe('a staff login', () => {
    it('sees nothing until an owner turns earnings on for it', async () => {
      const res = await request(await app()).get('/api/v1/commission/summary').set('authorization', await token('staff'));
      expect(res.status).toBe(403);
    });

    it('once granted, sees only its own chair — no salon keeps, no unassigned, no other stylist', async () => {
      overrides.rows = [{ module: 'commission', access: 'view' }];
      const res = await request(await app())
        .get('/api/v1/commission/summary?range=month')
        .set('authorization', await token('staff'));

      expect(res.status).toBe(200);
      const [sql, params] = bucketCall();
      expect(sql).toMatch(/vc\.staff_id = \$4/);
      expect(params).toEqual(['b1', '2026-09-30T18:30:00.000Z', '2026-10-16T18:30:00.000Z', JOHN]);
      expect(res.body.scope).toBe('self');
      expect(res.body.totals.salonKeeps).toBeNull();
      expect(res.body.unassigned).toBeNull();
    });

    it("cannot read another chair's visits", async () => {
      overrides.rows = [{ module: 'commission', access: 'view' }];
      const res = await request(await app())
        .get(`/api/v1/commission/visits?staffId=${LISA}`)
        .set('authorization', await token('staff'));
      expect(res.status).toBe(403);
    });

    it('reads its own visits without naming itself', async () => {
      overrides.rows = [{ module: 'commission', access: 'view' }];
      const res = await request(await app()).get('/api/v1/commission/visits').set('authorization', await token('staff'));
      expect(res.status).toBe(200);
      expect(res.body.staff.staffId).toBe(JOHN);
    });

    it('can never read or set a rate — even holding a (clamped) manage row', async () => {
      overrides.rows = [{ module: 'commission', access: 'manage' }];
      const a = await app();
      const auth = await token('staff');
      expect((await request(a).get('/api/v1/commission/rates').set('authorization', auth)).status).toBe(403);
      expect((await request(a).put(`/api/v1/commission/rates/${JOHN}`).set('authorization', auth).send({ rateBp: 9000 })).status).toBe(403);
      expect((await request(a).delete(`/api/v1/commission/rates/${JOHN}/2026-10-20`).set('authorization', auth)).status).toBe(403);
      expect(exec).not.toHaveBeenCalled();
    });
  });

  describe('an owner', () => {
    it('reads the whole store, with salon keeps and visits that had no stylist', async () => {
      const res = await request(await app()).get('/api/v1/commission/summary').set('authorization', await token('owner'));

      expect(res.status).toBe(200);
      const [sql, params] = bucketCall();
      expect(sql).not.toMatch(/vc\.staff_id = \$4/);
      expect(params).toEqual(['b1', '2026-10-15T18:30:00.000Z', '2026-10-16T18:30:00.000Z']);
      expect(res.body).toMatchObject({
        range: 'today',
        from: '2026-10-16',
        today: '2026-10-16',
        scope: 'store',
        totals: {
          visits: 3,
          revenue: { amount: 190000, currency: 'INR' },
          commission: { amount: 30000, currency: 'INR' },
          salonKeeps: { amount: 160000, currency: 'INR' },
        },
        unassigned: { visits: 1, revenue: { amount: 40000, currency: 'INR' } },
      });
      expect(res.body.staff.map((s: { name: string }) => s.name)).toEqual(['John', 'Lisa']);
    });

    it("sets a rate from the STORE's today when no date is given — not the UTC date", async () => {
      const res = await request(await app())
        .put(`/api/v1/commission/rates/${JOHN}`)
        .set('authorization', await token('owner'))
        .send({ rateBp: 2000 });

      expect(res.status).toBe(200);
      const [sql, params] = exec.mock.calls[0]!;
      expect(sql).toMatch(/on conflict \(staff_id, effective_from\)/);
      expect(params).toEqual(['b1', JOHN, 2000, '2026-10-16', 'u1']);
      expect(res.body.today).toBe('2026-10-16');
    });

    it('schedules a future change', async () => {
      const res = await request(await app())
        .put(`/api/v1/commission/rates/${JOHN}`)
        .set('authorization', await token('co_owner'))
        .send({ rateBp: 3000, effectiveFrom: '2026-10-30' });
      expect(res.status).toBe(200);
      expect(exec.mock.calls[0]![1]).toEqual(['b1', JOHN, 3000, '2026-10-30', 'u1']);
    });

    it('cannot change a day that is over (409 COMMISSION_RATE_LOCKED)', async () => {
      const a = await app();
      const auth = await token('owner');
      const put = await request(a).put(`/api/v1/commission/rates/${JOHN}`).set('authorization', auth).send({ rateBp: 3000, effectiveFrom: '2026-10-15' });
      expect(put.status).toBe(409);
      expect(put.body.error.code).toBe('COMMISSION_RATE_LOCKED');
      const del = await request(a).delete(`/api/v1/commission/rates/${JOHN}/2026-10-15`).set('authorization', auth);
      expect(del.status).toBe(409);
      expect(exec).not.toHaveBeenCalled();
    });

    it('refuses nonsense: above 100%, fractions of a basis point, unreal dates, unknown fields, a year+ ahead', async () => {
      const a = await app();
      const auth = await token('owner');
      for (const body of [
        { rateBp: 10001 },
        { rateBp: -1 },
        { rateBp: 2000.5 },
        { rateBp: 2000, effectiveFrom: '2026-02-30' },
        { rateBp: 2000, staffId: LISA },
        { rateBp: 2000, effectiveFrom: '2027-10-17' },
      ]) {
        const res = await request(a).put(`/api/v1/commission/rates/${JOHN}`).set('authorization', auth).send(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      expect(exec).not.toHaveBeenCalled();
    });

    it("cannot set a rate on a removed chair or another store's chair", async () => {
      one.mockImplementation(async (sql: string) =>
        /from staff s\s+join business b/.test(sql) ? { id: JOHN, name: 'John', is_active: false, timezone: 'Asia/Kolkata' } : null,
      );
      const a = await app();
      const auth = await token('owner');
      expect((await request(a).put(`/api/v1/commission/rates/${JOHN}`).set('authorization', auth).send({ rateBp: 2000 })).status).toBe(404);
      one.mockImplementation(async () => null);
      expect((await request(a).put(`/api/v1/commission/rates/${LISA}`).set('authorization', auth).send({ rateBp: 2000 })).status).toBe(404);
    });

    it('removing a rate that does not exist is a 404', async () => {
      exec.mockImplementation(async () => 0);
      const res = await request(await app())
        .delete(`/api/v1/commission/rates/${JOHN}/2026-10-20`)
        .set('authorization', await token('owner'));
      expect(res.status).toBe(404);
    });

    it('must name the stylist whose visits it wants', async () => {
      const res = await request(await app()).get('/api/v1/commission/visits').set('authorization', await token('owner'));
      expect(res.status).toBe(400);
    });
  });

  it('the legacy manager reads the report but not the rates', async () => {
    const a = await app();
    const auth = await token('manager');
    expect((await request(a).get('/api/v1/commission/summary').set('authorization', auth)).status).toBe(200);
    expect((await request(a).get('/api/v1/commission/rates').set('authorization', auth)).status).toBe(403);
  });
});
