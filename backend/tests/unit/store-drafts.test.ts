import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Admin-panel "Save as draft" (migration 0031). Pins the API boundary through the real admin
 * router and error handler, with the database stubbed — no DB, no server.
 *
 * What it does NOT cover, because it needs a real Postgres: the migration itself and the actual
 * SQL. The SQL's `admin_id = $n` filter is asserted here only as "the admin's id is passed as the
 * scoping parameter"; that the WHERE clause really hides another admin's row is the
 * `backend/scripts/smoke-store-drafts.mjs` cross-admin case.
 */

const { one, many, exec, getActiveAdmin } = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(async () => []),
  exec: vi.fn(async () => 1),
  getActiveAdmin: vi.fn(),
}));

vi.mock('../../src/db/pool', () => ({
  exec,
  many,
  one,
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

vi.mock('../../src/modules/admin/admin.service', () => ({ getActiveAdminByMobile: getActiveAdmin }));

const DRAFTS = '/api/v1/admin/store-drafts';
const ID = '3f1c2a54-8f0e-4a55-9a51-0a1c7f1b2d10';
const ME = { id: 'admin-1', mobile: '919999999999', name: 'Admin', role: 'owner' };
const NOW = new Date('2026-09-28T09:00:00.000Z');

describe('store drafts', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    many.mockReset();
    many.mockResolvedValue([]);
    exec.mockReset();
    exec.mockResolvedValue(1);
    getActiveAdmin.mockReset();
    getActiveAdmin.mockResolvedValue(ME);
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
    const { adminRouter } = await import('../../src/modules/admin/admin.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json({ limit: '1mb' }));
    a.use(requestId);
    a.use('/api/v1/admin', adminRouter);
    a.use(errorHandler);
    return a;
  }

  async function adminToken() {
    const { signAdminToken } = await import('../../src/modules/auth/token.service');
    return signAdminToken('919999999999');
  }

  const authed = async (r: request.Test) => r.set('authorization', `Bearer ${await adminToken()}`);

  describe('access', () => {
    it('every route needs the admin token', async () => {
      const a = await app();
      for (const [method, path] of [
        ['get', DRAFTS],
        ['get', `${DRAFTS}/${ID}`],
        ['post', DRAFTS],
        ['put', `${DRAFTS}/${ID}`],
        ['delete', `${DRAFTS}/${ID}`],
      ] as const) {
        const res = await request(a)[method](path).send({ data: {} });
        expect(res.status, `${method} ${path}`).toBe(401);
      }
      expect(one).not.toHaveBeenCalled();
      expect(many).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('saves the form, and NEVER stores the owner password', async () => {
      one.mockResolvedValueOnce({ n: '0' }).mockResolvedValueOnce({ id: ID, updated_at: NOW });
      const res = await authed(
        request(await app())
          .post(DRAFTS)
          .send({
            data: {
              name: '  Sharp Cuts ',
              city: 'Pune',
              ownerPhone: '919812345678',
              ownerPassword: 'hunter2hunter2',
              owner: { phone: '919812345678', password: 'hunter2hunter2' },
            },
          }),
      );

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(ID);
      expect(JSON.stringify(res.body)).not.toContain('hunter2');

      // insert params: [adminId, name, data-json]
      const [adminId, name, json] = one.mock.calls[1]![1] as [string, string, string];
      expect(adminId).toBe('admin-1');
      expect(name).toBe('Sharp Cuts'); // trimmed, denormalised for the sidebar
      expect(json).not.toContain('hunter2');
      expect(JSON.parse(json)).toMatchObject({ city: 'Pune', ownerPhone: '919812345678' });
    });

    it('accepts a nearly empty draft — an incomplete form is the whole point', async () => {
      one.mockResolvedValueOnce({ n: '0' }).mockResolvedValueOnce({ id: ID, updated_at: NOW });
      const res = await authed(request(await app()).post(DRAFTS).send({ data: {} }));
      expect(res.status).toBe(201);
      const [, name] = one.mock.calls[1]![1] as [string, string | null];
      expect(name).toBeNull();
    });

    it('refuses the 51st draft with a 409', async () => {
      one.mockResolvedValueOnce({ n: '50' });
      const res = await authed(request(await app()).post(DRAFTS).send({ data: { name: 'x' } }));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DRAFT_LIMIT');
      expect(one).toHaveBeenCalledTimes(1); // never reached the insert
    });

    it('rejects a body with no data, an unknown key, or an oversize form', async () => {
      const a = await app();
      for (const body of [{}, { data: {}, extra: 1 }, { data: 'nope' }, { data: { blob: 'x'.repeat(300 * 1024) } }]) {
        const res = await authed(request(a).post(DRAFTS).send(body));
        expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      }
      expect(one).not.toHaveBeenCalled();
    });
  });

  describe('scoping', () => {
    it('lists only the caller, and shapes phoneFull like a store row', async () => {
      many.mockResolvedValueOnce([
        { id: ID, name: 'Sharp Cuts', data: { category: 'Salon', countryCode: '91', phoneNumber: '9812345678' }, updated_at: NOW },
        { id: 'd2', name: null, data: {}, updated_at: NOW },
      ] as never);
      const res = await authed(request(await app()).get(DRAFTS));

      expect(res.status).toBe(200);
      expect(many.mock.calls[0]![1]).toEqual(['admin-1']);
      expect(res.body.data).toEqual([
        { id: ID, name: 'Sharp Cuts', category: 'Salon', phoneFull: '919812345678', updatedAt: NOW.toISOString() },
        { id: 'd2', name: null, category: null, phoneFull: null, updatedAt: NOW.toISOString() },
      ]);
    });

    it("scopes every by-id query on the caller's own admin id — a second admin passes THEIR id", async () => {
      const a = await app();
      getActiveAdmin.mockResolvedValue({ ...ME, id: 'admin-2', role: 'employee' });
      one.mockResolvedValue(null); // not theirs → the SQL returns no row

      const get = await authed(request(a).get(`${DRAFTS}/${ID}`));
      const put = await authed(request(a).put(`${DRAFTS}/${ID}`).send({ data: { name: 'x' } }));

      // A draft that is not yours is indistinguishable from one that never existed.
      expect(get.status).toBe(404);
      expect(put.status).toBe(404);
      expect(one.mock.calls[0]![1]).toEqual([ID, 'admin-2']);
      expect(one.mock.calls[1]![1]).toEqual([ID, 'admin-2', 'x', JSON.stringify({ name: 'x' })]);
    });

    it('rejects a non-uuid id before touching the database', async () => {
      const res = await authed(request(await app()).get(`${DRAFTS}/not-a-uuid`));
      expect(res.status).toBe(400);
      expect(one).not.toHaveBeenCalled();
    });
  });

  describe('update + delete', () => {
    it('autosave PUT overwrites the data, still without the password', async () => {
      one.mockResolvedValueOnce({ id: ID, updated_at: NOW });
      const res = await authed(
        request(await app())
          .put(`${DRAFTS}/${ID}`)
          .send({ data: { name: 'Renamed', ownerPassword: 'hunter2hunter2' } }),
      );
      expect(res.status).toBe(200);
      const [id, adminId, name, json] = one.mock.calls[0]![1] as [string, string, string, string];
      expect([id, adminId, name]).toEqual([ID, 'admin-1', 'Renamed']);
      expect(json).not.toContain('hunter2');
    });

    it('delete is scoped and idempotent: 204 even when the draft is already gone', async () => {
      exec.mockResolvedValueOnce(0);
      const res = await authed(request(await app()).delete(`${DRAFTS}/${ID}`));
      expect(res.status).toBe(204);
      expect(exec.mock.calls[0]![1]).toEqual([ID, 'admin-1']);
    });
  });
});
