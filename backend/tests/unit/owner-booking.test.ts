import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An owner books a customer (`POST /appointments`, `GET /appointments/slots`) — the "Due to come
 * back" list's Book (docs/customer-due-list.md) — through the real router, guards, validators and
 * service, with Postgres replaced by a small in-memory fake. The real-SQL run is
 * backend/scripts/smoke-due-list-db.ts and smoke-due-list.mjs.
 *
 * Pins what the old, unguarded POST let through:
 *  - a time must be one the slots list offers (no overlap, open hours, future, today … today+60);
 *  - a stylist from another store is refused; a staff login books only on its own chair;
 *  - the customer and every service must belong to this store (and be switched on);
 *  - the services are itemised, the source is 'owner', and nothing is ever texted;
 *  - booking settles any logged call outcome for that customer.
 */

const BIZ = { id: 'b-1', slug: 'sharp-cuts', timezone: 'Asia/Kolkata', category: 'Salon & Barber', is_active: true };
const LISA = '7547f6a4-e4d3-4bee-9ea0-a1d57a2a27d3';
const JOHN = '341ea088-f635-445b-8ade-631c4db9a705';
const FOREIGN_STAFF = '99999999-1111-4222-8333-444444444444';
const HAIRCUT = '6bcf8d7f-e177-455c-a43e-1f96bd7dd082';
const SPA = '7bcf8d7f-e177-455c-a43e-1f96bd7dd082';
const OFF_SERVICE = '8bcf8d7f-e177-455c-a43e-1f96bd7dd082';
const RIYA = 'c0c0c0c0-1111-4222-8333-444444444444';
const OTHER_STORE_CUSTOMER = 'c1c1c1c1-1111-4222-8333-444444444444';
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  appts: [] as Row[],
  inserted: [] as { sql: string; params: unknown[] }[],
  itemised: [] as unknown[][],
  followupDeletes: [] as unknown[][],
  staffPerms: [] as Row[],
  customersCreated: [] as unknown[][],
  one: vi.fn(),
  many: vi.fn(),
  exec: vi.fn(),
  emitToOwners: vi.fn(),
  sendBookingConfirmation: vi.fn(),
}));

const SERVICES: Row[] = [
  { id: HAIRCUT, name: 'Haircut', duration_minutes: 30, price_paise: 35000, is_active: true },
  { id: SPA, name: 'Hair Spa', duration_minutes: 60, price_paise: 80000, is_active: true },
  { id: OFF_SERVICE, name: 'Old Thing', duration_minutes: 30, price_paise: 0, is_active: false },
];

async function fake(sql: string, p: unknown[] = []): Promise<Row[]> {
  const S = (i: number) => p[i] as string;
  if (sql.includes('pg_advisory_xact_lock')) return [];
  if (sql.includes('select * from business where id')) return [BIZ];
  if (sql.includes('from user_permission')) return h.staffPerms;
  if (sql.includes('from service where business_id = $1 and id = any')) {
    const ids = p[1] as string[];
    return SERVICES.filter((s) => ids.includes(s.id) && (!sql.includes('is_active = true') || s.is_active));
  }
  if (sql.includes('select id from staff where id = $1')) return [LISA, JOHN].includes(S(0)) ? [{ id: S(0) }] : [];
  if (sql.includes('from business_hour')) {
    // Open 10:00–20:00, closed Sundays.
    const d = p[1] as number;
    return [{ opens_at: '10:00:00', closes_at: '20:00:00', is_closed: d === 0 }];
  }
  if (sql.includes('select id from staff where business_id')) return [{ id: LISA }, { id: JOHN }];
  if (sql.includes('make_interval')) {
    return h.appts.filter((a) => a.scheduled_start_at < S(2) && a.scheduled_end_at > S(1));
  }
  if (sql.includes('as staff_active')) return [];
  if (sql.includes('select id, name, phone from customer where id = $1 and business_id = $2')) {
    return S(0) === RIYA ? [{ id: RIYA, name: 'Riya Shah', phone: '+919876543210' }] : [];
  }
  if (sql.includes('select id from customer where business_id = $1 and phone = $2')) return [];
  if (sql.includes('insert into customer')) {
    h.customersCreated.push(p);
    return [{ id: 'new-customer' }];
  }
  if (sql.includes('insert into appointment_service')) {
    h.itemised.push(p);
    return [];
  }
  if (sql.includes('insert into appointment')) {
    h.inserted.push({ sql, params: p });
    const row = {
      id: `appt-${h.inserted.length}`, business_id: 'b-1', customer_id: p[1], customer_name: p[2], customer_phone: p[3],
      service_id: p[4], service_name: p[5], staff_id: p[6], scheduled_start_at: p[7], scheduled_end_at: p[8],
      status: 'confirmed', source: 'owner', notes: p[9], series_id: null, cancel_reason: null,
    };
    h.appts.push(row);
    return [row];
  }
  if (sql.includes('delete from customer_followup')) {
    h.followupDeletes.push(p);
    return [];
  }
  throw new Error(`unexpected SQL: ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
}

vi.mock('../../src/db/pool', () => ({
  one: h.one,
  many: h.many,
  exec: h.exec,
  pool: { on: vi.fn() },
  transaction: async (fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: async (sql: string, params?: unknown[]) => ({ rows: await fake(sql, params) }) }),
}));
vi.mock('../../src/realtime/emitters', async (orig) => ({
  ...(await orig<typeof import('../../src/realtime/emitters')>()),
  emitToOwners: h.emitToOwners,
}));
vi.mock('../../src/modules/notifications/sms-dispatch', () => ({ sendBookingConfirmation: h.sendBookingConfirmation }));
vi.mock('../../src/modules/queue/queue.context', () => ({
  loadQueueContext: vi.fn(async () => ({ engineEntries: [], engineStaff: [], engineServices: [], staffRows: [] })),
}));

describe('owner booking — POST /appointments, GET /appointments/slots', { timeout: 30_000 }, () => {
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
    await import('../../src/modules/appointments/appointments.routes');
  }, 60_000);

  beforeEach(() => {
    vi.resetModules();
    // Wed 30 Sep 2026, 16:30 IST: the owner may book 30 Sep … 29 Nov.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T11:00:00.000Z'));
    process.env = testEnv();
    // Lisa is taken on Thu 1 Oct 12:00–12:30.
    h.appts = [
      {
        id: 'busy', staff_id: LISA, status: 'confirmed',
        scheduled_start_at: ist('2026-10-01', '12:00'), scheduled_end_at: ist('2026-10-01', '12:30'),
      },
    ];
    h.inserted = [];
    h.itemised = [];
    h.followupDeletes = [];
    h.customersCreated = [];
    h.staffPerms = [];
    for (const f of [h.one, h.many, h.exec, h.emitToOwners, h.sendBookingConfirmation]) f.mockReset();
    h.one.mockImplementation(async (sql: string, params: unknown[]) => (await fake(sql, params))[0] ?? null);
    h.many.mockImplementation(async (sql: string, params: unknown[]) => fake(sql, params));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });
  afterAll(() => vi.restoreAllMocks());

  async function app() {
    const { appointmentsRouter } = await import('../../src/modules/appointments/appointments.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/appointments', appointmentsRouter);
    a.use(errorHandler);
    return a;
  }

  async function bearer(role: 'owner' | 'co_owner' | 'staff', staffId: string | null = null) {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    return `Bearer ${signAccessToken({ userId: 'u-1', businessId: 'b-1', role: role as any, plan: 'free' as any, staffId })}`;
  }

  const book = async (body: Row, auth?: string) =>
    request(await app())
      .post('/api/v1/appointments')
      .set('authorization', auth ?? (await bearer('owner')))
      .send(body);

  describe('a time the picker offers', () => {
    it('books the customer: itemised services, source owner, no text, follow-up settled, owners told', async () => {
      const res = await book({ customerId: RIYA, serviceIds: [HAIRCUT, SPA], staffId: LISA, slotStart: ist('2026-10-01', '10:00') });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ staffId: LISA, serviceName: 'Haircut + Hair Spa' });
      expect(h.inserted).toHaveLength(1);
      const ins = h.inserted[0];
      expect(ins.sql).toContain("'owner'");
      expect(ins.sql).toMatch(/'owner', \$10, false, false,/); // sms_opt_in, review_sms_opt_in
      expect(ins.params.slice(1, 4)).toEqual([RIYA, 'Riya Shah', '+919876543210']);
      // 30 + 60 minutes.
      expect(ins.params[8]).toBe(ist('2026-10-01', '11:30'));
      expect(h.itemised).toHaveLength(1);
      expect(h.followupDeletes).toEqual([[RIYA, 'b-1']]);
      expect(h.emitToOwners).toHaveBeenCalledWith('b-1', 'appointment:created', expect.anything());
      expect(h.sendBookingConfirmation).not.toHaveBeenCalled();
    });

    it.each([
      ['a taken time', ist('2026-10-01', '12:00')],
      ['an overlapping longer visit', ist('2026-10-01', '11:30')],
      ['a past time', ist('2026-09-30', '10:00')],
      ['after today+60', ist('2026-11-30', '11:00')],
      ['a closed day (Sunday)', ist('2026-10-04', '11:00')],
      ['outside opening hours', ist('2026-10-01', '20:00')],
      ['off the 30-minute grid', ist('2026-10-01', '10:10')],
    ])('refuses %s → 409 SLOT_UNAVAILABLE', async (_label, slotStart) => {
      const services = slotStart === ist('2026-10-01', '11:30') ? [HAIRCUT, SPA] : [HAIRCUT];
      const res = await book({ customerId: RIYA, serviceIds: services, staffId: LISA, slotStart });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(h.inserted).toHaveLength(0);
    });

    it('lets "any stylist" take a time one stylist is busy at', async () => {
      const res = await book({ customerId: RIYA, serviceIds: [HAIRCUT], staffId: 'any', slotStart: ist('2026-10-01', '12:00') });
      expect(res.status).toBe(201);
      expect(res.body.staffId).toBeNull();
    });
  });

  describe('the store’s own customer, services and stylists', () => {
    it('refuses a stylist from another store (400)', async () => {
      const res = await book({ customerId: RIYA, serviceIds: [HAIRCUT], staffId: FOREIGN_STAFF, slotStart: ist('2026-10-01', '10:00') });
      expect(res.status).toBe(400);
      expect(h.inserted).toHaveLength(0);
    });

    it('refuses another store’s customer (404)', async () => {
      const res = await book({ customerId: OTHER_STORE_CUSTOMER, serviceIds: [HAIRCUT], slotStart: ist('2026-10-01', '10:00') });
      expect(res.status).toBe(404);
      expect(h.inserted).toHaveLength(0);
    });

    it('refuses an unknown or switched-off service (404)', async () => {
      for (const id of [OFF_SERVICE, '00000000-1111-4222-8333-444444444444']) {
        const res = await book({ customerId: RIYA, serviceIds: [id], slotStart: ist('2026-10-01', '10:00') });
        expect(res.status).toBe(404);
      }
      expect(h.inserted).toHaveLength(0);
    });

    it('still takes the legacy body (name + phone, serviceId, scheduledStartAt) and finds/creates the customer', async () => {
      const res = await book({
        customerName: 'Walk Up',
        customerPhone: '+919811112222',
        serviceId: HAIRCUT,
        staffId: null,
        scheduledStartAt: ist('2026-10-01', '10:30'),
      });
      expect(res.status).toBe(201);
      expect(h.customersCreated).toHaveLength(1);
      expect(h.inserted[0].params[1]).toBe('new-customer');
    });

    it('Book appointment: a typed customer needs a real phone — no phone or a bad one is 400 and writes nothing', async () => {
      const base = { customerName: 'New Person', serviceIds: [HAIRCUT], slotStart: ist('2026-10-01', '10:00') };
      for (const body of [base, { ...base, customerPhone: '' }, { ...base, customerPhone: '12' }]) {
        const res = await book(body);
        expect(res.status).toBe(400);
      }
      expect(h.inserted).toHaveLength(0);
      expect(h.customersCreated).toHaveLength(0);
    });

    it('Book appointment: name + phone books and links the customer; a Hospital visitor type is kept', async () => {
      const res = await book({
        customerName: 'New Person',
        customerPhone: '+919811113333',
        serviceIds: [HAIRCUT],
        staffId: LISA,
        slotStart: ist('2026-10-01', '10:00'),
        visitorType: 'patient',
      });
      expect(res.status).toBe(201);
      expect(h.customersCreated).toHaveLength(1);
      expect(h.inserted[0].params[1]).toBe('new-customer');
      expect(h.inserted[0].params[3]).toBe('+919811113333');
      expect(h.inserted[0].params[10]).toBe('patient');
    });

    it.each([
      ['no customer', { serviceIds: [HAIRCUT], slotStart: ist('2026-10-01', '10:00') }],
      ['an unknown visitor type', { customerId: RIYA, slotStart: ist('2026-10-01', '10:00'), visitorType: 'guest' }],
      ['no time', { customerId: RIYA, serviceIds: [HAIRCUT] }],
      ['two times', { customerId: RIYA, slotStart: ist('2026-10-01', '10:00'), scheduledStartAt: ist('2026-10-01', '10:00') }],
      ['an unknown field', { customerId: RIYA, slotStart: ist('2026-10-01', '10:00'), smsOptIn: true }],
    ])('400 for %s', async (_label, body) => {
      expect((await book(body)).status).toBe(400);
    });
  });

  describe('a staff login', () => {
    it('cannot book with the default "view" access (403)', async () => {
      const auth = await bearer('staff', LISA);
      const res = await book({ customerId: RIYA, serviceIds: [HAIRCUT], slotStart: ist('2026-10-01', '10:00') }, auth);
      expect(res.status).toBe(403);
    });

    it('with "manage" books only on its own chair', async () => {
      h.staffPerms = [{ module: 'appointments', access: 'manage' }];
      const auth = await bearer('staff', LISA);
      for (const staffId of [JOHN, 'any']) {
        const res = await book({ customerId: RIYA, serviceIds: [HAIRCUT], staffId, slotStart: ist('2026-10-01', '10:00') }, auth);
        expect(res.status).toBe(403);
      }
      expect(h.inserted).toHaveLength(0);
      const own = await book({ customerId: RIYA, serviceIds: [HAIRCUT], slotStart: ist('2026-10-01', '10:00') }, auth);
      expect(own.status).toBe(201);
      expect(own.body.staffId).toBe(LISA);
    });
  });

  describe('GET /appointments/slots', () => {
    it('lists the free times for these services and the owner range — not swallowed by /:id', async () => {
      const a = await app();
      const res = await request(a)
        .get(`/api/v1/appointments/slots?date=2026-10-01&staffId=${LISA}&serviceIds=${HAIRCUT},${SPA}`)
        .set('authorization', await bearer('owner'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ date: '2026-10-01', today: '2026-09-30', lastDay: '2026-11-29' });
      const starts = (res.body.slots as { startAt: string }[]).map((s) => s.startAt);
      expect(starts).toContain(ist('2026-10-01', '10:00'));
      // 90 minutes from 11:00 would run into Lisa's 12:00 booking.
      expect(starts).not.toContain(ist('2026-10-01', '11:00'));
    });

    it('refuses a bad service list (400) and a view-only staff login (403)', async () => {
      const a = await app();
      const bad = await request(a)
        .get('/api/v1/appointments/slots?date=2026-10-01&serviceIds=not-a-uuid')
        .set('authorization', await bearer('owner'));
      expect(bad.status).toBe(400);
      const staff = await request(a)
        .get('/api/v1/appointments/slots?date=2026-10-01')
        .set('authorization', await bearer('staff', LISA));
      expect(staff.status).toBe(403);
    });
  });
});
