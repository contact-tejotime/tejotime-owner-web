import express from 'express';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * Appointment self-service (store chat + microsite) through the real router, validator and error
 * handler, with the pool and the owner emitter stubbed. No database, no server.
 *
 * What this pins is the trust model:
 *  - Read and cancel need the appointment key. A wrong key is indistinguishable from a missing row
 *    (404). A booking that is past or already checked in cannot be cancelled.
 *  - The phone lookup returns that key and the series manage token. This is a client decision
 *    (2026-10-05, docs/customer-my-appointments.md), so the phone alone manages bookings from any
 *    device. It is fenced: only a full +<country code> number is accepted, keys are given only for
 *    bookings that can still change, the series must be open and at this store, and nothing else
 *    about the customer comes back.
 */

const APPT_ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const OTHER_ID = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';

const h = vi.hoisted(() => ({
  one: vi.fn(),
  many: vi.fn(),
  exec: vi.fn(),
  emitToOwners: vi.fn(),
}));

vi.mock('../../src/db/pool', () => ({ one: h.one, many: h.many, exec: h.exec, pool: {} }));
vi.mock('../../src/realtime/emitters', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/realtime/emitters')>();
  return { ...mod, emitToOwners: h.emitToOwners };
});

const business = { id: 'b-1', slug: 'sharp-cuts', timezone: 'Asia/Kolkata', category: 'Salon & Barber' };
const row = (over: Record<string, unknown> = {}) => ({
  id: APPT_ID,
  business_id: 'b-1',
  customer_name: 'Riya',
  customer_phone: '+919876543210',
  service_id: null,
  service_name: 'Haircut',
  staff_id: 'st-1',
  staff_name: 'Lisa',
  scheduled_start_at: '2099-01-01T10:00:00.000Z',
  scheduled_end_at: '2099-01-01T10:30:00.000Z',
  status: 'confirmed',
  ...over,
});

describe('public appointment self-service', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };

  const testEnv = () => ({
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
  });

  // The first import of the router graph is slow (zod env, pino, the whole public service); pay it
  // once here so no single test races the 5s default and leaks a late request into the next one.
  beforeAll(async () => {
    process.env = testEnv();
    await import('../../src/modules/public/public.routes');
  }, 60_000);

  beforeEach(() => {
    vi.resetModules();
    h.one.mockReset();
    h.many.mockReset();
    h.exec.mockReset();
    h.emitToOwners.mockReset();
    process.env = testEnv();
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
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/public', publicRouter);
    a.use(errorHandler);
    return a;
  }

  async function keyFor(id: string) {
    const { appointmentKey } = await import('../../src/modules/public/public.service');
    return appointmentKey(id);
  }

  describe('appointmentKey', () => {
    it('is domain-separated from the ticket key for the same UUID', async () => {
      const { ticketKey, verifyTicketKey } = await import('../../src/modules/auth/token.service');
      const k = await keyFor(APPT_ID);
      expect(k).toMatch(/^[0-9a-f]{24}$/);
      expect(k).not.toBe(ticketKey(APPT_ID));
      // An appointment key must not open the ticket socket room for a queue entry with that id.
      expect(verifyTicketKey(APPT_ID, k)).toBe(false);
    });
  });

  describe('POST /businesses/:slug/appointments/lookup', () => {
    const path = '/api/v1/public/businesses/sharp-cuts/appointments/lookup';

    it('returns the keys and series token for the phone, so the phone alone manages them (client decision)', async () => {
      h.one.mockResolvedValueOnce(business);
      h.many
        .mockResolvedValueOnce([row()])
        .mockResolvedValueOnce([{ id: 'series-1', manage_token: 'TokenTokenToken1', status: 'active' }]);
      const res = await request(await app()).post(path).send({ phone: '+91 98765 43210' });
      expect(res.status).toBe(200);
      expect(res.body.appointments).toEqual([
        {
          appointmentId: APPT_ID,
          serviceName: 'Haircut',
          staffId: 'st-1',
          staffName: 'Lisa',
          scheduledStartAt: '2099-01-01T10:00:00.000Z',
          status: 'confirmed',
          // Not part of a recurring series (0036) — the row fixture has no series_id.
          repeats: false,
          seriesId: null,
          rescheduledAt: null,
          canChange: true,
          appointmentKey: await keyFor(APPT_ID),
        },
      ]);
      expect(res.body.series).toEqual([{ seriesId: 'series-1', manageToken: 'TokenTokenToken1', status: 'active' }]);
      const [sql, params] = h.many.mock.calls[0];
      expect(sql).toContain("a.status in ('pending', 'confirmed')");
      expect(params[0]).toBe('b-1');
      expect(params[1]).toBe('+919876543210');
    });

    it('only an open series of THIS store, for THIS phone, hands out its token', async () => {
      h.one.mockResolvedValueOnce(business);
      h.many.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await request(await app()).post(path).send({ phone: '+919876543210' });
      const [sql, params] = h.many.mock.calls[1];
      expect(sql).toContain('from appointment_series');
      expect(sql).toContain('business_id = $1');
      expect(sql).toContain('customer_phone = $2');
      // Keys can't be revoked, so a cancelled or ended series never gets its token handed out again.
      expect(sql).toContain("status in ('active', 'paused')");
      expect(params).toEqual(['b-1', '+919876543210']);
    });

    it('a booking from earlier today is listed but gets no key — there is nothing left to change', async () => {
      h.one.mockResolvedValueOnce(business);
      const earlier = new Date(Date.now() - 60_000).toISOString();
      h.many.mockResolvedValueOnce([row({ scheduled_start_at: earlier })]).mockResolvedValueOnce([]);
      const res = await request(await app()).post(path).send({ phone: '+919876543210' });
      expect(res.status).toBe(200);
      expect(res.body.appointments[0].canChange).toBe(false);
      expect(res.body.appointments[0]).not.toHaveProperty('appointmentKey');
    });

    it('returns nothing else about the customer — no name, phone, visitor type or notes', async () => {
      h.one.mockResolvedValueOnce(business);
      h.many
        .mockResolvedValueOnce([row({ visitor_type: 'patient', notes: 'allergic to latex' })])
        .mockResolvedValueOnce([]);
      const res = await request(await app()).post(path).send({ phone: '+919876543210' });
      const body = JSON.stringify(res.body);
      for (const leak of ['Riya', '9876543210', 'patient', 'latex', 'customerName', 'visitorType']) {
        expect(body).not.toContain(leak);
      }
    });

    it('a number with no bookings gets empty lists', async () => {
      h.one.mockResolvedValueOnce(business);
      h.many.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      const res = await request(await app()).post(path).send({ phone: '+919000000000' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ appointments: [], series: [] });
    });

    it('a bare number without its country code → 400, never guessed as +1', async () => {
      // normalizePhone reads a bare 10-digit number as +1 (US). An Indian "9876543210" must not open
      // a stranger's +1 bookings now that the answer carries the keys that cancel them.
      for (const phone of ['9876543210', '919876543210', '+12345', '+91 98765 4321O']) {
        const res = await request(await app()).post(path).send({ phone });
        expect(res.status, phone).toBe(400);
      }
      expect(h.one).not.toHaveBeenCalled();
      expect(h.many).not.toHaveBeenCalled();
    });

    it('unknown store → 404; bad body → 400', async () => {
      h.one.mockResolvedValueOnce(null);
      const res = await request(await app()).post(path).send({ phone: '+919876543210' });
      expect(res.status).toBe(404);
      const bad = await request(await app()).post(path).send({ phone: '1', extra: true });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /appointments/:id', () => {
    const path = `/api/v1/public/appointments/${APPT_ID}`;

    it('no key → 404 without touching the database', async () => {
      const res = await request(await app()).get(path);
      expect(res.status).toBe(404);
      expect(h.one).not.toHaveBeenCalled();
    });

    it("another appointment's key → 404 (same as a missing row, so ids cannot be probed)", async () => {
      const res = await request(await app()).get(path).set('X-Appointment-Key', await keyFor(OTHER_ID));
      expect(res.status).toBe(404);
      expect(h.one).not.toHaveBeenCalled();
    });

    it('right key → current status', async () => {
      h.one.mockResolvedValueOnce(row({ status: 'checked_in' }));
      const res = await request(await app()).get(path).set('X-Appointment-Key', await keyFor(APPT_ID));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ appointmentId: APPT_ID, status: 'checked_in', staffName: 'Lisa' });
    });
  });

  describe('POST /appointments/:id/cancel', () => {
    const path = `/api/v1/public/appointments/${APPT_ID}/cancel`;

    it('malformed key → 400; well-formed but wrong key → 404', async () => {
      const bad = await request(await app()).post(path).send({ key: 'nope' });
      expect(bad.status).toBe(400);
      const wrong = await request(await app()).post(path).send({ key: await keyFor(OTHER_ID) });
      expect(wrong.status).toBe(404);
      expect(h.one).not.toHaveBeenCalled();
    });

    it('right key on a future confirmed booking → cancelled, owners told', async () => {
      h.one.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ status: 'cancelled', staff_name: undefined }));
      const res = await request(await app()).post(path).send({ key: await keyFor(APPT_ID) });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ appointmentId: APPT_ID, status: 'cancelled', staffName: 'Lisa' });
      const [sql] = h.one.mock.calls[1];
      // The guard lives in the UPDATE itself, so a racing check-in cannot be overwritten.
      expect(sql).toContain("status in ('pending', 'confirmed')");
      expect(sql).toContain('scheduled_start_at > now()');
      expect(h.emitToOwners).toHaveBeenCalledWith('b-1', 'appointment:updated', expect.anything());
    });

    it('already checked in (or past) → 422, nothing emitted', async () => {
      h.one.mockResolvedValueOnce(row({ status: 'checked_in' })).mockResolvedValueOnce(null);
      const res = await request(await app()).post(path).send({ key: await keyFor(APPT_ID) });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(res.body.error.message).toBe("This appointment can't be cancelled any more");
      expect(h.emitToOwners).not.toHaveBeenCalled();
    });

    it('cancelling twice → 422 "already cancelled"', async () => {
      h.one.mockResolvedValueOnce(row({ status: 'cancelled' })).mockResolvedValueOnce(null);
      const res = await request(await app()).post(path).send({ key: await keyFor(APPT_ID) });
      expect(res.status).toBe(422);
      expect(res.body.error.message).toBe('This appointment is already cancelled');
    });
  });
});
