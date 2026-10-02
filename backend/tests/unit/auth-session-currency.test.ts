import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The session (`/auth/me`, and login, which shares `businessSummary`) must carry the store's
 * currency. owner-web and the Expo app have no other way to learn it for the price-input
 * prefixes and the checkout amount box: staff cannot call `GET /business` (it needs `profile`),
 * and a store with no services has no Money object to read a code off. Without it those
 * surfaces fell back to a hardcoded ₹ on a store the admin had set to USD.
 *
 * The pool stub answers the business query with ONLY the columns its SQL names, the way
 * Postgres does — a stub that returned the whole row would hide exactly the missing column
 * this pins.
 */

const { one, many } = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(async () => []),
}));

vi.mock('../../src/db/pool', () => ({
  exec: vi.fn(async () => 0),
  many,
  one,
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

const BUSINESS_ROW: Record<string, unknown> = {
  id: 'b1',
  name: 'A one',
  slug: 'a-one',
  category: 'Restaurant',
  currency: 'USD',
  theme: null,
  themeColor: null,
};

/** The row, narrowed to the keys the statement actually selects. */
function selected(sql: string, row: Record<string, unknown>) {
  const list = sql.slice(sql.indexOf('select') + 6, sql.indexOf('from'));
  return Object.fromEntries(Object.entries(row).filter(([k]) => new RegExp(`\\b${k}\\b`).test(list)));
}

describe('session carries the store currency', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    one.mockImplementation(async (sql: string) => {
      if (/from app_user/.test(sql)) {
        return { id: 'u1', name: 'Owner', role: 'owner', dark_mode: false, staff_id: null, is_super_owner: true };
      }
      if (/from business/.test(sql)) return selected(sql, BUSINESS_ROW);
      return null;
    });
    process.env = {
      ...originalEnv,
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
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  async function app() {
    const { authRouter } = await import('../../src/modules/auth/auth.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/auth', authRouter);
    a.use(errorHandler);
    return a;
  }

  async function token(role: 'owner' | 'staff') {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    return signAccessToken({
      userId: 'u1',
      businessId: 'b1',
      role: role as any,
      plan: 'free' as any,
      staffId: role === 'staff' ? 'st1' : null,
    });
  }

  it("GET /auth/me returns the business's own currency, not a default", async () => {
    const res = await request(await app())
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${await token('owner')}`);

    expect(res.status).toBe(200);
    expect(res.body.business).toMatchObject({ id: 'b1', currency: 'USD' });
  });

  it('a staff login gets it too — staff cannot read GET /business', async () => {
    one.mockImplementation(async (sql: string) => {
      if (/from app_user/.test(sql)) {
        return { id: 'u1', name: 'Lisa', role: 'staff', dark_mode: false, staff_id: 'st1', is_super_owner: false };
      }
      if (/from business/.test(sql)) return selected(sql, BUSINESS_ROW);
      return null;
    });
    const res = await request(await app())
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${await token('staff')}`);

    expect(res.status).toBe(200);
    expect(res.body.business.currency).toBe('USD');
  });
});
