import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * Recurring appointments through the real public router, validator, error handler and series
 * service — with the database replaced by a small stateful fake. No database, no server.
 * (The real-Postgres run is backend/scripts/smoke-recurring.mjs.)
 *
 * Pins:
 *  - a repeating booking books every date already inside the horizon in ONE transaction, texts
 *    only once, and reports a date it could not book instead of flagging the owner;
 *  - a second open series for the same phone is refused BEFORE anything is written;
 *  - the store's switch and the rule limits are enforced by the API, not just the page;
 *  - the manage endpoints need the token, and a wrong one is indistinguishable from none;
 *  - the hourly job books the next date once the horizon reaches it, texts the confirmation,
 *    flags a clash to the owner, and pauses a series whose stylist has left.
 */

const BIZ = { id: 'b-1', slug: 'sharp-cuts', timezone: 'Asia/Kolkata', category: 'Salon & Barber', recurring_enabled: true, is_active: true };
const LISA = '7547f6a4-e4d3-4bee-9ea0-a1d57a2a27d3';
const JOHN = '341ea088-f635-445b-8ade-631c4db9a705';
const HAIRCUT = '6bcf8d7f-e177-455c-a43e-1f96bd7dd082';
const SERIES = '5e5e5e5e-1111-4222-8333-444444444444';
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  state: {
    bookings: [] as Row[],
    created: [] as Row[],
    series: null as Row | null,
    issues: [] as Row[],
    seriesUpdates: [] as unknown[][],
    openSeriesForPhone: false,
    activeStaff: [] as string[],
    inserts: 0,
  },
  one: vi.fn(),
  many: vi.fn(),
  exec: vi.fn(),
  emitToOwners: vi.fn(),
  findOrCreateCustomer: vi.fn(),
  sendBookingConfirmation: vi.fn(),
}));

/** The rows a series visit insert writes, keyed by the column order in series.service.ts. */
function seriesVisitRow(p: unknown[]): Row {
  return {
    id: `visit-${p[15]}`,
    business_id: p[0],
    customer_name: p[2],
    customer_phone: p[3],
    service_name: p[5],
    staff_id: p[6],
    scheduled_start_at: p[7],
    scheduled_end_at: p[8],
    status: 'confirmed',
    sms_opt_in: p[11],
    series_id: p[13],
    occurrence_date: p[15],
  };
}

async function fakeQuery(sql: string, params: unknown[] = []): Promise<Row[]> {
  const s = h.state;
  if (sql.includes('pg_advisory_xact_lock')) return [];
  if (sql.includes('select 1 from appointment_series')) return s.openSeriesForPhone ? [{ '?column?': 1 }] : [];
  if (sql.includes('select * from business where id')) return [BIZ];
  if (sql.includes('from business_hour')) {
    // 10–8 every day except Sunday. One weekday when the query names it, else the whole week.
    const day = (d: number) => ({ day_of_week: d, opens_at: '10:00:00', closes_at: '20:00:00', is_closed: d === 0 });
    return sql.includes('day_of_week = $2') ? [day(params[1] as number)] : [0, 1, 2, 3, 4, 5, 6].map(day);
  }
  if (sql.includes('cancel_reason from appointment') || sql.includes('rescheduled_at from appointment')) return s.created;
  // generateSeriesVisits' "already handled" dates: any visit row of the series in the range.
  if (sql.includes('select distinct occurrence_date')) {
    return s.created
      .filter((r) => r.occurrence_date >= (params[1] as string) && r.occurrence_date <= (params[2] as string))
      .map((r) => ({ d: r.occurrence_date }));
  }
  if (sql.includes('select id, name from staff')) {
    return s.activeStaff.map((id) => ({ id, name: id === LISA ? 'Lisa' : 'John' }));
  }
  if (sql.includes('select id from staff where business_id')) return s.activeStaff.map((id) => ({ id }));
  if (sql.includes('from appointment') && sql.includes('make_interval')) return [...s.bookings, ...s.created];
  if (sql.includes('insert into appointment_series_service')) return [];
  if (sql.includes('insert into appointment_series_issue')) {
    s.issues.push({ date: params[3], reason: params[5] });
    return [];
  }
  if (sql.includes('insert into appointment_series')) {
    const p = params;
    s.series = {
      id: SERIES, business_id: p[0], customer_id: p[1], customer_name: p[2], customer_phone: p[3],
      staff_id: p[4], staff_locked: p[5], visitor_type: p[6], start_time: p[7], anchor_date: p[8],
      interval_days: p[9], end_type: p[10], end_count: p[11], end_date: p[12], generated_through: p[8],
      sms_opt_in: p[13], review_sms_opt_in: p[14], source: p[15], manage_token: p[16],
      status: 'active', pause_reason: null, version: 1,
    };
    return [{ id: SERIES }];
  }
  if (sql.includes('insert into appointment_service')) return [];
  if (sql.includes('insert into appointment') && sql.includes('series_version')) {
    const row = seriesVisitRow(params);
    s.created.push(row);
    return [row];
  }
  if (sql.includes('insert into appointment')) {
    s.inserts++;
    return [{ id: 'appt-1', customer_name: 'Riya', service_name: 'Haircut', scheduled_start_at: params[7], status: 'confirmed' }];
  }
  if (sql.includes('update appointment set series_id')) return [];
  if (sql.includes('from appointment_series_service ss')) {
    return [{ series_name: 'Haircut', id: HAIRCUT, name: 'Haircut', duration_minutes: 30, price_paise: 35000 }];
  }
  if (sql.includes('from appointment_series s')) return s.series ? [{ ...s.series }] : [];
  if (sql.includes('update appointment_series')) {
    s.seriesUpdates.push(params);
    if (s.series) {
      if (sql.includes("status = 'paused'")) s.series.status = 'paused';
      else {
        s.series.generated_through = params[1];
        // generateSeriesVisits' cursor update: $3 says "the series has ended".
        if (params[2] === true) s.series.status = 'ended';
      }
    }
    return [];
  }
  if (sql.includes('select name from staff')) return [{ name: 'Lisa' }];
  throw new Error(`unexpected SQL: ${sql.replace(/\s+/g, ' ').slice(0, 80)}`);
}

vi.mock('../../src/db/pool', () => ({
  one: h.one,
  many: h.many,
  exec: h.exec,
  pool: {},
  transaction: async (fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: async (sql: string, params?: unknown[]) => ({ rows: await fakeQuery(sql, params) }) }),
}));
vi.mock('../../src/realtime/emitters', async (orig) => ({
  ...(await orig<typeof import('../../src/realtime/emitters')>()),
  emitToOwners: h.emitToOwners,
}));
vi.mock('../../src/modules/customers/customer.repo', () => ({
  findOrCreateCustomer: h.findOrCreateCustomer,
  recordSmsOptIn: vi.fn(),
  recordReviewSmsOptIn: vi.fn(),
}));
vi.mock('../../src/modules/queue/queue.context', () => ({
  loadQueueContext: vi.fn(async () => ({ engineEntries: [], engineStaff: [], engineServices: [], staffRows: [] })),
}));
vi.mock('../../src/modules/notifications/sms-dispatch', () => ({ sendBookingConfirmation: h.sendBookingConfirmation }));

describe('recurring appointments — public API and the hourly job', { timeout: 30_000 }, () => {
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
    Object.assign(h.state, {
      bookings: [], created: [], series: null, issues: [], seriesUpdates: [], openSeriesForPhone: false,
      activeStaff: [LISA, JOHN], inserts: 0,
    });
    BIZ.recurring_enabled = true;
    for (const f of [h.one, h.many, h.exec, h.emitToOwners, h.findOrCreateCustomer, h.sendBookingConfirmation]) f.mockReset();
    h.one.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('from business where slug')) return BIZ;
      if (sql.includes('where s.manage_token')) {
        return h.state.series && params[0] === h.state.series.manage_token
          ? { ...h.state.series, business_name: 'Sharp Cuts', business_slug: 'sharp-cuts', business_phone: '919399385943', timezone: 'Asia/Kolkata' }
          : null;
      }
      return null;
    });
    h.many.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('from service')) return [{ id: HAIRCUT, name: 'Haircut', duration_minutes: 30, price_paise: 35000 }];
      if (sql.includes('select s.id, s.business_id')) return h.state.series ? [{ id: SERIES, business_id: 'b-1' }] : [];
      return fakeQuery(sql, params);
    });
    h.findOrCreateCustomer.mockResolvedValue('cust-1');
    h.sendBookingConfirmation.mockResolvedValue(undefined);
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

  const book = async (repeat: unknown, over: Record<string, unknown> = {}) =>
    request(await app())
      .post('/api/v1/public/businesses/sharp-cuts/appointments')
      .send({
        name: 'Riya',
        phone: '+91 98765 43210',
        serviceIds: [HAIRCUT],
        preferredStaffId: LISA,
        slotStart: ist('2026-10-03', '11:00'), // Sat 3 Oct, 11:00
        smsOptIn: true,
        ...(repeat ? { repeat } : {}),
        ...over,
      });

  describe('booking a repeating appointment', () => {
    it('books every date already inside the horizon, in one go, and texts only once', async () => {
      // Weekly from Sat 3 Oct; today is 30 Sep, so the horizon is 20 Oct: 10 Oct and 17 Oct now.
      const res = await book({ everyDays: 7, end: { type: 'never' } });
      expect(res.status).toBe(201);
      const visits = res.body.series.visits.map((v: Row) => v.scheduledStartAt);
      expect(visits).toEqual([ist('2026-10-03', '11:00'), ist('2026-10-10', '11:00'), ist('2026-10-17', '11:00')]);
      expect(res.body.series.visits.every((v: Row) => /^[0-9a-f]{24}$/.test(v.appointmentKey))).toBe(true);
      expect(res.body.series.manageToken).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(res.body.series.skipped).toEqual([]);
      // The cursor moved to the last date handled, so the job starts from 24 Oct.
      expect(h.state.series!.generated_through).toBe('2026-10-17');
      // One confirmation (the first visit) — not one per visit the customer just saw on screen.
      expect(h.sendBookingConfirmation).toHaveBeenCalledTimes(1);
      expect(h.sendBookingConfirmation).toHaveBeenCalledWith('b-1', 'appt-1');
      // Owners hear about every visit.
      const created = h.emitToOwners.mock.calls.filter((c) => c[1] === 'appointment:created');
      expect(created).toHaveLength(3);
    });

    it('reports a date it could not book to the customer, without flagging the owner', async () => {
      // Lisa is already booked at 11:00 on Sat 10 Oct.
      h.state.bookings = [{ scheduled_start_at: ist('2026-10-10', '11:00'), scheduled_end_at: ist('2026-10-10', '11:30'), staff_id: LISA }];
      const res = await book({ everyDays: 7, end: { type: 'never' } });
      expect(res.status).toBe(201);
      expect(res.body.series.skipped).toEqual([{ date: '2026-10-10', reason: 'taken' }]);
      expect(res.body.series.visits).toHaveLength(2); // 3 Oct and 17 Oct
      expect(h.state.issues).toEqual([]);
    });

    it('skips a closed day silently', async () => {
      // Every 8 days from Sat 3 Oct lands on Sun 11 Oct — the store is shut on Sundays.
      const res = await book({ everyDays: 8, end: { type: 'never' } });
      expect(res.status).toBe(201);
      expect(res.body.series.skipped).toEqual([{ date: '2026-10-11', reason: 'closed' }]);
      expect(res.body.series.visits.map((v: Row) => v.scheduledStartAt)).toEqual([
        ist('2026-10-03', '11:00'),
        ist('2026-10-19', '11:00'),
      ]);
    });

    it('refuses a second open series for the same phone before writing anything', async () => {
      h.state.openSeriesForPhone = true;
      const res = await book({ everyDays: 14, end: { type: 'never' } });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SERIES_EXISTS');
      expect(h.state.inserts).toBe(0);
      expect(h.findOrCreateCustomer).not.toHaveBeenCalled();
    });

    it('is refused when the store has switched repeating bookings off', async () => {
      BIZ.recurring_enabled = false;
      const res = await book({ everyDays: 14, end: { type: 'never' } });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RECURRING_DISABLED');
      expect(h.state.inserts).toBe(0);
    });

    it('validates the rule at the edge and again with the dates in hand', async () => {
      expect((await book({ everyDays: 3, end: { type: 'never' } })).status).toBe(400);
      expect((await book({ everyDays: 14, end: { type: 'count', count: 1 } })).status).toBe(400);
      expect((await book({ everyDays: 14, end: { type: 'sometime' } })).status).toBe(400);
      // An end before the second visit is a single booking, not a series.
      const short = await book({ everyDays: 14, end: { type: 'until', date: '2026-10-10' } });
      expect(short.status).toBe(400);
      expect(short.body.error.message).toMatch(/two visits/);
      expect(h.state.inserts).toBe(0);
    });

    it('leaves a one-off booking exactly as it was', async () => {
      const res = await book(null);
      expect(res.status).toBe(201);
      expect(res.body.series).toBeUndefined();
      expect(h.state.series).toBeNull();
    });
  });

  describe('preview', () => {
    it('judges dates in the horizon fully and later ones by opening day only', async () => {
      const res = await request(await app())
        .post('/api/v1/public/businesses/sharp-cuts/series-preview')
        .send({ serviceIds: [HAIRCUT], preferredStaffId: LISA, slotStart: ist('2026-10-03', '11:00'), repeat: { everyDays: 8, end: { type: 'count', count: 6 } } });
      expect(res.status).toBe(200);
      expect(res.body.dates.map((d: Row) => [d.date, d.status])).toEqual([
        ['2026-10-03', 'ok'],
        ['2026-10-11', 'closed'], // Sunday
        ['2026-10-19', 'ok'],
        ['2026-10-27', 'later'], // past the horizon (20 Oct): booked about three weeks ahead
        ['2026-11-04', 'later'],
        ['2026-11-12', 'later'],
      ]);
      expect(res.body.totalVisits).toBe(6);
      expect(res.body.lastDate).toBe('2026-11-12');
      expect(h.state.inserts).toBe(0);
    });
  });

  describe('managing a series with its token', () => {
    it('answers 404 to a missing, malformed or unknown token — never touching the series', async () => {
      await book({ everyDays: 14, end: { type: 'never' } });
      const a = await app();
      expect((await request(a).get('/api/v1/public/series')).status).toBe(404);
      expect((await request(a).get('/api/v1/public/series').set('x-series-token', 'short')).status).toBe(404);
      expect((await request(a).get('/api/v1/public/series').set('x-series-token', 'A'.repeat(16))).status).toBe(404);
      expect((await request(a).post('/api/v1/public/series/cancel').set('x-series-token', 'A'.repeat(16))).status).toBe(404);
      const ok = await request(a).get('/api/v1/public/series').set('x-series-token', h.state.series!.manage_token);
      expect(ok.status).toBe(200);
      expect(ok.body.everyDays).toBe(14);
      expect(ok.body.store.phoneFull).toBe('919399385943');
    });
  });

  describe('the hourly job', () => {
    async function seriesBookedFortnightly() {
      // Fortnightly from Sat 3 Oct: at booking (30 Sep, horizon 20 Oct) only 3 Oct and 17 Oct exist.
      const res = await book({ everyDays: 14, end: { type: 'never' } });
      expect(res.body.series.visits).toHaveLength(2);
      h.sendBookingConfirmation.mockClear();
      h.state.created = [];
    }

    it('books the next date the day the horizon reaches it, and texts the confirmation', async () => {
      await seriesBookedFortnightly();
      const { recurringSweep } = await import('../../src/modules/appointments/series.service');
      // 31 Oct is today+20 on Sun 11 Oct, not before.
      await recurringSweep(new Date(ist('2026-10-10', '12:00')));
      expect(h.state.created).toHaveLength(0);
      await recurringSweep(new Date(ist('2026-10-11', '12:00')));
      expect(h.state.created.map((r) => r.occurrence_date)).toEqual(['2026-10-31']);
      expect(h.sendBookingConfirmation).toHaveBeenCalledWith('b-1', 'visit-2026-10-31');
      // A second run the same day books nothing more.
      await recurringSweep(new Date(ist('2026-10-11', '13:00')));
      expect(h.state.created).toHaveLength(1);
    });

    it('flags a clash to the owner instead of moving the visit, and sends no text for it', async () => {
      await seriesBookedFortnightly();
      h.state.bookings = [{ scheduled_start_at: ist('2026-10-31', '11:00'), scheduled_end_at: ist('2026-10-31', '11:30'), staff_id: LISA }];
      const { recurringSweep } = await import('../../src/modules/appointments/series.service');
      await recurringSweep(new Date(ist('2026-10-11', '12:00')));
      expect(h.state.created).toHaveLength(0);
      expect(h.state.issues).toEqual([{ date: '2026-10-31', reason: 'slot_taken' }]);
      expect(h.sendBookingConfirmation).not.toHaveBeenCalled();
      // The cursor still moves on: the series carries on with 14 Nov.
      expect(h.state.series!.generated_through).toBe('2026-10-31');
    });

    it('keeps a series active until its LAST visit has passed, not just been booked', async () => {
      // Regression (smoke-recurring.mjs, 2026-10-03): "weekly × 3" fits inside the horizon, so all
      // three visits are booked at once — and the series was marked ended right then. It vanished
      // from Regulars, could not be paused, and the same phone could open a second series while
      // two of its visits were still ahead.
      const res = await book({ everyDays: 7, end: { type: 'count', count: 3 } });
      expect(res.body.series.visits).toHaveLength(3);
      expect(h.state.series!.status).toBe('active');

      const { recurringSweep } = await import('../../src/modules/appointments/series.service');
      await recurringSweep(new Date(ist('2026-10-17', '09:00'))); // the last visit is today, still ahead
      expect(h.state.series!.status).toBe('active');
      await recurringSweep(new Date(ist('2026-10-18', '09:00'))); // the day after the last visit
      expect(h.state.series!.status).toBe('ended');
    });

    it('pauses a series whose stylist has left, rather than quietly giving them to someone else', async () => {
      await seriesBookedFortnightly();
      h.state.activeStaff = [JOHN];
      const { recurringSweep } = await import('../../src/modules/appointments/series.service');
      await recurringSweep(new Date(ist('2026-10-11', '12:00')));
      expect(h.state.created).toHaveLength(0);
      expect(h.state.issues).toEqual([{ date: '2026-10-31', reason: 'stylist_unavailable' }]);
      expect(h.state.series!.status).toBe('paused');
    });
  });
});
