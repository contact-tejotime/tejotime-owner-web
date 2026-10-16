import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Paid by" at checkout and the main-owner card rule (docs/card-payments-paypal.md, 0042/0043).
 *
 * The real queue router AND the real queue service, with the database, the plpgsql calls, the
 * sockets and the texts stubbed — so it pins what the service decides before it ever reaches
 * Postgres: which methods a store may use (by its currency), and that nobody but the main owner
 * records a card visit once the store charges cards in TejoTime. It needs no DB and no server.
 *
 * Not covered here (needs a real Postgres): `queue_checkout` writing `visit.payment_method`, and
 * its pending-card guard. Those are `backend/scripts/smoke-payment-method.mjs` and
 * `smoke-card-payments.mjs`.
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

/** The store row `checkout` reads to judge a method. */
function store(currency: string, cardPaymentsEnabled = false) {
  one.mockImplementation(async (sql: string) =>
    /from business where id/.test(sql) ? { currency, card_payments_enabled: cardPaymentsEnabled } : null,
  );
}

describe('"Paid by" at checkout (queue API + service)', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    many.mockReset();
    many.mockImplementation(async () => []);
    callRpc.mockReset();
    callRpc.mockImplementation(async () => ({ id: ENTRY, staff_id: null, visit_id: 'v1', promoted: null }));
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

  /** `main`: the store's main (super) owner; otherwise a co-owner. */
  async function token(who: 'main' | 'co_owner' = 'main') {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    return signAccessToken({
      userId: 'u1',
      businessId: 'b1',
      role: who === 'main' ? 'owner' : 'co_owner',
      plan: 'free' as any,
      staffId: null,
      isSuperOwner: who === 'main',
    });
  }

  const checkout = async (body: unknown, who: 'main' | 'co_owner' = 'main') =>
    request(await app())
      .post(CHECKOUT)
      .set('authorization', `Bearer ${await token(who)}`)
      .send(body as object);

  const rpcMethod = () => callRpc.mock.calls.find((c) => c[0] === 'queue_checkout')?.[1]?.p_payment_method;

  it('records Card and Cash on a US store', async () => {
    store('USD');
    for (const method of ['card', 'cash']) {
      callRpc.mockClear();
      const res = await checkout({ amountPaise: 4500, paymentMethod: method });
      expect(res.status, method).toBe(200);
      expect(rpcMethod()).toBe(method);
    }
  });

  it('a US store offers nothing else for now (client decision 2026-10-15)', async () => {
    store('USD');
    for (const method of ['venmo', 'zelle', 'cash_app', 'upi', 'other']) {
      const res = await checkout({ amountPaise: 4500, paymentMethod: method });
      expect(res.status, method).toBe(400);
      expect(res.body.error.details?.[0]?.field).toBe('paymentMethod');
    }
    expect(callRpc).not.toHaveBeenCalledWith('queue_checkout', expect.anything());
  });

  it('any other store has no "Paid by" at all: a method is refused, the old checkout works', async () => {
    for (const currency of ['INR', 'EUR', 'CAD']) {
      store(currency);
      for (const method of ['card', 'cash']) {
        const res = await checkout({ amountPaise: 45000, paymentMethod: method });
        expect(res.status, `${method} on ${currency}`).toBe(400);
      }
      callRpc.mockClear();
      const old = await checkout({ amountPaise: 45000 });
      expect(old.status, `bare checkout on ${currency}`).toBe(200);
      expect(rpcMethod()).toBeNull();
    }
  });

  it('refuses an unknown method before looking anything up', async () => {
    const res = await checkout({ amountPaise: 4500, paymentMethod: 'bitcoin' });
    expect(res.status).toBe(400);
    expect(one).not.toHaveBeenCalled();
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('still takes the bare checkout the app builds already on phones send (method null)', async () => {
    const res = await checkout({});
    expect(res.status).toBe(200);
    expect(rpcMethod()).toBeNull();
  });

  it('once the store charges cards, only the main owner may record Card (403 CARD_OWNER_ONLY)', async () => {
    store('USD', true);
    const co = await checkout({ amountPaise: 4500, paymentMethod: 'card' }, 'co_owner');
    expect(co.status).toBe(403);
    expect(co.body.error.code).toBe('CARD_OWNER_ONLY');
    expect(callRpc).not.toHaveBeenCalled();

    // Cash is still anyone's.
    const cash = await checkout({ amountPaise: 4500, paymentMethod: 'cash' }, 'co_owner');
    expect(cash.status).toBe(200);

    // The main owner records a card charged outside TejoTime (a flat reader).
    callRpc.mockClear();
    const main = await checkout({ amountPaise: 4500, paymentMethod: 'card' }, 'main');
    expect(main.status).toBe(200);
    expect(rpcMethod()).toBe('card');
  });

  it('with card charging off, a co-owner records Card as before', async () => {
    store('USD', false);
    const res = await checkout({ amountPaise: 4500, paymentMethod: 'card' }, 'co_owner');
    expect(res.status).toBe(200);
  });

  it('a US store with Card payments off checks out the old way, and a sheet opened before the switch still lands', async () => {
    // The sheets ask "Paid by" only while the store has Card payments on (client 2026-10-16), so a
    // switched-off US store sends the old bare checkout. A Cash or Card picked on a sheet that was
    // open when the owner switched it off is still a true answer, so it is recorded, not refused.
    store('USD', false);
    callRpc.mockClear();
    const bare = await checkout({ amountPaise: 4500 }, 'co_owner');
    expect(bare.status).toBe(200);
    expect(rpcMethod()).toBeNull();

    callRpc.mockClear();
    const stale = await checkout({ amountPaise: 4500, paymentMethod: 'cash' }, 'co_owner');
    expect(stale.status).toBe(200);
    expect(rpcMethod()).toBe('cash');
  });

  it('GET /queue/:id reports Card payments off on a US store that has not switched it on (no "Paid by")', async () => {
    one.mockImplementation(async (sql: string) => {
      if (/from queue_entry q\s+join business b/.test(sql)) {
        return {
          service_paise: '4500',
          service_max_paise: null,
          service_price_type: 'fixed',
          service_name: 'Haircut',
          extras_paise: '0',
          unpriced_extras: 0,
          currency: 'USD',
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
    const res = await request(await app()).get(DETAIL).set('authorization', `Bearer ${await token('main')}`);
    expect(res.status).toBe(200);
    expect(res.body.cardPaymentsEnabled).toBe(false);
    expect(res.body.serviceAmount).toEqual({ amount: 4500, currency: 'USD' });
  });

  it('a checkout while the card is being charged is a 409, not a generic 422', async () => {
    store('USD');
    callRpc.mockRejectedValueOnce(new Error('TEJO:CARD_PAYMENT_IN_PROGRESS'));
    const res = await checkout({ amountPaise: 4500, paymentMethod: 'cash' }, 'co_owner');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CARD_PAYMENT_IN_PROGRESS');
  });

  it("GET /queue/:id answers the card rule for the person asking, and names a charge in flight", async () => {
    one.mockImplementation(async (sql: string) => {
      if (/from queue_entry q\s+join business b/.test(sql)) {
        return {
          service_paise: '4500',
          service_max_paise: null,
          service_price_type: 'fixed',
          service_name: 'Haircut',
          extras_paise: '0',
          unpriced_extras: 0,
          currency: 'USD',
          card_payments_enabled: true,
          pending_card_id: 'p1',
          pending_card_paise: '4500',
        };
      }
      if (/select \* from queue_entry/.test(sql)) {
        return { id: ENTRY, customer_name: 'Ada', status: 'in_service', service_name: 'Haircut', source: 'walk_in' };
      }
      return null;
    });
    const a = await app();
    const main = await request(a).get(DETAIL).set('authorization', `Bearer ${await token('main')}`);
    expect(main.status).toBe(200);
    expect(main.body.cardPaymentsEnabled).toBe(true);
    expect(main.body.cardAllowed).toBe(true);
    expect(main.body.pendingCardPayment).toEqual({ id: 'p1', amount: { amount: 4500, currency: 'USD' } });

    const co = await request(a).get(DETAIL).set('authorization', `Bearer ${await token('co_owner')}`);
    expect(co.body.cardAllowed).toBe(false);
  });

  it('a store that is no longer a US store has card payments off, whatever the column says', async () => {
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
          card_payments_enabled: true, // turned on while it was a USD store
          pending_card_id: null,
          pending_card_paise: null,
        };
      }
      if (/select \* from queue_entry/.test(sql)) {
        return { id: ENTRY, customer_name: 'Ada', status: 'in_service', service_name: 'Haircut', source: 'walk_in' };
      }
      return null;
    });
    const co = await request(await app()).get(DETAIL).set('authorization', `Bearer ${await token('co_owner')}`);
    expect(co.body.cardPaymentsEnabled).toBe(false);
    expect(co.body.cardAllowed).toBe(true);
  });
});
