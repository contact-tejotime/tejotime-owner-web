import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * The server-side guards added after manual QA (30 Sep 2026), through the real router, validator
 * and error handler with the database and side effects stubbed. No database, no server.
 *
 *  - POST /appointments re-checks the slot under a lock: taken, overlapping, past, closed,
 *    out-of-hours and beyond-window times are a 409 SLOT_UNAVAILABLE; a stylist from another
 *    store is a 400; a malformed stylist id is a 400 (was a 500); a rejected booking creates no
 *    customer row.
 *  - DELETE /tickets/:id needs the ticket key (was: anyone could remove anyone).
 *  - POST /track answers with position only — no customer name, no ticket key.
 */

const BIZ = { id: 'b-1', slug: 'sharp-cuts', timezone: 'Asia/Kolkata', category: 'Salon & Barber' };
const LISA = '7547f6a4-e4d3-4bee-9ea0-a1d57a2a27d3';
const JOHN = '341ea088-f635-445b-8ade-631c4db9a705';
const FOREIGN = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const HAIRCUT = '6bcf8d7f-e177-455c-a43e-1f96bd7dd082';
const TICKET = '9a9a9a9a-1b1b-4c2c-8d3d-4e4e4e4e4e4e';
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();

const h = vi.hoisted(() => ({
  state: { bookings: [] as Array<{ scheduled_start_at: string; scheduled_end_at: string; staff_id: string | null }>, closed: false, inserts: 0 },
  one: vi.fn(),
  many: vi.fn(),
  exec: vi.fn(),
  callRpc: vi.fn(),
  emitToOwners: vi.fn(),
  emitToTicket: vi.fn(),
  findOrCreateCustomer: vi.fn(),
  broadcastQueue: vi.fn(),
}));

vi.mock('../../src/db/pool', () => ({
  one: h.one,
  many: h.many,
  exec: h.exec,
  pool: {},
  transaction: async (fn: (c: unknown) => Promise<unknown>) => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (sql.includes('from business_hour')) return { rows: [{ opens_at: '10:00:00', closes_at: '20:00:00', is_closed: h.state.closed }] };
        if (sql.includes('from staff where business_id')) return { rows: [{ id: LISA }, { id: JOHN }] };
        if (sql.includes('from appointment') && sql.includes('status in')) return { rows: h.state.bookings };
        if (sql.includes('insert into appointment_service')) return { rows: [] };
        if (sql.includes('insert into appointment')) {
          h.state.inserts++;
          return { rows: [{ id: 'appt-1', customer_name: 'Riya', service_name: 'Haircut', scheduled_start_at: ist('2026-10-05', '11:00'), status: 'confirmed' }] };
        }
        if (sql.includes('select name from staff')) return { rows: [{ name: 'Lisa' }] };
        throw new Error(`unexpected SQL in transaction: ${sql.slice(0, 60)}`);
      },
    };
    return fn(client);
  },
}));
vi.mock('../../src/db/rpc', () => ({ callRpc: h.callRpc }));
vi.mock('../../src/realtime/emitters', async (orig) => ({
  ...(await orig<typeof import('../../src/realtime/emitters')>()),
  emitToOwners: h.emitToOwners,
  emitToTicket: h.emitToTicket,
}));
vi.mock('../../src/modules/customers/customer.repo', () => ({
  findOrCreateCustomer: h.findOrCreateCustomer,
  recordSmsOptIn: vi.fn(),
  recordReviewSmsOptIn: vi.fn(),
}));
vi.mock('../../src/modules/queue/queue.service', async (orig) => ({
  ...(await orig<typeof import('../../src/modules/queue/queue.service')>()),
  broadcastQueue: h.broadcastQueue,
}));
vi.mock('../../src/modules/queue/queue.context', () => ({
  loadQueueContext: vi.fn(async () => ({ engineEntries: [], engineStaff: [], engineServices: [], staffRows: [] })),
}));
vi.mock('../../src/modules/notifications/sms-dispatch', () => ({ sendBookingConfirmation: vi.fn() }));

describe('public booking guards', { timeout: 30_000 }, () => {
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
    BOOKING_SLOT_MINUTES: '30',
  });

  beforeAll(async () => {
    process.env = testEnv();
    await import('../../src/modules/public/public.routes');
  }, 60_000);

  beforeEach(() => {
    vi.resetModules();
    // Wed 30 Sep 2026, 16:30 IST. Only Date is faked so supertest's own timers keep working.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T11:00:00.000Z'));
    process.env = testEnv();
    h.state.bookings = [];
    h.state.closed = false;
    h.state.inserts = 0;
    for (const f of [h.one, h.many, h.exec, h.callRpc, h.emitToOwners, h.emitToTicket, h.findOrCreateCustomer, h.broadcastQueue]) f.mockReset();
    h.one.mockImplementation(async (sql: string) => {
      if (sql.includes('from business where slug')) return BIZ;
      if (sql.includes('from queue_entry where id')) return { business_id: 'b-1', status: 'waiting' };
      if (sql.includes('from queue_entry')) return { id: TICKET, business_id: 'b-1', token: 'A-7', status: 'completed' };
      return null;
    });
    h.many.mockImplementation(async (sql: string) =>
      sql.includes('from service') ? [{ id: HAIRCUT, name: 'Haircut', duration_minutes: 30, price_paise: 35000 }] : [],
    );
    h.findOrCreateCustomer.mockResolvedValue('cust-1');
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });
  afterAll(() => vi.restoreAllMocks());

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
  const book = async (slotStart: string, preferredStaffId: string = LISA) =>
    request(await app())
      .post('/api/v1/public/businesses/sharp-cuts/appointments')
      .send({ name: 'Riya', phone: '+919876510001', serviceIds: [HAIRCUT], preferredStaffId, slotStart });

  describe('POST /appointments', () => {
    it('a free, offered time is booked once and returns the appointment key', async () => {
      const res = await book(ist('2026-10-05', '11:00'));
      expect(res.status).toBe(201);
      expect(res.body.staffName).toBe('Lisa');
      expect(res.body.appointmentKey).toMatch(/^[0-9a-f]{24}$/);
      expect(h.state.inserts).toBe(1);
      expect(h.findOrCreateCustomer).toHaveBeenCalledTimes(1);
    });

    it('a time already booked for that stylist → 409 SLOT_UNAVAILABLE, nothing written', async () => {
      h.state.bookings = [{ scheduled_start_at: ist('2026-10-05', '11:00'), scheduled_end_at: ist('2026-10-05', '11:30'), staff_id: LISA }];
      const res = await book(ist('2026-10-05', '11:00'));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(h.state.inserts).toBe(0);
      expect(h.findOrCreateCustomer).not.toHaveBeenCalled(); // no orphan customer
    });

    it('a time inside a longer booking (overlap) → 409', async () => {
      h.state.bookings = [{ scheduled_start_at: ist('2026-10-05', '10:00'), scheduled_end_at: ist('2026-10-05', '11:30'), staff_id: LISA }];
      const res = await book(ist('2026-10-05', '10:30'));
      expect(res.status).toBe(409);
      expect(h.state.inserts).toBe(0);
    });

    it.each([
      ['in the past', ist('2026-09-29', '11:00')],
      ['at 11 PM', ist('2026-10-05', '23:00')],
      ['off the 30-minute grid', ist('2026-10-05', '11:15')],
      ['beyond the 14-day window', ist('2026-11-30', '11:00')],
    ])('a time %s → 409', async (_label, when) => {
      const res = await book(when);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(h.state.inserts).toBe(0);
    });

    it('a closed day → 409', async () => {
      h.state.closed = true;
      const res = await book(ist('2026-10-04', '12:00'));
      expect(res.status).toBe(409);
    });

    it("another store's stylist → 400, nothing written", async () => {
      const res = await book(ist('2026-10-05', '11:00'), FOREIGN);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(h.state.inserts).toBe(0);
      expect(h.findOrCreateCustomer).not.toHaveBeenCalled();
    });

    it('a malformed stylist id → 400 (was a 500)', async () => {
      const res = await book(ist('2026-10-05', '11:00'), 'abc');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /tickets/:id', () => {
    const path = `/api/v1/public/tickets/${TICKET}`;
    const keyFor = async (id: string) => (await import('../../src/modules/auth/token.service')).ticketKey(id);

    it('no key → 404, the ticket is not touched', async () => {
      const res = await request(await app()).delete(path);
      expect(res.status).toBe(404);
      expect(h.callRpc).not.toHaveBeenCalled();
    });
    it("another ticket's key → 404", async () => {
      const res = await request(await app()).delete(path).set('X-Ticket-Key', await keyFor('other-ticket'));
      expect(res.status).toBe(404);
      expect(h.callRpc).not.toHaveBeenCalled();
    });
    it('the right key → leaves the queue', async () => {
      const res = await request(await app()).delete(path).set('X-Ticket-Key', await keyFor(TICKET));
      expect(res.status).toBe(200);
      expect(h.callRpc).toHaveBeenCalledWith('queue_leave', expect.objectContaining({ p_entry_id: TICKET }));
    });
  });

  describe('POST /track', () => {
    it('answers with position only — no customer name, no ticket key', async () => {
      const res = await request(await app()).post('/api/v1/public/businesses/sharp-cuts/track').send({ phone: '+919876520002' });
      expect(res.status).toBe(200);
      expect(res.body.found).toBe(true);
      expect(res.body.token).toBe('A-7');
      expect(res.body).not.toHaveProperty('customerName');
      expect(res.body).not.toHaveProperty('socket');
      expect(JSON.stringify(res.body)).not.toMatch(/ticketKey/);
    });
  });
});
