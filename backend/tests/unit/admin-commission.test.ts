import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The admin panel's read-only commission view (GET /admin/businesses/:id/commission). An employee
 * admin outside the store gets the same 404 as for a store that does not exist — never a 403 that
 * would confirm the id. No DB: the pool and the admin identity are stubbed.
 */

const { one, many, adminCanAccessBusiness } = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(),
  adminCanAccessBusiness: vi.fn(),
}));

vi.mock('../../src/db/pool', () => ({
  exec: vi.fn(async () => 0),
  many,
  one,
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

vi.mock('../../src/modules/admin/admin.service', () => ({
  getActiveAdminByMobile: vi.fn(async () => ({ id: 'admin-1', mobile: '919999999999', name: 'Admin', role: 'employee' })),
  adminCanAccessBusiness,
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

const STORE = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';

describe('admin commission view', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    many.mockReset();
    adminCanAccessBusiness.mockReset();
    one.mockImplementation(async () => ({ id: STORE, name: 'Sharp Cuts', slug: 'sharp-cuts', timezone: 'Asia/Kolkata', currency: 'INR' }));
    many.mockImplementation(async (sql: string) => {
      if (/from visit_commission/.test(sql)) {
        return [{ staff_id: 's1', rate_bp: 2000, rate_from: '2026-01-01', visits: 2, revenue: '100000', commission: '20000' }];
      }
      if (/from staff_commission_rate/.test(sql)) return [{ staff_id: 's1', rate_bp: 2000, effective_from: '2026-01-01' }];
      if (/from staff/.test(sql)) return [{ id: 's1', name: 'John', is_active: true }];
      return [];
    });
    process.env = { ...originalEnv, ...TEST_ENV };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  async function app() {
    const { adminRouter } = await import('../../src/modules/admin/admin.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/admin', adminRouter);
    a.use(errorHandler);
    return a;
  }

  async function adminToken() {
    const { signAdminToken } = await import('../../src/modules/auth/token.service');
    return `Bearer ${signAdminToken('919999999999')}`;
  }

  it("is a 404 for an employee admin outside the store — the same answer as a store that doesn't exist", async () => {
    adminCanAccessBusiness.mockResolvedValue(false);
    const res = await request(await app())
      .get(`/api/v1/admin/businesses/${STORE}/commission`)
      .set('authorization', await adminToken());
    expect(res.status).toBe(404);
    expect(many).not.toHaveBeenCalled();
  });

  it("returns the store's commission by stylist for an admin who can see the store", async () => {
    adminCanAccessBusiness.mockResolvedValue(true);
    const res = await request(await app())
      .get(`/api/v1/admin/businesses/${STORE}/commission?from=2026-10-01&to=2026-10-31`)
      .set('authorization', await adminToken());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
      scope: 'store',
      totals: { commission: { amount: 20000, currency: 'INR' }, salonKeeps: { amount: 80000, currency: 'INR' } },
    });
    expect(res.body.staff[0]).toMatchObject({ name: 'John', currentRateBp: 2000 });
  });

  it('refuses a date that does not exist', async () => {
    adminCanAccessBusiness.mockResolvedValue(true);
    const res = await request(await app())
      .get(`/api/v1/admin/businesses/${STORE}/commission?from=2026-02-30`)
      .set('authorization', await adminToken());
    expect(res.status).toBe(400);
  });
});
