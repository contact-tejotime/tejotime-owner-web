import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Due to come back" — `GET /customers/due` and `PUT|DELETE /customers/:id/followup` — through the
 * real router, guards, validators and service, with Postgres replaced by a small fake
 * (docs/customer-due-list.md). The list's SQL (store-local days, exclusions) runs for real in
 * backend/scripts/smoke-due-list-db.ts; here the fake returns its rows and the test pins what the
 * service does with them: the rules, the sections, hiding, the staff scope, the follow-up guards.
 *
 * The clock sits at 00:15 IST on 21 Oct — still 20 Oct in UTC — so every "today"/"tomorrow" here
 * proves the store's calendar is used, not the server's.
 */

const LISA = '7547f6a4-e4d3-4bee-9ea0-a1d57a2a27d3';
const JOHN = '341ea088-f635-445b-8ade-631c4db9a705';
const HAIRCUT = '6bcf8d7f-e177-455c-a43e-1f96bd7dd082';
const SPA = '7bcf8d7f-e177-455c-a43e-1f96bd7dd082';
const ENTRY = 'e0e0e0e0-1111-4222-8333-444444444444';
const cid = (n: number) => `c${n}c${n}c${n}c${n}-1111-4222-8333-444444444444`;
const NO_VISITS = cid(9);
const ZERO_SEAT = '00000000-0000-0000-0000-000000000000';

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  dueRows: [] as Row[],
  seats: [] as unknown[],
  upserts: [] as unknown[][],
  deletes: [] as unknown[][],
  staffPerms: [] as Row[],
  one: vi.fn(),
  many: vi.fn(),
  exec: vi.fn(),
  emitToOwners: vi.fn(),
}));

/** A row as the list query returns it. `days` are store-local visit days, oldest first. */
function dueRow(n: number, name: string, days: string[], over: Row = {}): Row {
  return {
    id: cid(n), name, phone: `+9198765432${n}0`, is_vip: false, visits_count: days.length, days,
    staff_id: LISA, staff_name: 'Lisa', staff_active: true, service_name: 'Haircut', queue_entry_id: null,
    outcome: null, snooze_until: null, about_last_visit: null, followup_updated_at: null, ...over,
  };
}

async function fake(sql: string, p: unknown[] = []): Promise<Row[]> {
  if (sql.includes('select timezone from business')) return [{ timezone: 'Asia/Kolkata' }];
  if (sql.includes('from user_permission')) return h.staffPerms;
  if (sql.includes('with visit_days as')) {
    h.seats.push(p[2]);
    const seat = p[2] as string | null;
    return h.dueRows.filter((r) => seat === null || r.staff_id === seat);
  }
  if (sql.includes('select id, service_id from queue_entry')) {
    return (p[1] as string[]).includes(ENTRY) ? [{ id: ENTRY, service_id: HAIRCUT }] : [];
  }
  if (sql.includes('from queue_entry_extra')) {
    return (p[1] as string[]).includes(ENTRY)
      ? [
          { queue_entry_id: ENTRY, label: 'Hair Spa' },
          { queue_entry_id: ENTRY, label: 'Head massage' },
        ]
      : [];
  }
  if (sql.includes('select id, name from service')) {
    return [
      { id: HAIRCUT, name: 'Haircut' },
      { id: SPA, name: 'Hair Spa' },
    ];
  }
  if (sql.includes('left join lateral')) {
    const id = p[0] as string;
    if (id === NO_VISITS) return [{ id, timezone: 'Asia/Kolkata', last_day: null, last_staff: null }];
    if (id === cid(1)) return [{ id, timezone: 'Asia/Kolkata', last_day: '2026-10-01', last_staff: LISA }];
    if (id === cid(2)) return [{ id, timezone: 'Asia/Kolkata', last_day: '2026-09-20', last_staff: JOHN }];
    return [];
  }
  if (sql.includes('insert into customer_followup')) {
    h.upserts.push(p);
    return [
      { outcome: p[2], snooze_until: p[3], about_last_visit: p[4], updated_at: new Date('2026-10-20T18:45:00Z') },
    ];
  }
  if (sql.includes('delete from customer_followup')) {
    h.deletes.push(p);
    return [];
  }
  throw new Error(`unexpected SQL: ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
}

vi.mock('../../src/db/pool', () => ({
  one: h.one,
  many: h.many,
  exec: h.exec,
  pool: { on: vi.fn() },
  transaction: vi.fn(),
}));
vi.mock('../../src/realtime/emitters', async (orig) => ({
  ...(await orig<typeof import('../../src/realtime/emitters')>()),
  emitToOwners: h.emitToOwners,
}));

describe('customers — the "Due to come back" call list', { timeout: 30_000 }, () => {
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

  beforeAll(async () => {
    process.env = testEnv();
    await import('../../src/modules/customers/customers.routes');
  }, 60_000);

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    // 00:15 IST on Wed 21 Oct 2026 = 18:45 UTC on 20 Oct.
    vi.setSystemTime(new Date('2026-10-20T18:45:00.000Z'));
    process.env = testEnv();
    h.dueRows = [
      // Every 20 days, last 1 Oct → expected 21 Oct: due soon. Its last visit had extras.
      dueRow(1, 'Asha', ['2026-08-22', '2026-09-11', '2026-10-01'], { queue_entry_id: ENTRY, service_name: 'Haircut + Hair Spa + Head massage' }),
      // Last 20 Sep, every 20 → overdue from 16 Oct. With John.
      dueRow(2, 'Bina', ['2026-08-11', '2026-08-31', '2026-09-20'], { staff_id: JOHN, staff_name: 'John' }),
      // Last 20 Aug, every 20 → not back for a while from 30 Sep.
      dueRow(3, 'Chitra', ['2026-07-11', '2026-07-31', '2026-08-20']),
      // Last 15 Oct: not yet (listed from 2 Nov).
      dueRow(4, 'Deepa', ['2026-09-05', '2026-09-25', '2026-10-15']),
      // Irregular: 10, 40, 22.
      dueRow(5, 'Esha', ['2026-07-01', '2026-07-11', '2026-08-20', '2026-09-11']),
      // Due soon but "not interested".
      dueRow(6, 'Farah', ['2026-08-22', '2026-09-11', '2026-10-01'], {
        outcome: 'not_interested', about_last_visit: '2026-10-01', followup_updated_at: new Date(),
      }),
      // Due soon but snoozed until tomorrow (22 Oct).
      dueRow(7, 'Gita', ['2026-08-22', '2026-09-11', '2026-10-01'], {
        outcome: 'no_answer', snooze_until: '2026-10-22', about_last_visit: '2026-10-01', followup_updated_at: new Date(),
      }),
      // A snooze about an older visit no longer hides them.
      dueRow(8, 'Hema', ['2026-08-22', '2026-09-11', '2026-10-01'], {
        outcome: 'call_later', snooze_until: '2026-11-30', about_last_visit: '2026-09-11', followup_updated_at: new Date(),
      }),
    ];
    h.seats = [];
    h.upserts = [];
    h.deletes = [];
    h.staffPerms = [];
    for (const f of [h.one, h.many, h.exec, h.emitToOwners]) f.mockReset();
    h.one.mockImplementation(async (sql: string, params: unknown[]) => (await fake(sql, params))[0] ?? null);
    h.many.mockImplementation(async (sql: string, params: unknown[]) => fake(sql, params));
    h.exec.mockImplementation(async (sql: string, params: unknown[]) => (await fake(sql, params)).length);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });
  afterAll(() => vi.restoreAllMocks());

  async function app() {
    const { customersRouter } = await import('../../src/modules/customers/customers.routes');
    const { errorHandler } = await import('../../src/middleware/error-handler');
    const { requestId } = await import('../../src/middleware/request-id');
    const a = express();
    a.use(express.json());
    a.use(requestId);
    a.use('/api/v1/customers', customersRouter);
    a.use(errorHandler);
    return a;
  }

  async function bearer(role: 'owner' | 'co_owner' | 'staff', staffId: string | null = null) {
    const { signAccessToken } = await import('../../src/modules/auth/token.service');
    return `Bearer ${signAccessToken({ userId: 'u-1', businessId: 'b-1', role: role as any, plan: 'free' as any, staffId })}`;
  }

  const getDue = async (auth?: string) =>
    request(await app())
      .get('/api/v1/customers/due')
      .set('authorization', auth ?? (await bearer('owner')));

  describe('GET /customers/due', () => {
    it('is its own route, not a 400 from /:id', async () => {
      const res = await getDue();
      expect(res.status).toBe(200);
    });

    it('lists regulars by section and call order, on the store’s calendar', async () => {
      const res = await getDue();
      expect(res.body.today).toBe('2026-10-21');
      expect(res.body.callBackRange).toEqual({ min: '2026-10-22', max: '2026-12-20' });
      expect(res.body.data.map((r: Row) => [r.name, r.status])).toEqual([
        ['Bina', 'overdue'],
        ['Asha', 'due_soon'],
        ['Hema', 'due_soon'],
        ['Chitra', 'lapsed'],
      ]);
      expect(res.body.counts).toEqual({ overdue: 1, dueSoon: 2, lapsed: 1, hidden: 2 });
      expect(res.body.hidden.map((r: Row) => [r.name, r.hiddenReason])).toEqual([
        ['Farah', 'not_interested'],
        ['Gita', 'snoozed'],
      ]);
      expect(h.seats).toEqual([null]);
    });

    it('describes each row for the screens', async () => {
      const asha = (await getDue()).body.data.find((r: Row) => r.name === 'Asha');
      expect(asha).toMatchObject({
        customerId: cid(1),
        usualDays: 20,
        bandMin: 15,
        bandMax: 25,
        lastVisitDate: '2026-10-01',
        daysSinceLast: 20,
        expectedDate: '2026-10-21',
        lastStaff: { id: LISA, name: 'Lisa', active: true },
        // Haircut (the entry's service) + Hair Spa (an extra named after a service); "Head massage"
        // is not a service, so the pre-fill is incomplete.
        serviceIds: [HAIRCUT, SPA],
        servicesResolved: false,
        followup: null,
      });
    });

    it('a co-owner sees the whole store too', async () => {
      const res = await getDue(await bearer('co_owner'));
      expect(res.body.data).toHaveLength(4);
    });

    it('a staff login with Customers access sees only customers last seen in its chair', async () => {
      h.staffPerms = [{ module: 'customers', access: 'view' }];
      const res = await getDue(await bearer('staff', LISA));
      expect(res.status).toBe(200);
      expect(res.body.data.map((r: Row) => r.name)).toEqual(['Asha', 'Hema', 'Chitra']);
      expect(h.seats).toEqual([LISA]);
    });

    it('a staff login with no chair sees nobody, and the default (no Customers access) is 403', async () => {
      h.staffPerms = [{ module: 'customers', access: 'view' }];
      const none = await getDue(await bearer('staff', null));
      expect(none.status).toBe(200);
      expect(h.seats).toEqual([ZERO_SEAT]);
      h.staffPerms = [];
      expect((await getDue(await bearer('staff', LISA))).status).toBe(403);
    });
  });

  describe('PUT /customers/:id/followup', () => {
    const put = async (id: string, body: Row, auth?: string) =>
      request(await app())
        .put(`/api/v1/customers/${id}/followup`)
        .set('authorization', auth ?? (await bearer('owner')))
        .send(body);

    it('"no answer" hides them until tomorrow — the store’s tomorrow', async () => {
      const res = await put(cid(1), { outcome: 'no_answer' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ outcome: 'no_answer', snoozeUntil: '2026-10-22', aboutLastVisit: '2026-10-01' });
      expect(h.upserts[0].slice(0, 6)).toEqual([cid(1), 'b-1', 'no_answer', '2026-10-22', '2026-10-01', 'u-1']);
      expect(h.emitToOwners).toHaveBeenCalledWith('b-1', 'customer:followup', { customerId: cid(1) });
    });

    it('"call back on" takes tomorrow … today+60 only', async () => {
      expect((await put(cid(1), { outcome: 'call_later', callBackOn: '2026-10-21' })).status).toBe(400);
      expect((await put(cid(1), { outcome: 'call_later', callBackOn: '2026-12-21' })).status).toBe(400);
      expect((await put(cid(1), { outcome: 'call_later', callBackOn: '2026-10-22' })).status).toBe(200);
      expect((await put(cid(1), { outcome: 'call_later', callBackOn: '2026-12-20' })).status).toBe(200);
      expect(h.upserts.map((u) => u[3])).toEqual(['2026-10-22', '2026-12-20']);
    });

    it('"not interested" has no day', async () => {
      const res = await put(cid(1), { outcome: 'not_interested' });
      expect(res.status).toBe(200);
      expect(res.body.snoozeUntil).toBeNull();
    });

    it.each([
      ['an unknown outcome', { outcome: 'maybe' }],
      ['call_later with no day', { outcome: 'call_later' }],
      ['a day on no_answer', { outcome: 'no_answer', callBackOn: '2026-10-25' }],
    ])('400 for %s', async (_l, body) => {
      expect((await put(cid(1), body)).status).toBe(400);
      expect(h.upserts).toHaveLength(0);
    });

    it('404 for a customer of another store, 422 for one with no visits', async () => {
      expect((await put(cid(7), { outcome: 'no_answer' })).status).toBe(404);
      expect((await put(NO_VISITS, { outcome: 'no_answer' })).status).toBe(422);
    });

    it('a staff login: only with Customers "manage", only its own chair’s customers', async () => {
      h.staffPerms = [{ module: 'customers', access: 'view' }];
      expect((await put(cid(1), { outcome: 'no_answer' }, await bearer('staff', LISA))).status).toBe(403);
      h.staffPerms = [{ module: 'customers', access: 'manage' }];
      // Bina's last visit was with John.
      expect((await put(cid(2), { outcome: 'no_answer' }, await bearer('staff', LISA))).status).toBe(404);
      expect((await put(cid(1), { outcome: 'no_answer' }, await bearer('staff', LISA))).status).toBe(200);
    });
  });

  describe('DELETE /customers/:id/followup', () => {
    it('undoes, and is safe to repeat', async () => {
      const a = await app();
      const auth = await bearer('owner');
      for (let i = 0; i < 2; i++) {
        const res = await request(a).delete(`/api/v1/customers/${cid(1)}/followup`).set('authorization', auth);
        expect(res.status).toBe(200);
      }
      expect(h.deletes).toEqual([
        [cid(1), 'b-1'],
        [cid(1), 'b-1'],
      ]);
    });
  });
});
