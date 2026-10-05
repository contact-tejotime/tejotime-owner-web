import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The nine homepage industry stores (docs/demo-stores.md) are real tenants that the admin panel
 * shows apart from the platform's stores: flagged `isDemo`, left out of every platform figure
 * (dashboard, Team counts — Customers/Reports/Billing filter the flagged list in the panel), and
 * never disable-able, because each one backs a public homepage card that would become a 404.
 *
 * Database (and RPCs) stubbed — no DB, no server. The live-environment counterpart is the ADMIN
 * section of backend/scripts/smoke-demo-stores.mjs, which needs an admin login.
 */

const { one, many, transaction, callRpc } = vi.hoisted(() => ({
  one: vi.fn(async (..._args: any[]): Promise<any> => null),
  many: vi.fn(async (..._args: any[]): Promise<any[]> => []),
  transaction: vi.fn(),
  callRpc: vi.fn(),
}));

// Only the data layer is stubbed; admin.service is the real one throughout. (A partial mock of it
// via importOriginal loads a second copy of domain/errors after resetModules, and the error
// handler's `instanceof AppError` then turns a 409 into a 500.)
vi.mock('../../src/db/pool', () => ({ exec: vi.fn(async () => 0), many, one, transaction, pool: { on: vi.fn() } }));
vi.mock('../../src/db/rpc', () => ({ callRpc }));

/** Sentinel: the guard let the update through and it reached the write. */
const REACHED_WRITE = new Error('reached-write');

const DEMO_PHONE = '15125550101'; // Willow & Co. Hair Studio (/salon)
const REGULAR_PHONE = '12393160008';
const DEMO_ID = '6f1d1c1e-1111-4111-8111-111111111111';
const REGULAR_ID = '6f1d1c1e-2222-4222-8222-222222222222';
const DEMO_STORE_SLUG_ID = '6f1d1c1e-3333-4333-8333-333333333333';

function storeInput(phoneFull: string, isActive?: boolean) {
  return {
    name: 'Store',
    category: 'Salon & Barber',
    area: 'Downtown',
    address: '1 Main St',
    city: 'Austin',
    tagline: 'Cuts',
    description: 'A salon.',
    aboutHeading: 'About us',
    countryCode: phoneFull.slice(0, 1),
    phoneNumber: phoneFull.slice(1),
    ...(isActive === undefined ? {} : { isActive }),
    hours: [],
    amenities: [],
    gallery: [],
    services: [],
    staff: [],
    faqs: [],
    reviews: [],
  } as never;
}

describe('demo stores in the admin panel', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    many.mockReset();
    many.mockResolvedValue([]);
    transaction.mockReset();
    transaction.mockRejectedValue(REACHED_WRITE);
    callRpc.mockReset();
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

  async function service() {
    return import('../../src/modules/admin/admin.service');
  }

  /** First `one()` is updateBusiness's existing-row read; later ones (phone-in-use) find nothing. */
  function existingStore(phoneFull: string) {
    one.mockResolvedValueOnce({ id: DEMO_ID, currency: 'USD', theme_color: null, phone_full: phoneFull, timezone: null });
    one.mockResolvedValue(null);
  }

  describe('a demo store can never be disabled', () => {
    it('service: refuses isActive=false with 409 DEMO_STORE_ALWAYS_ON and writes nothing', async () => {
      existingStore(DEMO_PHONE);
      const err = await (await service()).updateBusiness(DEMO_ID, storeInput(DEMO_PHONE, false)).catch((e) => e);
      expect(err).toMatchObject({ httpStatus: 409, code: 'DEMO_STORE_ALWAYS_ON' });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('service: still lets admins edit a demo store, or switch it on', async () => {
      existingStore(DEMO_PHONE);
      await expect((await service()).updateBusiness(DEMO_ID, storeInput(DEMO_PHONE))).rejects.toBe(REACHED_WRITE);
      existingStore(DEMO_PHONE);
      await expect((await service()).updateBusiness(DEMO_ID, storeInput(DEMO_PHONE, true))).rejects.toBe(REACHED_WRITE);
    });

    it('service: a regular store can still be disabled', async () => {
      existingStore(REGULAR_PHONE);
      await expect((await service()).updateBusiness(REGULAR_ID, storeInput(REGULAR_PHONE, false))).rejects.toBe(
        REACHED_WRITE,
      );
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
      return signAdminToken('919999999999');
    }

    /** requireAdminAuth's admins lookup gets an owner; the store lookup gets `phoneFull`. */
    function dbAnswers(phoneFull: string) {
      one.mockImplementation(async (sql: string) =>
        sql.includes('from admins')
          ? { id: 'admin-1', mobile: '919999999999', name: 'Admin', role: 'owner' }
          : { phone_full: phoneFull },
      );
    }

    it('route: a bare {isActive:false} on a demo store is refused BEFORE body validation (409, not 400)', async () => {
      // Checked ahead of the schema on purpose: if this guard ever broke, the same request would
      // fail validation (400) instead of writing — which is what lets the smoke script send it to a
      // live environment safely.
      dbAnswers(DEMO_PHONE);
      const res = await request(await app())
        .put(`/api/v1/admin/businesses/${DEMO_ID}`)
        .set('authorization', `Bearer ${await adminToken()}`)
        .send({ isActive: false });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DEMO_STORE_ALWAYS_ON');
      expect(transaction).not.toHaveBeenCalled();
    });

    it('route: the same request for a regular store passes the guard and reaches body validation', async () => {
      dbAnswers(REGULAR_PHONE);
      const res = await request(await app())
        .put(`/api/v1/admin/businesses/${REGULAR_ID}`)
        .set('authorization', `Bearer ${await adminToken()}`)
        .send({ isActive: false });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('the panel can tell demo stores apart', () => {
    it('GET /admin/businesses rows carry isDemo', async () => {
      many.mockResolvedValueOnce([
        { id: DEMO_ID, name: 'Willow', slug: 'willow', category: 'Salon & Barber', city: 'Austin', country_code: '1', phone_number: '5125550101', is_active: true, created_at: 'x' },
        { id: REGULAR_ID, name: 'Curv', slug: 'curv', category: 'Salon', city: 'Naples', country_code: '1', phone_number: '2393160008', is_active: true, created_at: 'x' },
      ]);
      const { data } = await (await service()).listBusinesses();
      // demoIndustry is the homepage card, shown in place of the shared "Salon & Barber" category.
      expect(data.map((b: any) => [b.id, b.isDemo, b.demoIndustry])).toEqual([
        [DEMO_ID, true, 'Hair salons'],
        [REGULAR_ID, false, null],
      ]);
    });

    it('GET /admin/businesses/:id carries isDemo and demoIndustry', async () => {
      one.mockResolvedValueOnce({ id: DEMO_ID, name: 'Willow', country_code: '1', phone_number: '5125550101', is_active: true });
      one.mockResolvedValue(null);
      const detail = await (await service()).getBusinessDetail(DEMO_ID);
      expect(detail.isDemo).toBe(true);
      expect(detail.demoIndustry).toBe('Hair salons');
    });
  });

  describe('demo stores are left out of platform figures', () => {
    it('dashboard overview: not counted as stores, customers, visits or bookings', async () => {
      many.mockResolvedValueOnce([
        { id: REGULAR_ID, slug: 'curv', city: 'Naples', category: 'Salon', is_active: true, phone_full: REGULAR_PHONE },
        { id: DEMO_ID, slug: 'willow', city: 'Austin', category: 'Salon & Barber', is_active: true, phone_full: DEMO_PHONE },
        { id: DEMO_STORE_SLUG_ID, slug: 'demo-store', city: 'Naples', category: 'Salon & Barber', is_active: true, phone_full: '12395550110' },
      ]);
      callRpc.mockImplementation(async (fn: string, args: any) => {
        if (fn === 'admin_store_metrics') {
          return [
            { business_id: REGULAR_ID, customers_count: 5 },
            { business_id: DEMO_ID, customers_count: 40 },
          ];
        }
        if (fn === 'admin_daily_revenue') {
          // Platform-wide (null) includes the demo store's 3 visits; asked per store, it has 3.
          if (args.p_business_id === null) return [{ day: '2026-10-01', visits: 10, revenue_paise: 0 }];
          if (args.p_business_id === DEMO_ID) return [{ day: '2026-10-01', visits: 3, revenue_paise: 0 }];
          return [];
        }
        throw new Error(`unexpected rpc ${fn}`);
      });
      one.mockResolvedValue({ count: 2 });

      const { getPlatformOverview } = await import('../../src/modules/admin/admin-analytics.service');
      const o = await getPlatformOverview(null);

      expect(o.stores).toEqual({ total: 1, active: 1, inactive: 0 });
      expect(o.totalCustomers).toBe(5);
      expect(o.today.visits).toBe(7);
      expect(o.storesByCity).toEqual([{ city: 'Naples', count: 1 }]);
      // The online-bookings count is asked to skip both the demo store and /demo-store.
      const [sql, params] = one.mock.calls.at(-1)!;
      expect(sql).toMatch(/business_id <> all\(/);
      expect(params.at(-1)).toEqual(expect.arrayContaining([DEMO_ID, DEMO_STORE_SLUG_ID]));
    });

    it('Team: an admin\'s store count skips the demo stores', async () => {
      const { DEMO_STORE_PHONES } = await import('../../src/domain/demo-stores');
      many.mockResolvedValueOnce([{ id: 'a1', mobile: '91', name: 'Owner', role: 'owner', is_active: true, stores_count: 3, created_at: 'x' }]);
      await (await service()).listAdmins();
      const [sql, params] = many.mock.calls[0]!;
      expect(sql).toMatch(/phone_full.*<> all\(/s);
      expect(params).toEqual([DEMO_STORE_PHONES]);
    });
  });
});
