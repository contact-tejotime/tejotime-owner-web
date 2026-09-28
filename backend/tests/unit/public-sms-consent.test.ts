import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * The two SMS consent flags, through the real public router and validator with the service
 * stubbed (same pattern as public-consent.test.ts: no database, no server). The booking page
 * currently sets both from one box; the API keeps them separate so that can change.
 *
 * What is pinned: the review flag (migration 0032) reaches the service as its own flag,
 * both boxes default to false when a client omits them — an old or careless client must never
 * become "yes, text them" — and the schema stays strict.
 */

const { joinQueue, bookSlot } = vi.hoisted(() => ({
  joinQueue: vi.fn(async () => ({ ticketId: 't1' })),
  bookSlot: vi.fn(async () => ({ appointmentId: 'a1' })),
}));

vi.mock('../../src/modules/public/public.service', () => ({ joinQueue, bookSlot }));
vi.mock('../../src/db/pool', () => ({
  exec: vi.fn(async () => 0),
  many: vi.fn(async () => []),
  one: vi.fn(async () => null),
  transaction: vi.fn(),
  pool: { on: vi.fn() },
}));

const BASE = { name: 'Alexander', phone: '+12393160008' };
const SLOT = '2026-09-26T17:00:00.000Z';

describe('public join/book — SMS consent flags', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    joinQueue.mockClear();
    bookSlot.mockClear();
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
    a.set('trust proxy', 1);
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/public', publicRouter);
    a.use(errorHandler);
    return a;
  }

  const join = async (body: object) => request(await app()).post('/api/v1/public/businesses/sharp-cuts/queue').send(body);
  const book = async (body: object) =>
    request(await app()).post('/api/v1/public/businesses/sharp-cuts/appointments').send(body);

  it('booking passes both boxes through as separate flags', async () => {
    const res = await book({ ...BASE, slotStart: SLOT, smsOptIn: true, reviewSmsOptIn: true });
    expect(res.status).toBe(201);
    expect(bookSlot).toHaveBeenCalledWith('sharp-cuts', expect.objectContaining({ smsOptIn: true, reviewSmsOptIn: true }));
  });

  it('the review box is independent: ticking only it does not opt into appointment texts', async () => {
    await book({ ...BASE, slotStart: SLOT, reviewSmsOptIn: true });
    expect(bookSlot).toHaveBeenCalledWith('sharp-cuts', expect.objectContaining({ smsOptIn: false, reviewSmsOptIn: true }));
  });

  it('a walk-in join carries the review box', async () => {
    const res = await join({ ...BASE, reviewSmsOptIn: true });
    expect(res.status).toBe(201);
    expect(joinQueue).toHaveBeenCalledWith('sharp-cuts', expect.objectContaining({ reviewSmsOptIn: true }));
  });

  it('both boxes default to false when a client omits them (older clients keep working)', async () => {
    expect((await join(BASE)).status).toBe(201);
    expect(joinQueue).toHaveBeenCalledWith('sharp-cuts', expect.objectContaining({ smsOptIn: false, reviewSmsOptIn: false }));
    expect((await book({ ...BASE, slotStart: SLOT })).status).toBe(201);
    expect(bookSlot).toHaveBeenCalledWith('sharp-cuts', expect.objectContaining({ smsOptIn: false, reviewSmsOptIn: false }));
  });

  it('refuses a non-boolean consent and unknown keys (schema stays strict)', async () => {
    const bad = await book({ ...BASE, slotStart: SLOT, reviewSmsOptIn: 'yes' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    const unknown = await join({ ...BASE, marketingOptIn: true });
    expect(unknown.status).toBe(400);
    expect(joinQueue).not.toHaveBeenCalled();
    expect(bookSlot).not.toHaveBeenCalled();
  });
});
