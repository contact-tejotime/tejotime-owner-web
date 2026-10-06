import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Checkout add-ons (docs/checkout-add-ons.md): the owner types each add-on's price, a highlighted
 * chip takes its add-on back off, and the same add-on can no longer be recorded twice.
 *
 * This pins the HTTP boundary — the real queue router, guards, validation and error handler, with
 * the queue service stubbed — so it needs no DB and no server. What it does NOT cover, because it
 * needs a real Postgres: migration 0039 itself (`queue_extend` refusing a repeat,
 * `queue_remove_extra` taking the row, minutes and name segment back off). Those are
 * `backend/scripts/smoke-checkout-addons.mjs`.
 */

const { one, many, extendService, removeExtra } = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(async () => []),
  extendService: vi.fn(async () => ({ seats: [] })),
  removeExtra: vi.fn(async () => ({ seats: [] })),
}));

vi.mock('../../src/db/pool', () => ({
  exec: vi.fn(async () => 0),
  many,
  one,
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

vi.mock('../../src/modules/queue/queue.service', () => ({ extendService, removeExtra }));

const ENTRY = '11111111-1111-4111-8111-111111111111';
const EXTEND = `/api/v1/queue/${ENTRY}/extend`;
const REMOVE = `/api/v1/queue/${ENTRY}/remove-extra`;

describe('checkout add-ons (queue API)', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    extendService.mockClear();
    removeExtra.mockClear();
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
    const { queueRouter } = await import('../../src/modules/queue/queue.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/queue', queueRouter);
    a.use(errorHandler);
    return a;
  }

  async function token(role: 'owner' | 'staff' = 'owner', staffId: string | null = null) {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    return signAccessToken({ userId: 'u1', businessId: 'b1', role: role as any, plan: 'free' as any, staffId });
  }

  const post = async (path: string, body: unknown, bearer?: string) => {
    const req = request(await app()).post(path);
    if (bearer) req.set('authorization', `Bearer ${bearer}`);
    return req.send(body as object);
  };

  describe('extend: the owner types the price', () => {
    it('passes the typed price through, and snaps the label and minutes to the catalog', async () => {
      const res = await post(EXTEND, { label: 'shave', minutes: 99, pricePaise: 12300 }, await token());
      expect(res.status).toBe(200);
      expect(extendService).toHaveBeenCalledWith('b1', ENTRY, 'Shave', 10, 12300);
    });

    it('accepts a free add-on (0)', async () => {
      const res = await post(EXTEND, { label: 'Head massage', minutes: 15, pricePaise: 0 }, await token());
      expect(res.status).toBe(200);
      expect(extendService).toHaveBeenCalledWith('b1', ENTRY, 'Head massage', 15, 0);
    });

    it('still accepts the body the app builds already in the field send (no price)', async () => {
      const res = await post(EXTEND, { label: 'Beard trim', minutes: 15 }, await token());
      expect(res.status).toBe(200);
      expect(extendService).toHaveBeenCalledWith('b1', ENTRY, 'Beard trim', 15, undefined);
    });

    it('refuses a negative or fractional price', async () => {
      for (const pricePaise of [-1, 12.5]) {
        const res = await post(EXTEND, { label: 'Shave', minutes: 10, pricePaise }, await token());
        expect(res.status).toBe(400);
      }
      expect(extendService).not.toHaveBeenCalled();
    });

    it('answers 409 ALREADY_ADDED when the add-on is already on the visit', async () => {
      extendService.mockRejectedValueOnce(new Error('TEJO:ALREADY_ADDED'));
      const res = await post(EXTEND, { label: 'Shave', minutes: 10, pricePaise: 5000 }, await token());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_ADDED');
    });
  });

  describe('remove-extra: a tap on a highlighted chip', () => {
    it('removes by label, trimmed', async () => {
      const res = await post(REMOVE, { label: '  Blow-dry ' }, await token());
      expect(res.status).toBe(200);
      expect(removeExtra).toHaveBeenCalledWith('b1', ENTRY, 'Blow-dry');
    });

    it('refuses an empty label and any extra field', async () => {
      for (const body of [{ label: '' }, { label: 'Shave', pricePaise: 100 }, {}]) {
        const res = await post(REMOVE, body, await token());
        expect(res.status).toBe(400);
      }
      expect(removeExtra).not.toHaveBeenCalled();
    });

    it('needs a login', async () => {
      const res = await post(REMOVE, { label: 'Shave' });
      expect(res.status).toBe(401);
      expect(removeExtra).not.toHaveBeenCalled();
    });

    it("lets a staff login change its own chair's customer, never another chair's", async () => {
      one.mockResolvedValueOnce({ staff_id: 'chair-a' });
      const own = await post(REMOVE, { label: 'Shave' }, await token('staff', 'chair-a'));
      expect(own.status).toBe(200);

      one.mockResolvedValueOnce({ staff_id: 'chair-b' });
      const other = await post(REMOVE, { label: 'Shave' }, await token('staff', 'chair-a'));
      expect(other.status).toBe(403);
      expect(removeExtra).toHaveBeenCalledTimes(1);
    });

    it('names AMOUNT_REQUIRED for any visit, not only a range (0040 raises it for an unpriced extra)', async () => {
      const { mapPgError } = await import('../../src/middleware/error-handler');
      const err = mapPgError('TEJO:AMOUNT_REQUIRED');
      expect(err?.httpStatus).toBe(422);
      expect(err?.code).toBe('AMOUNT_REQUIRED');
      expect(err?.message).toBe('Enter the final amount for this visit');
    });

    it('maps the plpgsql refusals: unknown add-on 404, customer not in the chair 422', async () => {
      removeExtra.mockRejectedValueOnce(new Error('TEJO:NOT_FOUND'));
      const missing = await post(REMOVE, { label: 'Shave' }, await token());
      expect(missing.status).toBe(404);

      removeExtra.mockRejectedValueOnce(new Error('TEJO:INVALID_STATE'));
      const waiting = await post(REMOVE, { label: 'Shave' }, await token());
      expect(waiting.status).toBe(422);
    });
  });
});
