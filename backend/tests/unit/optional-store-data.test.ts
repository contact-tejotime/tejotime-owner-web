import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pictures, stylists, prices and services are OPTIONAL: a store collects as little as it can.
 * This pins the API boundary of that, through the real routers and error handler with the
 * database (and the admin service) stubbed — no DB, no server.
 *
 * What it does NOT cover, because it needs a real Postgres: migration 0030 (`queue_start`,
 * `_queue_renumber`, `queue_move`, `queue_checkout` with a NULL seat / no service). Those are the
 * `backend/scripts/smoke-rest.mjs` cases.
 */

const { one, many, createBusiness, setGallery } = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(async () => []),
  createBusiness: vi.fn(),
  setGallery: vi.fn(async (_businessId: string, images: unknown[]) => ({ gallery: images })),
}));

vi.mock('../../src/db/pool', () => ({
  exec: vi.fn(async () => 0),
  many,
  one,
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

vi.mock('../../src/modules/admin/admin.service', () => ({
  getActiveAdminByMobile: vi.fn(async () => ({ id: 'admin-1', mobile: '919999999999', name: 'Admin', role: 'owner' })),
  createBusiness,
}));

vi.mock('../../src/modules/business/business.service', () => ({ setGallery }));

const SERVICES = '/api/v1/services';
const ADMIN_BUSINESSES = '/api/v1/admin/businesses';
const OWNER_GALLERY = '/api/v1/business/gallery';

describe('optional store data', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    createBusiness.mockReset();
    setGallery.mockClear();
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
    const { servicesRouter } = await import('../../src/modules/services/services.routes');
    const { adminRouter } = await import('../../src/modules/admin/admin.routes');
    const { businessRouter } = await import('../../src/modules/business/business.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/services', servicesRouter);
    a.use('/api/v1/admin', adminRouter);
    a.use('/api/v1/business', businessRouter);
    a.use(errorHandler);
    return a;
  }

  async function ownerToken() {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    return signAccessToken({ userId: 'u1', businessId: 'b1', role: 'owner' as any, plan: 'free' as any, staffId: null });
  }

  async function adminToken() {
    const { signAdminToken } = await import('../../src/modules/auth/token.service');
    return signAdminToken('919999999999');
  }

  const serviceRow = (o: Record<string, unknown> = {}) => ({
    id: 's1',
    name: 'Haircut',
    duration_minutes: 30,
    price_paise: 0,
    price_type: 'unset',
    price_max_paise: null,
    currency: 'INR',
    color_token: 'primary',
    is_active: true,
    position: 0,
    ...o,
  });

  const baseService = { name: 'Haircut', durationMinutes: 30, colorToken: 'primary' };

  describe('service price is optional (owner API)', () => {
    it('saves a service with NO price: mode unset, stored as 0 with no ceiling', async () => {
      one.mockResolvedValueOnce({ currency: 'INR' }).mockResolvedValueOnce(serviceRow());
      const res = await request(await app())
        .post(SERVICES)
        .set('authorization', `Bearer ${await ownerToken()}`)
        .send({ ...baseService, priceType: 'unset' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ priceType: 'unset', priceMax: null });
      // The insert's params: [business, name, duration, price_paise, price_type, price_max, ...]
      const params = one.mock.calls[1]![1] as unknown[];
      expect(params.slice(3, 6)).toEqual([0, 'unset', null]);
    });

    it('stores 0 for an unpriced service even if the caller sends an amount', async () => {
      one.mockResolvedValueOnce({ currency: 'INR' }).mockResolvedValueOnce(serviceRow());
      const res = await request(await app())
        .post(SERVICES)
        .set('authorization', `Bearer ${await ownerToken()}`)
        .send({ ...baseService, priceType: 'unset', priceAmount: 50000 });

      expect(res.status).toBe(201);
      const params = one.mock.calls[1]![1] as unknown[];
      expect(params.slice(3, 6)).toEqual([0, 'unset', null]);
    });

    it('still demands a positive amount for a FIXED service', async () => {
      for (const body of [
        { ...baseService, priceType: 'fixed' },
        { ...baseService, priceType: 'fixed', priceAmount: 0 },
      ]) {
        const res = await request(await app())
          .post(SERVICES)
          .set('authorization', `Bearer ${await ownerToken()}`)
          .send(body);
        expect(res.status).toBe(400);
      }
      expect(one).not.toHaveBeenCalled();
    });

    it('still demands a floor and a ceiling for a RANGE service', async () => {
      const res = await request(await app())
        .post(SERVICES)
        .set('authorization', `Bearer ${await ownerToken()}`)
        .send({ ...baseService, priceType: 'range', priceAmount: 200000 });
      expect(res.status).toBe(400);
    });

    it('lets a PATCH switch a priced service to unset with no amount, clearing the ceiling', async () => {
      one.mockResolvedValueOnce(serviceRow());
      const res = await request(await app())
        .patch(`${SERVICES}/2f7c9d3e-8a1b-4c5d-9e6f-0a1b2c3d4e5f`)
        .set('authorization', `Bearer ${await ownerToken()}`)
        .send({ priceType: 'unset' });

      expect(res.status).toBe(200);
      const sql = one.mock.calls[0]![0] as string;
      const params = one.mock.calls[0]![1] as unknown[];
      expect(sql).toMatch(/price_paise = \$\d/);
      expect(params).toContain(0);
      expect(params).toContain('unset');
      expect(params).toContain(null); // price_max_paise
    });

    it('refuses a PATCH that changes to a priced mode without the amount', async () => {
      const res = await request(await app())
        .patch(`${SERVICES}/2f7c9d3e-8a1b-4c5d-9e6f-0a1b2c3d4e5f`)
        .set('authorization', `Bearer ${await ownerToken()}`)
        .send({ priceType: 'fixed' });
      expect(res.status).toBe(400);
      expect(one).not.toHaveBeenCalled();
    });

    it('requires a signed-in caller', async () => {
      const res = await request(await app()).post(SERVICES).send({ ...baseService, priceType: 'unset' });
      expect(res.status).toBe(401);
    });
  });

  describe('a store can be provisioned with no services, no staff and no pictures (admin API)', () => {
    /**
     * The fields the API genuinely requires — nothing about services, staff or images, no
     * neighborhood ("area"), optional since the client review of 2026-10-05, and no About heading
     * or text, optional since its row 36 (2026-10-08).
     */
    const minimalStore = () => ({
      name: 'Curv Beauty',
      category: 'Salon & Barber', // was the strictest category: needed one service AND one stylist
      address: '1 Main St',
      city: 'Naples',
      tagline: 'Hair and beauty',
      countryCode: '91',
      phoneNumber: '9399385943',
      hours: [],
      owner: { password: 'secret123' },
    });

    it('accepts a Salon & Barber store with empty services and staff, and omitted images', async () => {
      createBusiness.mockResolvedValue({ id: 'b-new' });
      const res = await request(await app())
        .post(ADMIN_BUSINESSES)
        .set('authorization', `Bearer ${await adminToken()}`)
        .send({ ...minimalStore(), services: [], staff: [] });

      expect(res.status).toBe(201);
      expect(createBusiness).toHaveBeenCalledTimes(1);
      const stored = createBusiness.mock.calls[0]![0];
      expect(stored.services).toEqual([]);
      expect(stored.staff).toEqual([]);
      expect(stored.heroImageUrl).toBeUndefined();
      expect(stored.logoUrl).toBeUndefined();
      expect(stored.gallery).toEqual([]);
    });

    it('needs no neighborhood: the page shows the city instead (client review, point 30)', async () => {
      createBusiness.mockResolvedValue({ id: 'b-new' });
      const res = await request(await app())
        .post(ADMIN_BUSINESSES)
        .set('authorization', `Bearer ${await adminToken()}`)
        .send(minimalStore());
      expect(res.status).toBe(201);
      expect(createBusiness.mock.calls[0]![0].area).toBeUndefined();
    });

    it('needs no About heading or text; blank ones are accepted and long ones refused (point 36)', async () => {
      createBusiness.mockResolvedValue({ id: 'b-new' });
      const send = async (extra: Record<string, string>) =>
        request(await app())
          .post(ADMIN_BUSINESSES)
          .set('authorization', `Bearer ${await adminToken()}`)
          .send({ ...minimalStore(), ...extra });
      expect((await send({})).status).toBe(201);
      expect(createBusiness.mock.calls[0]![0].description).toBeUndefined();
      expect(createBusiness.mock.calls[0]![0].aboutHeading).toBeUndefined();
      // Spaces are trimmed to '' (businessColumns then stores NULL), not refused.
      expect((await send({ description: '   ', aboutHeading: ' ' })).status).toBe(201);
      expect(createBusiness.mock.calls[1]![0]).toMatchObject({ description: '', aboutHeading: '' });
      expect((await send({ description: 'x'.repeat(2001) })).status).toBe(400);
      expect((await send({ aboutHeading: 'x'.repeat(161) })).status).toBe(400);
      expect(createBusiness).toHaveBeenCalledTimes(2);
    });

    it('still takes the removed highlight fields from an old admin build, rather than failing the save', async () => {
      createBusiness.mockResolvedValue({ id: 'b-new' });
      const res = await request(await app())
        .post(ADMIN_BUSINESSES)
        .set('authorization', `Bearer ${await adminToken()}`)
        .send({ ...minimalStore(), statValue: '30k+', statLabel: 'haircuts done' });
      expect(res.status).toBe(201);
    });

    it('takes a gallery heading of up to 40 characters, or "" to clear it, and refuses a longer one', async () => {
      createBusiness.mockResolvedValue({ id: 'b-new' });
      const send = async (galleryHeading: string) =>
        request(await app())
          .post(ADMIN_BUSINESSES)
          .set('authorization', `Bearer ${await adminToken()}`)
          .send({ ...minimalStore(), galleryHeading });
      expect((await send('Inside the shop')).status).toBe(201);
      expect((await send('')).status).toBe(201);
      expect((await send('x'.repeat(41))).status).toBe(400);
      expect(createBusiness.mock.calls[0]![0].galleryHeading).toBe('Inside the shop');
    });

    it('still requires the headline (tagline)', async () => {
      const { tagline: _t, ...noHeadline } = minimalStore();
      const res = await request(await app())
        .post(ADMIN_BUSINESSES)
        .set('authorization', `Bearer ${await adminToken()}`)
        .send(noHeadline);
      expect(res.status).toBe(400);
      expect(createBusiness).not.toHaveBeenCalled();
    });

    it('takes a valid timezone, an empty one (= automatic), and refuses an unknown one', async () => {
      createBusiness.mockResolvedValue({ id: 'b-new' });
      const send = async (timezone: string) =>
        request(await app())
          .post(ADMIN_BUSINESSES)
          .set('authorization', `Bearer ${await adminToken()}`)
          .send({ ...minimalStore(), services: [], staff: [], timezone });

      expect((await send('America/New_York')).status).toBe(201);
      expect((await send('')).status).toBe(201);
      expect((await send('Mars/Olympus')).status).toBe(400); // dayjs.tz would throw on it at render time
      expect(createBusiness).toHaveBeenCalledTimes(2);
      expect(createBusiness.mock.calls[0]![0].timezone).toBe('America/New_York');
    });

    it('accepts services and staff omitted entirely (defaults to none)', async () => {
      createBusiness.mockResolvedValue({ id: 'b-new' });
      const res = await request(await app())
        .post(ADMIN_BUSINESSES)
        .set('authorization', `Bearer ${await adminToken()}`)
        .send(minimalStore());

      expect(res.status).toBe(201);
      expect(createBusiness.mock.calls[0]![0]).toMatchObject({ services: [], staff: [] });
    });

    it('accepts an unpriced service with no amount, and refuses a fixed one with none', async () => {
      createBusiness.mockResolvedValue({ id: 'b-new' });
      const ok = await request(await app())
        .post(ADMIN_BUSINESSES)
        .set('authorization', `Bearer ${await adminToken()}`)
        .send({ ...minimalStore(), services: [{ name: 'Haircut', durationMinutes: 30, priceType: 'unset' }] });
      expect(ok.status).toBe(201);

      const bad = await request(await app())
        .post(ADMIN_BUSINESSES)
        .set('authorization', `Bearer ${await adminToken()}`)
        .send({ ...minimalStore(), services: [{ name: 'Haircut', durationMinutes: 30, priceType: 'fixed' }] });
      expect(bad.status).toBe(400);
      expect(createBusiness).toHaveBeenCalledTimes(1); // only the valid one got through
    });

    it('accepts an optional staff commission, and refuses one above 100%', async () => {
      createBusiness.mockResolvedValue({ id: 'b-new' });
      const send = async (staff: object[]) =>
        request(await app())
          .post(ADMIN_BUSINESSES)
          .set('authorization', `Bearer ${await adminToken()}`)
          .send({ ...minimalStore(), staff });

      const withRate = await send([{ name: 'Lalu', roleLabel: 'Hair master', rateBp: 2000 }]);
      expect(withRate.status).toBe(201);
      expect(createBusiness.mock.calls.at(-1)![0].staff).toEqual([
        { name: 'Lalu', roleLabel: 'Hair master', rateBp: 2000 },
      ]);

      const blank = await send([{ name: 'Lalu', roleLabel: 'Hair master', rateBp: null }]);
      expect(blank.status).toBe(201);
      expect(createBusiness.mock.calls.at(-1)![0].staff[0].rateBp).toBeNull();

      const omitted = await send([{ name: 'Lalu', roleLabel: 'Hair master' }]);
      expect(omitted.status).toBe(201);
      expect(createBusiness.mock.calls.at(-1)![0].staff[0].rateBp).toBeUndefined();

      const tooHigh = await send([{ name: 'Lalu', roleLabel: 'Hair master', rateBp: 10001 }]);
      expect(tooHigh.status).toBe(400);
      expect(createBusiness).toHaveBeenCalledTimes(3);
    });
  });

  describe('chat facts say nothing about a price the page does not show', () => {
    it('renders an unpriced service without a price', async () => {
      const { factsReply } = await import('../../src/lib/chat-faq');
      const facts: any = {
        name: 'Curv',
        category: null,
        services: [
          { name: 'Haircut', priceLabel: '', minutes: 30 },
          { name: 'Beard Trim', priceLabel: '₹150', minutes: 15 },
        ],
        staff: [],
        live: { queueCount: 0, waitMinutes: 0 },
        hoursLines: [],
        hasHours: false,
        payments: [],
        faqs: [],
        address: null,
        phone: null,
        statusLabel: '',
        isOpen: true,
      };
      const reply = factsReply('services' as any, [], facts) ?? '';
      expect(reply).toContain('• Haircut — 30 min');
      expect(reply).toContain('• Beard Trim — ₹150 · 15 min');
      expect(reply).not.toMatch(/Price on request/i);
    });
  });

  describe('the photo gallery holds up to 12 photos (client review row 26, 2026-10-08; it was 7)', () => {
    const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://cdn.example.com/g${i}.jpg`, alt: null }));

    it('the owner can save 12 photos; a 13th is refused before anything is written', async () => {
      const a = await app();
      const token = await ownerToken();
      const twelve = await request(a).put(OWNER_GALLERY).set('authorization', `Bearer ${token}`).send({ images: photos(12) });
      expect(twelve.status).toBe(200);
      expect(setGallery).toHaveBeenCalledTimes(1);
      expect(setGallery.mock.calls[0]![1]).toHaveLength(12);

      const thirteen = await request(a).put(OWNER_GALLERY).set('authorization', `Bearer ${token}`).send({ images: photos(13) });
      expect(thirteen.status).toBe(400);
      expect(setGallery).toHaveBeenCalledTimes(1);
    });

    it('admin create takes 12 photos and refuses 13', async () => {
      createBusiness.mockResolvedValue({ id: 'b-new' });
      const send = async (n: number) =>
        request(await app())
          .post(ADMIN_BUSINESSES)
          .set('authorization', `Bearer ${await adminToken()}`)
          .send({ ...minimalStoreForGallery(), gallery: photos(n) });
      expect((await send(12)).status).toBe(201);
      expect(createBusiness.mock.calls[0]![0].gallery).toHaveLength(12);
      expect((await send(13)).status).toBe(400);
      expect(createBusiness).toHaveBeenCalledTimes(1);
    });

    const minimalStoreForGallery = () => ({
      name: 'Curv Beauty',
      category: 'Salon & Barber',
      address: '1 Main St',
      city: 'Naples',
      tagline: 'Hair and beauty',
      countryCode: '91',
      phoneNumber: '9399385943',
      hours: [],
      owner: { password: 'secret123' },
    });
  });
});
