import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tips at checkout (docs/checkout-tips.md, 0046).
 *
 * The real queue router AND service with the database, the plpgsql calls, the sockets and the
 * texts stubbed, so it pins what the API decides before it reaches Postgres: the tip travels
 * beside the bill and never inside it, a bad tip is a 400, a build from before tips still checks
 * out, and the sheet is told whether Tips are on.
 *
 * Not covered here (needs a real Postgres): `queue_checkout` writing `visit.tip_paise`, the
 * report SQL, and the card split. Those are `backend/scripts/smoke-tips.mjs`.
 */

const { one, many, callRpc } = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(async () => []),
  callRpc: vi.fn(),
}));

vi.mock('../../src/db/pool', () => ({
  exec: vi.fn(async () => 0),
  many,
  one,
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));
vi.mock('../../src/db/rpc', () => ({ callRpc }));
vi.mock('../../src/realtime/emitters', () => ({
  emitToOwners: vi.fn(),
  emitToPublic: vi.fn(),
  emitToTicket: vi.fn(),
}));
vi.mock('../../src/modules/notifications/sms-dispatch', () => ({
  sendReviewRequest: vi.fn(async () => undefined),
  sendWaitlistReminder: vi.fn(async () => undefined),
}));

const ENTRY = '11111111-1111-4111-8111-111111111111';
const CHECKOUT = `/api/v1/queue/${ENTRY}/checkout`;
const DETAIL = `/api/v1/queue/${ENTRY}`;

describe('tips at checkout (queue API + service)', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    many.mockReset();
    many.mockImplementation(async () => []);
    callRpc.mockReset();
    callRpc.mockImplementation(async () => ({ id: ENTRY, staff_id: null, visit_id: 'v1', promoted: null }));
    // The store row `checkout` reads to judge a method: INR, so no "Paid by" is in play and a tip
    // is shown to work in the store's own currency, not only a US one.
    one.mockImplementation(async (sql: string) =>
      /from business where id/.test(sql) ? { currency: 'INR', card_payments_enabled: false } : null,
    );
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

  async function token() {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    return signAccessToken({
      userId: 'u1',
      businessId: 'b1',
      role: 'owner',
      plan: 'free' as any,
      staffId: null,
      isSuperOwner: true,
    });
  }

  const checkout = async (body: unknown) =>
    request(await app())
      .post(CHECKOUT)
      .set('authorization', `Bearer ${await token()}`)
      .send(body as object);

  const rpcArgs = () => callRpc.mock.calls.find((c) => c[0] === 'queue_checkout')?.[1];

  it('sends the bill and the tip to the database apart: the tip never joins the amount', async () => {
    const res = await checkout({ amountPaise: 45000, tipPaise: 4500 });
    expect(res.status).toBe(200);
    expect(rpcArgs()).toMatchObject({ p_amount_paise: 45000, p_tip_paise: 4500 });
  });

  it('takes a tip on a store that is not priced in dollars (every store, its own currency)', async () => {
    const res = await checkout({ amountPaise: 45000, paymentMethod: undefined, tipPaise: 1 });
    expect(res.status).toBe(200);
    expect(rpcArgs().p_tip_paise).toBe(1);
  });

  it('a checkout from before tips (no tipPaise) is a checkout with no tip', async () => {
    const res = await checkout({ amountPaise: 45000 });
    expect(res.status).toBe(200);
    expect(rpcArgs().p_tip_paise).toBeNull(); // the SQL reads null as zero
    expect(rpcArgs().p_amount_paise).toBe(45000);
  });

  it('an explicit zero tip is recorded as none, not refused', async () => {
    const res = await checkout({ amountPaise: 45000, tipPaise: 0 });
    expect(res.status).toBe(200);
    expect(rpcArgs().p_tip_paise).toBe(0);
  });

  it('refuses a negative, fractional, oversized or non-numeric tip before touching the database', async () => {
    for (const tipPaise of [-1, 12.5, 100_000_001, 'lots']) {
      const res = await checkout({ amountPaise: 45000, tipPaise });
      expect(res.status, JSON.stringify(tipPaise)).toBe(400);
    }
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('refuses a tip under any other name (the body is strict)', async () => {
    const res = await checkout({ amountPaise: 45000, gratuity: 500 });
    expect(res.status).toBe(400);
    expect(callRpc).not.toHaveBeenCalled();
  });

  /** A queue_entry detail row for `GET /queue/:id`. */
  function detail() {
    one.mockImplementation(async (sql: string) => {
      if (/from queue_entry q\s+join business b/.test(sql)) {
        return {
          service_paise: '45000',
          service_max_paise: null,
          service_price_type: 'fixed',
          service_name: 'Haircut',
          extras_paise: '0',
          unpriced_extras: 0,
          currency: 'INR',
          card_payments_enabled: false,
          pending_card_id: null,
          pending_card_paise: null,
        };
      }
      if (/select \* from queue_entry/.test(sql)) {
        return { id: ENTRY, customer_name: 'Ada', status: 'in_service', service_name: 'Haircut', source: 'walk_in' };
      }
      return null;
    });
  }

  it('GET /queue/:id has no Tips switch (the Tip row is always there) and the bill has no tip in it', async () => {
    detail();
    const res = await request(await app()).get(DETAIL).set('authorization', `Bearer ${await token()}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('tipEnabled');
    // A tip is never folded into what the sheet pre-fills.
    expect(res.body.suggestedAmount).toEqual({ amount: 45000, currency: 'INR' });
  });
});
