import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * Meta's WhatsApp webhook (modules/webhooks/whatsapp.service.ts, docs/whatsapp-india.md), driven
 * through the real app (createApp) so the raw-body capture in app.ts is what the signature is
 * checked against. The pool is stubbed: this pins which SQL runs — and that none does for an
 * unsigned call, since a forged STOP would silence a real customer.
 */

const { exec } = vi.hoisted(() => ({ exec: vi.fn(async () => 1) }));

vi.mock('../../src/db/pool', () => ({
  exec,
  many: vi.fn(async () => []),
  one: vi.fn(async () => null),
  transaction: vi.fn(),
  pool: { on: vi.fn(), query: vi.fn() },
}));

const SECRET = 'meta-app-secret-for-tests';
const VERIFY = 'tejotime-verify-token';

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
  WHATSAPP_APP_SECRET: SECRET,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY,
  // The webhook does not depend on sending being on.
  WHATSAPP_ENABLED: 'false',
};

const PATH = '/api/v1/webhooks/whatsapp';

function sign(raw: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}

function payload(value: Record<string, unknown>) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value }] }] };
}

/** Every SQL the handler ran, as [sql, params]. */
const sqlRuns = () => exec.mock.calls.map(([sql, params]) => [String(sql).replace(/\s+/g, ' ').trim(), params]);

describe('WhatsApp webhook', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  async function app(env: Record<string, string> = {}) {
    process.env = { ...originalEnv, ...TEST_ENV, ...env };
    const { createApp } = await import('../../src/app');
    return createApp();
  }

  async function post(body: unknown, signature?: string) {
    const raw = JSON.stringify(body);
    const req = request(await app()).post(PATH).set('Content-Type', 'application/json');
    if (signature !== undefined) req.set('X-Hub-Signature-256', signature);
    return req.send(raw);
  }

  beforeEach(() => {
    vi.resetModules();
    exec.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('verification handshake (GET)', () => {
    it('echoes hub.challenge as plain text when the verify token matches', async () => {
      const res = await request(await app())
        .get(PATH)
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1158201444' });
      expect(res.status).toBe(200);
      expect(res.text).toBe('1158201444');
      expect(res.headers['content-type']).toMatch(/text\/plain/);
    });

    it('refuses a wrong token, a wrong mode, and any token when none is configured', async () => {
      const wrong = await request(await app())
        .get(PATH)
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': '1' });
      expect(wrong.status).toBe(403);

      vi.resetModules();
      const mode = await request(await app())
        .get(PATH)
        .query({ 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1' });
      expect(mode.status).toBe(403);

      vi.resetModules();
      const unset = await request(await app({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: '' }))
        .get(PATH)
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' });
      expect(unset.status).toBe(403);
    });
  });

  describe('signature (POST)', () => {
    const stop = payload({ messages: [{ from: '919824470182', type: 'text', text: { body: 'STOP' } }] });

    it('refuses a missing, a wrong and a forged signature — and runs no SQL', async () => {
      expect((await post(stop)).status).toBe(401);
      vi.resetModules();
      expect((await post(stop, 'sha256=' + '0'.repeat(64))).status).toBe(401);
      vi.resetModules();
      expect((await post(stop, sign(JSON.stringify(stop), 'someone-elses-secret'))).status).toBe(401);
      expect(exec).not.toHaveBeenCalled();
    });

    it('refuses everything when no app secret is configured', async () => {
      process.env = { ...originalEnv, ...TEST_ENV, WHATSAPP_APP_SECRET: '' };
      const { createApp } = await import('../../src/app');
      const raw = JSON.stringify(stop);
      const res = await request(createApp())
        .post(PATH)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(raw, ''))
        .send(raw);
      expect(res.status).toBe(401);
      expect(exec).not.toHaveBeenCalled();
    });

    it('signs the exact bytes: the same JSON re-spaced no longer matches', async () => {
      const spaced = JSON.stringify(stop, null, 2);
      const res = await request(await app())
        .post(PATH)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(JSON.stringify(stop)))
        .send(spaced);
      expect(res.status).toBe(401);
    });
  });

  describe('STOP', () => {
    it('opts the number out at every store, matched as +<digits>', async () => {
      const body = payload({ messages: [{ from: '919824470182', type: 'text', text: { body: '  Stop ' } }] });
      const res = await post(body, sign(JSON.stringify(body)));

      expect(res.status).toBe(200);
      const runs = sqlRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0][0]).toMatch(/^update customer set sms_opt_out_at = now\(\)/);
      // No business_id: the customer messaged TejoTime's one number, not a store's.
      expect(runs[0][0]).not.toMatch(/business_id/);
      expect(runs[0][1]).toEqual(['+919824470182']);
    });

    it("also takes UNSUBSCRIBE and the marketing template's Stop promotions button", async () => {
      const body = payload({
        messages: [
          { from: '919824470182', type: 'text', text: { body: 'unsubscribe' } },
          { from: '919000000001', type: 'button', button: { text: 'Stop promotions', payload: 'Stop promotions' } },
        ],
      });
      await post(body, sign(JSON.stringify(body)));
      expect(sqlRuns().map((r) => r[1])).toEqual([['+919824470182'], ['+919000000001']]);
    });

    it('ignores any other message', async () => {
      const body = payload({
        messages: [
          { from: '919824470182', type: 'text', text: { body: 'Can I come at 5 instead? stop by later' } },
          { from: '919824470182', type: 'image' },
        ],
      });
      const res = await post(body, sign(JSON.stringify(body)));
      expect(res.status).toBe(200);
      expect(exec).not.toHaveBeenCalled();
    });
  });

  describe('delivery statuses', () => {
    it('moves the row forward only: sent while queued, delivered/read over queued or sent, failed with the code', async () => {
      const body = payload({
        statuses: [
          { id: 'wamid.A', status: 'sent', recipient_id: '919824470182' },
          { id: 'wamid.B', status: 'delivered', recipient_id: '919824470182' },
          { id: 'wamid.C', status: 'read', recipient_id: '919824470182' },
          {
            id: 'wamid.D',
            status: 'failed',
            recipient_id: '919824470182',
            errors: [{ code: 131026, title: 'Message undeliverable' }],
          },
        ],
      });
      const res = await post(body, sign(JSON.stringify(body)));
      expect(res.status).toBe(200);

      const runs = sqlRuns();
      expect(runs).toHaveLength(4);
      expect(runs[0][0]).toContain("set status = 'sent'");
      expect(runs[0][0]).toContain("status = 'queued'");
      expect(runs[0][1]).toEqual(['wamid.A']);
      // A late "delivered" never overwrites "failed".
      expect(runs[1][0]).toContain("set status = 'delivered'");
      expect(runs[1][0]).toContain("status in ('queued', 'sent')");
      expect(runs[2][0]).toContain("set status = 'delivered'");
      expect(runs[2][1]).toEqual(['wamid.C']);
      expect(runs[3][0]).toContain("set status = 'failed'");
      expect(runs[3][1]).toEqual(['wamid.D', '131026: Message undeliverable']);
      // Only our WhatsApp rows: a Twilio sid can never be touched by a Meta callback.
      for (const [sql] of runs) expect(sql).toContain("channel = 'whatsapp'");
    });

    it('answers 200 even when an update fails, so Meta does not retry the whole batch', async () => {
      exec.mockRejectedValueOnce(new Error('connection reset'));
      const body = payload({ statuses: [{ id: 'wamid.A', status: 'delivered' }, { id: 'wamid.B', status: 'delivered' }] });
      const res = await post(body, sign(JSON.stringify(body)));
      expect(res.status).toBe(200);
      expect(exec).toHaveBeenCalledTimes(2);
    });

    it('ignores a payload that is not a WhatsApp Business Account event', async () => {
      const body = { object: 'page', entry: [] };
      const res = await post(body, sign(JSON.stringify(body)));
      expect(res.status).toBe(200);
      expect(exec).not.toHaveBeenCalled();
    });
  });
});
