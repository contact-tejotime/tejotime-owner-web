import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Recurring appointments, Phase 2 — moving a visit and changing all future visits — through the
 * real owner and public routers, guards, validators and services, with Postgres replaced by a small
 * in-memory fake. No database, no server. The real-SQL run is backend/scripts/smoke-recurring-edit.mjs
 * and smoke-recurring-sweep.ts.
 *
 * Pins the guards that keep this safe:
 *  - a customer reaches only their own series' visits (token), and only today … today+20;
 *  - a customer moving a booking by its appointment key (My appointments) gets the same range and
 *    guards, for a one-off or a single series visit;
 *  - an owner reaches up to today+60, and never onto a regular's not-yet-booked series date;
 *  - a staff login cannot hand a booking to another chair;
 *  - a change whose new time is taken on a date is refused (409 CHANGE_CONFLICTS) until that date
 *    has a choice — and nothing is written before then;
 *  - none of it sends a text (client rule: only the three registered SMS).
 */

const BIZ = { id: 'b-1', slug: 'sharp-cuts', timezone: 'Asia/Kolkata', category: 'Salon & Barber', is_active: true };
const LISA = '7547f6a4-e4d3-4bee-9ea0-a1d57a2a27d3';
const JOHN = '341ea088-f635-445b-8ade-631c4db9a705';
const SERIES = '5e5e5e5e-1111-4222-8333-444444444444';
const OTHER_SERIES = '6f6f6f6f-1111-4222-8333-444444444444';
const ONEOFF = 'a1a1a1a1-1111-4222-8333-444444444444';
const V1 = 'b1b1b1b1-1111-4222-8333-444444444444';
const V2 = 'b2b2b2b2-1111-4222-8333-444444444444';
const OV1 = 'c1c1c1c1-1111-4222-8333-444444444444';
const BLOCKER = 'd1d1d1d1-1111-4222-8333-444444444444';
const TOKEN = 'TokenTokenToken1';
const OTHER_TOKEN = 'OtherOtherOther1';
const HAIRCUT = '6bcf8d7f-e177-455c-a43e-1f96bd7dd082';
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();
const plus30 = (iso: string) => new Date(new Date(iso).getTime() + 30 * 60_000).toISOString();

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  appts: [] as Row[],
  series: [] as Row[],
  writes: [] as string[],
  moveSql: [] as string[],
  staffPerms: [] as Row[],
  one: vi.fn(),
  many: vi.fn(),
  exec: vi.fn(),
  emitToOwners: vi.fn(),
  sendBookingConfirmation: vi.fn(),
}));

function appt(id: string, date: string, hhmm: string, over: Row = {}): Row {
  const start = ist(date, hhmm);
  return {
    id, business_id: 'b-1', customer_name: 'Riya', customer_phone: '+919876543210', service_name: 'Haircut',
    staff_id: LISA, scheduled_start_at: start, scheduled_end_at: plus30(start), status: 'confirmed',
    series_id: null, occurrence_date: null, rescheduled_at: null, cancel_reason: null, reminder_sent_at: null,
    sms_opt_in: true, ...over,
  };
}

function seriesRow(id: string, token: string, over: Row = {}): Row {
  return {
    id, business_id: 'b-1', customer_id: null, customer_name: 'Riya', customer_phone: '+919876543210',
    staff_id: LISA, staff_locked: true, visitor_type: null, start_time: '11:00', anchor_date: '2026-10-03',
    anchor_index: 0, interval_days: 14, end_type: 'never', end_count: null, end_date: null, status: 'active',
    pause_reason: null, version: 1, generated_through: '2026-10-17', sms_opt_in: true, review_sms_opt_in: false,
    source: 'online', manage_token: token, staff_name: 'Lisa', service_name: 'Haircut',
    business_name: 'Sharp Cuts', business_slug: 'sharp-cuts', business_phone: '919399385943', timezone: 'Asia/Kolkata',
    ...over,
  };
}

const open = (r: Row) => r.status === 'pending' || r.status === 'confirmed';

async function fake(sql: string, p: unknown[] = []): Promise<Row[]> {
  const S = (i: number) => p[i] as string;
  if (sql.includes('pg_advisory_xact_lock')) return [];
  // The appointment-key read (public.service appointmentForKey) — the key itself is checked before this.
  if (sql.includes('s.name as staff_name') && sql.includes('where a.id = $1')) {
    const names: Record<string, string> = { [LISA]: 'Lisa', [JOHN]: 'John' };
    return h.appts.filter((a) => a.id === S(0)).map((a) => ({ ...a, staff_name: names[a.staff_id] ?? null }));
  }
  if (sql.includes('select * from business where id')) return [BIZ];
  if (sql.includes('from user_permission')) return h.staffPerms;
  if (sql.includes('select staff_id from appointment where id')) return h.appts.filter((a) => a.id === S(0));
  if (sql.includes('select * from appointment where id = $1 and business_id = $2 and series_id = $3')) {
    return h.appts.filter((a) => a.id === S(0) && a.series_id === S(2));
  }
  if (sql.includes('select * from appointment where id = $1 and business_id = $2')) return h.appts.filter((a) => a.id === S(0));
  if (sql.includes('from business_hour')) {
    const day = (d: number) => ({ day_of_week: d, opens_at: '10:00:00', closes_at: '20:00:00', is_closed: d === 0 });
    return sql.includes('day_of_week = $2') ? [day(p[1] as number)] : [0, 1, 2, 3, 4, 5, 6].map(day);
  }
  if (sql.includes('select id from staff where business_id')) return [{ id: LISA }, { id: JOHN }];
  if (sql.includes('select id from staff where id = $1')) return [LISA, JOHN].includes(S(0)) ? [{ id: S(0) }] : [];
  if (sql.includes('select id, name from staff')) return [{ id: LISA, name: 'Lisa' }, { id: JOHN, name: 'John' }];
  if (sql.includes('make_interval')) {
    const ex = (p[4] as string[]) ?? [];
    return h.appts.filter((a) => open(a) && !ex.includes(a.id) && a.scheduled_start_at < S(2) && a.scheduled_end_at > S(1));
  }
  if (sql.includes('as staff_active')) {
    return h.series
      .filter((s) => s.status === 'active' && s.generated_through < S(1) && s.id !== p[2])
      .map((s) => ({ ...s, staff_active: true, minutes: 30 }));
  }
  if (sql.includes('set scheduled_start_at = $3')) {
    h.writes.push('move');
    h.moveSql.push(sql);
    const a = h.appts.find((x) => x.id === S(0) && open(x));
    if (!a) return [];
    Object.assign(a, { scheduled_start_at: S(2), scheduled_end_at: S(3), staff_id: p[4], rescheduled_at: S(5) });
    return [a];
  }
  if (sql.includes('where s.manage_token = $1')) return h.series.filter((s) => s.manage_token === S(0));
  if (sql.includes('from appointment_series s') && sql.includes('s.id = $1')) return h.series.filter((s) => s.id === S(0));
  if (sql.includes('from appointment_series_service ss')) {
    return [{ series_name: 'Haircut', id: HAIRCUT, name: 'Haircut', duration_minutes: 30, price_paise: 35000 }];
  }
  if (sql.includes('rescheduled_at is null and scheduled_start_at > $4')) {
    return h.appts.filter((a) => a.series_id === S(0) && open(a) && a.occurrence_date >= S(2) && !a.rescheduled_at && a.scheduled_start_at > S(3));
  }
  if (sql.includes('not (id = any($3::uuid[]))')) {
    const ex = (p[2] as string[]) ?? [];
    return h.appts
      .filter((a) => a.series_id === S(0) && a.occurrence_date >= S(1) && a.cancel_reason !== 'superseded' && !ex.includes(a.id))
      .map((a) => ({ d: a.occurrence_date, status: a.status, rescheduled_at: a.rescheduled_at }));
  }
  if (sql.includes("cancel_reason = 'superseded'")) {
    h.writes.push('supersede');
    return h.appts.filter((a) => (p[0] as string[]).includes(a.id)).map((a) => Object.assign(a, { status: 'cancelled', cancel_reason: 'superseded' }));
  }
  if (sql.includes('version = version + 1')) {
    h.writes.push('re-anchor');
    const s = h.series.find((x) => x.id === S(0))!;
    Object.assign(s, { version: s.version + 1, anchor_date: S(1), anchor_index: p[2], start_time: S(3), staff_id: p[4], staff_locked: p[5], generated_through: S(6) });
    return [];
  }
  if (sql.includes('update appointment_series')) {
    const s = h.series.find((x) => x.id === S(0));
    if (s && sql.includes('generated_through = $2')) s.generated_through = S(1);
    return [];
  }
  if (sql.includes('select distinct occurrence_date')) {
    return h.appts
      .filter((a) => a.series_id === S(0) && a.occurrence_date >= S(1) && a.occurrence_date <= S(2) && a.cancel_reason !== 'superseded')
      .map((a) => ({ d: a.occurrence_date }));
  }
  if (sql.includes('insert into appointment_service')) return [];
  if (sql.includes('insert into appointment')) {
    h.writes.push('insert');
    const row = appt(`new-${h.appts.length}`, '2000-01-01', '00:00', {
      staff_id: p[6], scheduled_start_at: S(7), scheduled_end_at: S(8), status: S(16), series_id: S(13),
      occurrence_date: S(15), rescheduled_at: p[17], cancel_reason: p[18],
    });
    h.appts.push(row);
    return [row];
  }
  if (sql.includes('update appointment_series_issue')) return [];
  if (sql.includes('rescheduled_at from appointment')) {
    return h.appts.filter((a) => a.series_id === S(0) && a.scheduled_start_at > new Date().toISOString() && a.cancel_reason !== 'superseded');
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

describe('recurring appointments — move a visit, change future visits', { timeout: 30_000 }, () => {
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
    await import('../../src/modules/appointments/appointments.routes');
  }, 60_000);

  beforeEach(() => {
    vi.resetModules();
    // Wed 30 Sep 2026, 16:30 IST: customers may move into 30 Sep … 20 Oct, owners into … 29 Nov.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T11:00:00.000Z'));
    process.env = testEnv();
    // A fortnightly regular with Lisa (3 Oct and 17 Oct booked; 31 Oct not yet), another customer's
    // series, and a one-off booking with Lisa on 1 Oct.
    h.series = [seriesRow(SERIES, TOKEN), seriesRow(OTHER_SERIES, OTHER_TOKEN, { staff_id: JOHN, start_time: '15:00' })];
    h.appts = [
      appt(V1, '2026-10-03', '11:00', { series_id: SERIES, occurrence_date: '2026-10-03' }),
      appt(V2, '2026-10-17', '11:00', { series_id: SERIES, occurrence_date: '2026-10-17' }),
      appt(OV1, '2026-10-03', '15:00', { series_id: OTHER_SERIES, occurrence_date: '2026-10-03', staff_id: JOHN }),
      appt(ONEOFF, '2026-10-01', '11:00'),
    ];
    h.writes = [];
    h.moveSql = [];
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
    const { publicRouter } = await import('../../src/modules/public/public.routes');
    const { appointmentsRouter } = await import('../../src/modules/appointments/appointments.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/public', publicRouter);
    a.use('/api/v1/appointments', appointmentsRouter);
    a.use(errorHandler);
    return a;
  }

  async function bearer(role: 'owner' | 'staff', staffId: string | null = null) {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    return `Bearer ${signAccessToken({ userId: 'u-1', businessId: 'b-1', role: role as any, plan: 'free' as any, staffId })}`;
  }

  describe('customer — their own series, today … today+20', () => {
    it('needs the token, and only reaches visits of that series', async () => {
      const a = await app();
      expect((await request(a).get('/api/v1/public/series/slots?date=2026-10-06')).status).toBe(404);
      const wrong = await request(a)
        .post(`/api/v1/public/series/visits/${V1}/reschedule`)
        .set('x-series-token', 'NotTheRightOne16')
        .send({ slotStart: ist('2026-10-06', '12:00') });
      expect(wrong.status).toBe(404);
      const foreign = await request(a)
        .post(`/api/v1/public/series/visits/${OV1}/reschedule`)
        .set('x-series-token', TOKEN)
        .send({ slotStart: ist('2026-10-06', '12:00') });
      expect(foreign.status).toBe(404);
      expect(h.writes).toEqual([]);
    });

    it('moves a visit inside the window, marks it moved, and sends no text', async () => {
      const res = await request(await app())
        .post(`/api/v1/public/series/visits/${V1}/reschedule`)
        .set('x-series-token', TOKEN)
        .send({ slotStart: ist('2026-10-06', '12:00') });
      expect(res.status).toBe(200);
      const moved = res.body.visits.find((v: Row) => v.appointmentId === V1);
      expect(moved.scheduledStartAt).toBe(ist('2026-10-06', '12:00'));
      expect(moved.moved).toBe(true);
      expect(h.sendBookingConfirmation).not.toHaveBeenCalled();
    });

    it('refuses today+21 — past the horizon, where regulars’ dates are not booked yet', async () => {
      const res = await request(await app())
        .post(`/api/v1/public/series/visits/${V1}/reschedule`)
        .set('x-series-token', TOKEN)
        .send({ slotStart: ist('2026-10-21', '12:00') });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(h.writes).toEqual([]);
    });

    it('offers the range on the slots answer as store-local days', async () => {
      const res = await request(await app())
        .get(`/api/v1/public/series/slots?date=2026-10-06&appointmentId=${V1}`)
        .set('x-series-token', TOKEN);
      expect(res.status).toBe(200);
      expect(res.body.today).toBe('2026-09-30');
      expect(res.body.lastDay).toBe('2026-10-20');
      expect(res.body.slots.length).toBeGreaterThan(0);
    });
  });

  describe('owner — any booking, up to today+60', () => {
    it('moves a one-off booking, and never onto a regular’s not-yet-booked date', async () => {
      const a = await app();
      const auth = await bearer('owner');
      // Sat 31 Oct 11:00 is the fortnightly regular's next date with Lisa — not booked yet (the job
      // books it on 11 Oct), but it is theirs.
      const onRegular = await request(a)
        .post(`/api/v1/appointments/${ONEOFF}/reschedule`)
        .set('authorization', auth)
        .send({ slotStart: ist('2026-10-31', '11:00') });
      expect(onRegular.status).toBe(409);
      // John is free then.
      const withJohn = await request(a)
        .post(`/api/v1/appointments/${ONEOFF}/reschedule`)
        .set('authorization', auth)
        .send({ slotStart: ist('2026-10-31', '11:00'), staffId: JOHN });
      expect(withJohn.status).toBe(200);
      expect(withJohn.body.staffId).toBe(JOHN);
      expect(withJohn.body.rescheduledAt).toBeTruthy();
      expect(h.sendBookingConfirmation).not.toHaveBeenCalled();
    });

    it('refuses today+61', async () => {
      const res = await request(await app())
        .post(`/api/v1/appointments/${ONEOFF}/reschedule`)
        .set('authorization', await bearer('owner'))
        .send({ slotStart: ist('2026-11-30', '12:00') });
      expect(res.status).toBe(409);
    });

    it('does not let a staff login hand a booking to another chair', async () => {
      h.staffPerms = [{ module: 'appointments', access: 'manage' }];
      const a = await app();
      const auth = await bearer('staff', LISA);
      const away = await request(a)
        .post(`/api/v1/appointments/${ONEOFF}/reschedule`)
        .set('authorization', auth)
        .send({ slotStart: ist('2026-10-02', '12:00'), staffId: JOHN });
      expect(away.status).toBe(403);
      expect(h.writes).toEqual([]);
      const own = await request(a)
        .post(`/api/v1/appointments/${ONEOFF}/reschedule`)
        .set('authorization', auth)
        .send({ slotStart: ist('2026-10-02', '12:00') });
      expect(own.status).toBe(200);
      expect(own.body.staffId).toBe(LISA);
    });
  });

  describe('change all future visits', () => {
    it('refuses a new time that is taken on a date until that date has a choice — writing nothing first', async () => {
      // Someone else holds Lisa at 10:00 on 17 Oct.
      h.appts.push(appt(BLOCKER, '2026-10-17', '10:00', { customer_name: 'Someone' }));
      const a = await app();
      const body = { fromDate: '2026-10-17', slotStart: ist('2026-10-17', '10:00') };
      const preview = await request(a).post('/api/v1/public/series/preview-change').set('x-series-token', TOKEN).send(body);
      expect(preview.status).toBe(200);
      expect(preview.body.conflicts).toEqual(['2026-10-17']);

      const refused = await request(a).post('/api/v1/public/series/change').set('x-series-token', TOKEN).send(body);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('CHANGE_CONFLICTS');
      expect(refused.body.error.details.map((d: Row) => d.rule)).toEqual(['2026-10-17']);
      expect(h.writes).toEqual([]);

      const skipped = await request(a)
        .post('/api/v1/public/series/change')
        .set('x-series-token', TOKEN)
        .send({ ...body, resolutions: [{ date: '2026-10-17', skip: true }] });
      expect(skipped.status).toBe(200);
      expect(h.writes).toEqual(['supersede', 're-anchor', 'insert']);
      const series = h.series.find((s) => s.id === SERIES)!;
      expect(series.version).toBe(2);
      expect(series.start_time).toBe('10:00');
      // 17 Oct is the rule's 2nd date (index 1): a count series would still end at its original total.
      expect(series.anchor_index).toBe(1);
      expect(h.appts.find((x) => x.id === V2)!.cancel_reason).toBe('superseded');
      expect(h.sendBookingConfirmation).not.toHaveBeenCalled();
    });

    it('reports a date past the horizon that already has a moved visit as kept, not "booked later"', async () => {
      // Regression (owner-web walk-through, 2026-10-03): the preview called every date past today+20
      // "Booked about 3 weeks ahead", even one already holding a visit booked at another time (here a
      // "Book another time" on 31 Oct) — which the change will in fact leave where it is.
      h.appts.push(
        appt('e1e1e1e1-1111-4222-8333-444444444444', '2026-10-31', '17:00', {
          series_id: SERIES,
          occurrence_date: '2026-10-31',
          rescheduled_at: '2026-09-30T10:00:00.000Z',
        }),
      );
      const res = await request(await app())
        .post('/api/v1/public/series/preview-change')
        .set('x-series-token', TOKEN)
        .send({ fromDate: '2026-10-17', staffId: JOHN });
      expect(res.status).toBe(200);
      expect(res.body.dates.find((d: Row) => d.date === '2026-10-31')?.status).toBe('kept');
    });

    it('will not start further out than the first date the job has not booked yet', async () => {
      // 14 Nov is two dates past the cursor (17 Oct): 31 Oct would be booked by neither rule.
      const res = await request(await app())
        .post('/api/v1/public/series/preview-change')
        .set('x-series-token', TOKEN)
        .send({ fromDate: '2026-11-14', staffId: JOHN });
      expect(res.status).toBe(400);
    });

    it('needs something to change', async () => {
      const res = await request(await app())
        .post('/api/v1/public/series/change')
        .set('x-series-token', TOKEN)
        .send({ fromDate: '2026-10-17' });
      expect(res.status).toBe(400);
    });
  });

  describe('customer — My appointments: move a booking by its appointment key', () => {
    const key = async (id: string) => (await import('../../src/modules/public/public.service')).appointmentKey(id);
    const move = async (id: string, body: Row, k?: string) =>
      request(await app())
        .post(`/api/v1/public/appointments/${id}/reschedule`)
        .send({ key: k ?? (await key(id)), ...body });

    it('a wrong key is a 404 and reads nothing', async () => {
      const res = await move(ONEOFF, { slotStart: ist('2026-10-06', '12:00') }, await key(V1));
      expect(res.status).toBe(404);
      const slots = await request(await app()).get(`/api/v1/public/appointments/${ONEOFF}/slots?date=2026-10-06`);
      expect(slots.status).toBe(404);
      expect(h.one).not.toHaveBeenCalled();
      expect(h.many).not.toHaveBeenCalled();
      expect(h.writes).toEqual([]);
    });

    it('moves a one-off inside today … today+20, re-arms its reminder, and sends no text', async () => {
      const res = await move(ONEOFF, { slotStart: ist('2026-10-06', '12:00') });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        appointmentId: ONEOFF,
        scheduledStartAt: ist('2026-10-06', '12:00'),
        staffId: LISA,
        staffName: 'Lisa',
        canChange: true,
      });
      expect(res.body.rescheduledAt).toBeTruthy();
      expect(h.moveSql[0]).toContain('reminder_sent_at = case');
      expect(h.emitToOwners).toHaveBeenCalledWith('b-1', 'appointment:updated', expect.anything());
      // A one-off has no series sheet to refresh.
      expect(h.emitToOwners).not.toHaveBeenCalledWith('b-1', 'series:updated', expect.anything());
      expect(h.sendBookingConfirmation).not.toHaveBeenCalled();
    });

    it('moves one visit of a series too, and tells the owner series sheet', async () => {
      const res = await move(V1, { slotStart: ist('2026-10-06', '12:00') });
      expect(res.status).toBe(200);
      expect(res.body.seriesId).toBe(SERIES);
      expect(h.emitToOwners).toHaveBeenCalledWith('b-1', 'series:updated', { seriesId: SERIES });
    });

    it('can change the stylist, but only to one of this store', async () => {
      const withJohn = await move(ONEOFF, { slotStart: ist('2026-10-06', '12:00'), staffId: JOHN });
      expect(withJohn.status).toBe(200);
      expect(withJohn.body).toMatchObject({ staffId: JOHN, staffName: 'John' });
      const foreign = await move(ONEOFF, {
        slotStart: ist('2026-10-07', '12:00'),
        staffId: '99999999-1111-4222-8333-444444444444',
      });
      expect(foreign.status).toBe(400);
    });

    it('refuses today+21 (409), and never onto another booking', async () => {
      const far = await move(ONEOFF, { slotStart: ist('2026-10-21', '12:00') });
      expect(far.status).toBe(409);
      expect(far.body.error.code).toBe('SLOT_UNAVAILABLE');
      // The other customer's series visit holds John at 15:00 on 3 Oct.
      const taken = await move(ONEOFF, { slotStart: ist('2026-10-03', '15:00'), staffId: JOHN });
      expect(taken.status).toBe(409);
      expect(h.writes).toEqual([]);
    });

    it('a checked-in booking, or one that has started, cannot move (422)', async () => {
      h.appts.find((a) => a.id === ONEOFF)!.status = 'checked_in';
      const checkedIn = await move(ONEOFF, { slotStart: ist('2026-10-06', '12:00') });
      expect(checkedIn.status).toBe(422);
      // 10:00 IST today, now 16:30 IST: it has started, so the customer can no longer move it.
      h.appts.push(appt('e1e1e1e1-1111-4222-8333-444444444444', '2026-09-30', '10:00'));
      const started = await move('e1e1e1e1-1111-4222-8333-444444444444', { slotStart: ist('2026-10-06', '12:00') });
      expect(started.status).toBe(422);
      expect(h.writes).toEqual([]);
    });

    it('offers today … today+20, and the booking does not block its own time', async () => {
      const res = await request(await app())
        .get(`/api/v1/public/appointments/${ONEOFF}/slots?date=2026-10-01`)
        .set('x-appointment-key', await key(ONEOFF));
      expect(res.status).toBe(200);
      expect(res.body.today).toBe('2026-09-30');
      expect(res.body.lastDay).toBe('2026-10-20');
      expect(res.body.slots.map((s: Row) => s.startAt)).toContain(ist('2026-10-01', '11:00'));
    });
  });
});
