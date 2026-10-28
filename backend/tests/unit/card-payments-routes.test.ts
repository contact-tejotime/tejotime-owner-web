import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Card payments API (docs/card-payments-paypal.md, 0043): MAIN OWNER ONLY, strict bodies, and the
 * plpgsql refusals named. The real router, guards and service, with the database, the plpgsql
 * calls and the queue side effects stubbed — so it needs no DB and no server.
 *
 * Not covered here (needs a real Postgres): `card_payment_complete` completing the visit in the
 * same transaction, idempotency, the pending guard, and a refund leaving revenue and commission.
 * Those are `backend/scripts/smoke-card-payments.mjs`.
 */

const { one, many, callRpc, afterCheckout } = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(async (_sql: string, _params?: unknown[]): Promise<unknown[]> => []),
  callRpc: vi.fn(),
  afterCheckout: vi.fn(async () => ({ promoted: null, seats: [], summary: {} })),
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
vi.mock('../../src/modules/queue/queue.service', () => ({
  afterCheckout,
  broadcastQueue: vi.fn(async () => undefined),
  getQueueView: vi.fn(async () => ({ seats: [], summary: {} })),
}));

const ENTRY = '11111111-1111-4111-8111-111111111111';
const PAYMENT = '22222222-2222-4222-8222-222222222222';
const BASE = '/api/v1/card-payments';

const ROW = {
  id: PAYMENT,
  status: 'paid',
  amount_paise: '4500',
  charged_amount_paise: '4500',
  currency: 'USD',
  needs_review: false,
  card_brand: 'VISA',
  card_last4: '4242',
  entry_mode: 'CONTACTLESS',
  failure_reason: null,
  queue_entry_id: ENTRY,
  visit_id: 'v1',
  created_at: '2026-10-15T10:00:00Z',
  paid_at: '2026-10-15T10:00:30Z',
  refunded_at: null,
  customer_name: 'Ada',
  service_name: 'Haircut',
};

type Who = 'main' | 'co_owner' | 'staff';

describe('card payments API', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    one.mockReset();
    one.mockImplementation(async () => ROW);
    many.mockReset();
    many.mockImplementation(async () => [ROW]);
    callRpc.mockReset();
    afterCheckout.mockClear();
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
    const { cardPaymentsRouter } = await import('../../src/modules/card-payments/card-payments.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json());
    a.use(requestId);
    a.use(BASE, cardPaymentsRouter);
    a.use(errorHandler);
    return a;
  }

  async function token(who: Who = 'main') {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    return signAccessToken({
      userId: 'u1',
      businessId: 'b1',
      role: who === 'main' ? 'owner' : who,
      plan: 'free' as any,
      staffId: who === 'staff' ? 'chair-a' : null,
      isSuperOwner: who === 'main',
    });
  }

  const send = async (method: 'get' | 'post' | 'put', path: string, body?: unknown, who: Who = 'main') => {
    const req = request(await app())[method](`${BASE}${path}`).set('authorization', `Bearer ${await token(who)}`);
    return body === undefined ? req : req.send(body as object);
  };

  it('is the main owner\'s alone: a co-owner and a staff login get 403 on every route', async () => {
    const calls: [Parameters<typeof send>[0], string, unknown][] = [
      ['get', '/settings', undefined],
      ['put', '/settings', { enabled: true }],
      ['get', '', undefined],
      ['post', '', { queueEntryId: ENTRY, amountPaise: 4500 }],
      ['post', `/${PAYMENT}/complete`, {}],
      ['post', `/${PAYMENT}/fail`, { reason: 'Declined' }],
      ['post', `/${PAYMENT}/refund`, {}],
    ];
    for (const who of ['co_owner', 'staff'] as const) {
      for (const [method, path, body] of calls) {
        const res = await send(method, path, body, who);
        expect(res.status, `${who} ${method} ${path}`).toBe(403);
      }
    }
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('needs a login', async () => {
    const res = await request(await app()).get(`${BASE}/settings`);
    expect(res.status).toBe(401);
  });

  it('starts a charge with the caller as its author and returns the reference', async () => {
    callRpc.mockResolvedValueOnce({ id: PAYMENT, resumed: false });
    one.mockImplementation(async () => ({ ...ROW, status: 'pending', visit_id: null, paid_at: null }));
    const res = await send('post', '', { queueEntryId: ENTRY, amountPaise: 4500 });
    expect(res.status).toBe(201);
    expect(callRpc).toHaveBeenCalledWith('card_payment_start', {
      p_business_id: 'b1',
      p_entry_id: ENTRY,
      p_amount_paise: 4500,
      p_user_id: 'u1',
    });
    expect(res.body.payment.id).toBe(PAYMENT);
    expect(res.body.payment.status).toBe('pending');
    expect(res.body.payment.amount).toEqual({ amount: 4500, currency: 'USD' });
    expect(res.body.resumed).toBe(false);
  });

  it('refuses a zero or fractional charge, and any field it does not know', async () => {
    for (const body of [
      { queueEntryId: ENTRY, amountPaise: 0 },
      { queueEntryId: ENTRY, amountPaise: 12.5 },
      { queueEntryId: ENTRY, amountPaise: 4500, tipPaise: 500 },
      { queueEntryId: 'nope', amountPaise: 4500 },
    ]) {
      const res = await send('post', '', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('names the plpgsql refusals: card charging off 409, visit not in the chair 422', async () => {
    callRpc.mockRejectedValueOnce(new Error('TEJO:CARD_PAYMENTS_OFF'));
    const off = await send('post', '', { queueEntryId: ENTRY, amountPaise: 4500 });
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('CARD_PAYMENTS_OFF');

    callRpc.mockRejectedValueOnce(new Error('TEJO:INVALID_STATE'));
    const done = await send('post', '', { queueEntryId: ENTRY, amountPaise: 4500 });
    expect(done.status).toBe(422);
  });

  it('completes: the visit is finished exactly as a plain checkout finishes it', async () => {
    const checkout = { id: ENTRY, staff_id: 'chair-a', visit_id: 'v1', promoted: null };
    callRpc.mockResolvedValueOnce({ already: false, checkout });
    const res = await send('post', `/${PAYMENT}/complete`, {
      providerPaymentId: 'pp-1',
      cardBrand: 'VISA',
      cardLast4: '4242',
      entryMode: 'CONTACTLESS',
      chargedAmountPaise: 4500,
    });
    expect(res.status).toBe(200);
    expect(callRpc).toHaveBeenCalledWith('card_payment_complete', expect.objectContaining({
      p_payment_id: PAYMENT,
      p_card_last4: '4242',
      p_charged_amount_paise: 4500,
    }));
    expect(afterCheckout).toHaveBeenCalledWith('b1', ENTRY, checkout);
    expect(res.body.payment.cardLast4).toBe('4242');
  });

  it('a repeated complete (lost response) changes nothing and sets nothing off', async () => {
    callRpc.mockResolvedValueOnce({ already: true, checkout: null });
    const res = await send('post', `/${PAYMENT}/complete`, {});
    expect(res.status).toBe(200);
    expect(afterCheckout).not.toHaveBeenCalled();
    expect(res.body.payment.status).toBe('paid');
  });

  it('never takes a card number: only the last four digits', async () => {
    for (const cardLast4 of ['424242******4242', '42424', 'abcd']) {
      const res = await send('post', `/${PAYMENT}/complete`, { cardLast4 });
      expect(res.status, cardLast4).toBe(400);
    }
    const masked = await send('post', `/${PAYMENT}/complete`, { maskedPan: '424242******4242' });
    expect(masked.status).toBe(400);
    expect(callRpc).not.toHaveBeenCalled();
  });

  it('refunds by the caller, and a refund of an unpaid charge is a 422', async () => {
    callRpc.mockResolvedValueOnce({ already: false });
    one.mockImplementation(async () => ({ ...ROW, status: 'refunded', refunded_at: '2026-10-15T11:00:00Z' }));
    const ok = await send('post', `/${PAYMENT}/refund`, { refundReference: 'rf-1' });
    expect(ok.status).toBe(200);
    expect(callRpc).toHaveBeenCalledWith('card_payment_refund', {
      p_business_id: 'b1',
      p_payment_id: PAYMENT,
      p_user_id: 'u1',
      p_refund_reference: 'rf-1',
    });
    expect(ok.body.payment.status).toBe('refunded');

    callRpc.mockRejectedValueOnce(new Error('TEJO:INVALID_STATE'));
    const pending = await send('post', `/${PAYMENT}/refund`, {});
    expect(pending.status).toBe(422);
  });

  it('turns card charging on with the PayPal account it was signed in to', async () => {
    one.mockImplementation(async (sql: string) =>
      /select card_payments_enabled/.test(sql)
        ? { card_payments_enabled: true, paypal_org_ref: 'org-1', currency: 'USD' }
        : { id: 'b1' },
    );
    const res = await send('put', '/settings', { enabled: true, paypalOrgRef: 'org-1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, available: true, paypalOrgRef: 'org-1', currency: 'USD' });
    const update = one.mock.calls.find((c) => /update business/.test(c[0] as string));
    expect(update?.[1]).toEqual(['b1', true, 'org-1']);
  });

  it('is for US stores only: turning it on or starting a charge elsewhere is 409, turning it off is fine', async () => {
    one.mockImplementation(async (sql: string) =>
      /select card_payments_enabled/.test(sql)
        ? { card_payments_enabled: false, paypal_org_ref: null, currency: 'INR' }
        : { id: 'b1' },
    );
    const on = await send('put', '/settings', { enabled: true });
    expect(on.status).toBe(409);
    expect(on.body.error.code).toBe('CARD_PAYMENTS_US_ONLY');
    expect(one.mock.calls.some((c) => /update business/.test(c[0] as string))).toBe(false);

    const start = await send('post', '', { queueEntryId: ENTRY, amountPaise: 4500 });
    expect(start.status).toBe(409);
    expect(start.body.error.code).toBe('CARD_PAYMENTS_US_ONLY');
    expect(callRpc).not.toHaveBeenCalled();

    const settings = await send('get', '/settings');
    expect(settings.body).toMatchObject({ enabled: false, available: false });

    const off = await send('put', '/settings', { enabled: false });
    expect(off.status).toBe(200);
  });

  it('lists with filters, newest first', async () => {
    const res = await send('get', '?status=paid&needsReview=true&limit=10');
    expect(res.status).toBe(200);
    const [sql, params] = many.mock.calls[0];
    expect(sql).toMatch(/cp\.status = \$2/);
    expect(sql).toMatch(/cp\.needs_review = \$3/);
    expect(sql).toMatch(/order by cp\.created_at desc/);
    expect(params).toEqual(['b1', 'paid', true, 10]);
    expect(res.body.data[0].customerName).toBe('Ada');
  });
});
