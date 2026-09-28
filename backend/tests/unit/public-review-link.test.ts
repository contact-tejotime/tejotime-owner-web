import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * GET /public/businesses/by-phone/:phone/review-link — what the review SMS short link
 * (www.tejotime.com/<phone>/r) reads before redirecting. Real router, validator and error handler;
 * the service is stubbed (same pattern as public-sms-consent.test.ts: no database, no server).
 */

const { getReviewLinkByPhone } = vi.hoisted(() => ({
  getReviewLinkByPhone: vi.fn(async (_phone: string) => ({ url: 'https://g.page/r/abc/review' })),
}));

vi.mock('../../src/modules/public/public.service', () => ({ getReviewLinkByPhone }));
vi.mock('../../src/db/pool', () => ({
  exec: vi.fn(async () => 0),
  many: vi.fn(async () => []),
  one: vi.fn(async () => null),
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

describe('GET /public/businesses/by-phone/:phone/review-link', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    getReviewLinkByPhone.mockClear();
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

  async function get(phone: string) {
    const { publicRouter } = await import('../../src/modules/public/public.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.set('trust proxy', 1);
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/public', publicRouter);
    a.use(errorHandler);
    return request(a).get(`/api/v1/public/businesses/by-phone/${phone}/review-link`);
  }

  it('returns the store link for the phone, never cached', async () => {
    const res = await get('919824470182');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: 'https://g.page/r/abc/review' });
    expect(getReviewLinkByPhone).toHaveBeenCalledWith('919824470182');
    // An owner who changes the link must reach customers holding an older text.
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('404s when the store is unknown or has no link, with the standard envelope', async () => {
    const { Errors } = await import('../../src/domain/errors');
    getReviewLinkByPhone.mockRejectedValueOnce(Errors.notFound('No review link'));
    const res = await get('919824470182');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBeDefined();
  });

  it('refuses a key that is not a digits-only phone before touching the service', async () => {
    for (const bad of ['sharp-cuts', '12345', '91982447018299999']) {
      const res = await get(bad);
      expect(res.status, bad).toBe(400);
    }
    expect(getReviewLinkByPhone).not.toHaveBeenCalled();
  });
});
