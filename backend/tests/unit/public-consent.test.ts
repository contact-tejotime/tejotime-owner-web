import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * POST /public/consent through the real router, validator and error handler, with the single
 * database write stubbed. Same pattern as whatsapp-webhook.test.ts: no database, no server.
 *
 * The assertions that matter are the privacy ones. A consent record is evidence, so the things
 * worth pinning are what it REFUSES to accept from a client (a forged country) and what it
 * refuses to store at all (any address or fingerprint).
 */

const { insert } = vi.hoisted(() => ({
  insert: vi.fn(async (_sql: string, _params?: readonly unknown[]) => 1),
}));

vi.mock('../../src/db/pool', () => ({
  exec: insert,
  many: vi.fn(async () => []),
  one: vi.fn(async () => null),
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

const VALID = {
  visitorId: '3b241101-e2bb-4255-8caf-4136c566a962',
  necessary: true as const,
  analytics: false,
  marketing: false,
  preferences: true,
  timestamp: '2026-09-11T10:00:00.000Z',
  policyVersion: '2026-09-11',
};

describe('POST /public/consent', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    insert.mockClear();
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
    const { publicRouter } = await import('../../src/modules/public/public.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    // Mirrors app.ts — without it express-rate-limit warns on the X-Forwarded-For test below.
    a.set('trust proxy', 1);
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/public', publicRouter);
    a.use(errorHandler);
    return a;
  }

  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    let r = request(await app()).post('/api/v1/public/consent');
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return r.send(body as object);
  };

  /** The values bound to the insert, in the order consent.service.ts passes them. */
  const params = () => (insert.mock.calls[0]![1] ?? []) as unknown[];

  it('records a choice and answers 204 with no body', async () => {
    const res = await post(VALID);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(insert).toHaveBeenCalledTimes(1);

    const [visitorId, analytics, marketing, preferences, version, country] = params();
    expect(visitorId).toBe(VALID.visitorId);
    expect(analytics).toBe(false);
    expect(marketing).toBe(false);
    expect(preferences).toBe(true);
    expect(version).toBe('2026-09-11');
    expect(country).toBeNull(); // no edge header on this request
  });

  it('derives country from the edge header, in preference order', async () => {
    for (const header of ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code']) {
      insert.mockClear();
      const res = await post(VALID, { [header]: 'de' });
      expect(res.status, header).toBe(204);
      expect(params()[5], header).toBe('DE'); // upper-cased
    }
  });

  it('treats Cloudflare non-answers as unknown rather than as places', async () => {
    for (const value of ['XX', 'T1', '', 'ZZZ', '1']) {
      insert.mockClear();
      await post(VALID, { 'cf-ipcountry': value });
      expect(params()[5], value).toBeNull();
    }
  });

  it('REFUSES a client-supplied country — it is evidence, so it cannot be forgeable', async () => {
    const res = await post({ ...VALID, countryCode: 'GB' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(insert).not.toHaveBeenCalled();
  });

  it('never binds an IP address or a user agent', async () => {
    await post(VALID, {
      'cf-ipcountry': 'FR',
      'x-forwarded-for': '203.0.113.7, 70.41.3.18',
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    });
    const sql = String(insert.mock.calls[0]![0]);
    expect(sql).not.toMatch(/ip|user_agent|useragent/i);
    const bound = JSON.stringify(params());
    expect(bound).not.toContain('203.0.113.7');
    expect(bound).not.toContain('70.41.3.18');
    expect(bound).not.toContain('Mozilla');
  });

  it('rejects malformed bodies with the standard envelope', async () => {
    const cases: [unknown, string][] = [
      [{ ...VALID, visitorId: 'not-a-uuid' }, 'visitorId'],
      [{ ...VALID, necessary: false }, 'necessary'],
      [{ ...VALID, analytics: 'yes' }, 'analytics'],
      [{ ...VALID, timestamp: '11 September 2026' }, 'timestamp'],
      [{ ...VALID, policyVersion: '' }, 'policyVersion'],
      [{ visitorId: VALID.visitorId }, 'necessary'],
    ];
    for (const [body, field] of cases) {
      insert.mockClear();
      const res = await post(body);
      expect(res.status, JSON.stringify(body).slice(0, 70)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.requestId).toBeDefined();
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
      expect(insert).not.toHaveBeenCalled();
    }
  });

  it('necessary is always stored true, whatever else was chosen', async () => {
    await post({ ...VALID, analytics: true, marketing: true, preferences: true });
    expect(String(insert.mock.calls[0]![0])).toContain('true');
  });
});
