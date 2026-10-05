// Recurring appointments: the hourly job (recurringSweep) against a REAL migrated Postgres,
// driven through weeks of dates with an injected clock. See docs/recurring-appointments.md.
//
// WHY THIS IS NOT PART OF smoke-recurring.mjs
//   HTTP cannot move the clock, and the job's whole point is what happens on future days. The
//   router-level unit test (tests/unit/public-series.test.ts) covers the same rules against a
//   fake; this proves the real SQL — the partial unique index, the ON CONFLICT target, the
//   `date`/`time` casts, the cursor update and the advisory lock — on a real database.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate
//   DATABASE_URL=<throwaway> npx tsx scripts/smoke-recurring-sweep.ts
//
//   It needs a MIGRATED database (not seeded). It creates its own store far in the future (2030)
//   and deletes it at the end, so runs are independent and the seed tenant is untouched.
//   DATABASE_URL must be exported explicitly, and it refuses the database backend/.env points at
//   — that file holds the live preprod database. SMS is forced off.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (export a throwaway database; backend/.env is not used for this).');
  process.exit(2);
}
try {
  const dotenvUrl = readFileSync(join(__dirname, '..', '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DATABASE_URL='))
    ?.slice('DATABASE_URL='.length)
    .replace(/^["']|["']$/g, '');
  if (dotenvUrl && dotenvUrl === url) {
    console.error('Refusing: DATABASE_URL is the database backend/.env points at. Use a throwaway one.');
    process.exit(2);
  }
} catch {
  // No backend/.env — nothing to compare against.
}

// Set before the app's env module loads (dotenv never overrides a variable that is already set).
process.env.SMS_ENABLED = 'false';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
const placeholders: Record<string, string> = {
  S3_ENDPOINT: 'https://example.invalid',
  S3_ACCESS_KEY_ID: 'smoke',
  S3_SECRET_ACCESS_KEY: 'smoke',
  S3_BUCKET: 'smoke',
  JWT_ACCESS_SECRET: 'smoke-access-secret-xxxx',
  JWT_REFRESH_SECRET: 'smoke-refresh-secret-xxxx',
  CUSTOMER_TOKEN_SECRET: 'smoke-customer-secret-xxxx',
  TICKET_URL_HMAC_SECRET: 'smoke-ticket-secret-xxxxx',
};
for (const [k, v] of Object.entries(placeholders)) process.env[k] = process.env[k] ?? v;

let pass = 0;
let fail = 0;
const ok = (c: unknown, m: string) => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); }
};

async function main() {
  const { pool } = await import('../src/db/pool');
  const { recurringSweep } = await import('../src/modules/appointments/series.service');
  const { addDays, occurrenceStart } = await import('../src/lib/recurrence');
  const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

  // A Saturday in March 2030 as the first visit. Everything is relative to it.
  let S = '2030-03-01';
  while (new Date(`${S}T12:00:00Z`).getUTCDay() !== 6) S = addDays(S, 1);
  const TZ = 'Asia/Kolkata';
  /** The job's clock: noon on the given day, store time. */
  const at = (date: string) => occurrenceStart(date, '12:00', TZ);
  const elevenOn = (date: string) => occurrenceStart(date, '11:00', TZ).toISOString();

  const slug = `smoke-recurring-${Date.now()}`;
  const [{ id: biz }] = await q(
    `insert into business (slug, name, category, timezone) values ($1, 'Recurring Smoke', 'Salon & Barber', $2) returning id`,
    [slug, TZ],
  );
  try {
    // Mon–Sat 10:00–20:00, Sunday closed.
    for (let d = 0; d <= 6; d += 1) {
      await q(
        `insert into business_hour (business_id, day_of_week, opens_at, closes_at, is_closed) values ($1, $2, '10:00', '20:00', $3)`,
        [biz, d, d === 0],
      );
    }
    const [{ id: lisa }] = await q(`insert into staff (business_id, name) values ($1, 'Lisa') returning id`, [biz]);
    const [{ id: john }] = await q(`insert into staff (business_id, name) values ($1, 'John') returning id`, [biz]);
    const [{ id: haircut }] = await q(
      `insert into service (business_id, name, duration_minutes, price_paise) values ($1, 'Haircut', 30, 35000) returning id`,
      [biz],
    );

    let n = 0;
    const series = async (opts: { staff: string | null; every: number; endType?: string; endCount?: number | null; phone: string }) => {
      const [{ id }] = await q(
        `insert into appointment_series
           (business_id, customer_name, customer_phone, staff_id, staff_locked, start_time, anchor_date, interval_days,
            end_type, end_count, generated_through, manage_token)
         values ($1, 'Smoke Regular', $2, $3, $4, '11:00', $5::date, $6, $7, $8, $5::date, $9)
         returning id`,
        [biz, opts.phone, opts.staff, !!opts.staff, S, opts.every, opts.endType ?? 'never', opts.endCount ?? null, `smoketoken${String(++n).padStart(6, '0')}`],
      );
      await q(`insert into appointment_series_service (series_id, service_id, name, position) values ($1, $2, 'Haircut', 0)`, [id, haircut]);
      return id as string;
    };
    const visits = async (seriesId: string) =>
      q(
        `select occurrence_date::text as d, status, cancel_reason, staff_id, scheduled_start_at
           from appointment where series_id = $1 order by occurrence_date`,
        [seriesId],
      );
    const cursor = async (seriesId: string) =>
      (await q(`select generated_through::text as g, status, pause_reason from appointment_series where id = $1`, [seriesId]))[0];
    const issues = async (seriesId: string) =>
      q(`select occurrence_date::text as d, reason from appointment_series_issue where series_id = $1 order by occurrence_date`, [seriesId]);
    const sweep = (date: string) => recurringSweep(at(date), { businessId: biz });

    console.log('FORTNIGHTLY WITH LISA');
    const fortnight = await series({ staff: lisa, every: 14, phone: '+919000000001' });
    await sweep(addDays(S, 14 - 21)); // the day before the horizon reaches S+14
    ok((await visits(fortnight)).length === 0, `S+14 is not booked 21 days ahead`);
    await sweep(addDays(S, 14 - 20));
    let v = await visits(fortnight);
    ok(v.length === 1 && v[0].d === addDays(S, 14), `S+14 is booked exactly 20 days ahead`);
    ok(v[0]?.status === 'confirmed' && v[0]?.staff_id === lisa, 'confirmed, with Lisa');
    ok(new Date(v[0]?.scheduled_start_at).toISOString() === elevenOn(addDays(S, 14)), 'at 11:00 store time');
    const [{ c: itemised }] = await q(
      `select count(*)::int as c from appointment_service s join appointment a on a.id = s.appointment_id where a.series_id = $1`,
      [fortnight],
    );
    ok(itemised === 1, 'its service row is written (check-in re-attaches from it)');
    ok((await cursor(fortnight)).g === addDays(S, 14), 'the cursor moved to S+14');

    console.log('IDEMPOTENT');
    await sweep(addDays(S, 14 - 20));
    ok((await visits(fortnight)).length === 1, 'a second run the same day books nothing');
    await Promise.all([sweep(addDays(S, 28 - 20)), sweep(addDays(S, 28 - 20))]);
    v = await visits(fortnight);
    ok(v.filter((x: any) => x.d === addDays(S, 28)).length === 1, 'two overlapping runs book S+28 once');

    console.log('A SKIPPED DATE NEVER COMES BACK');
    await q(`update appointment set status = 'cancelled', cancel_reason = 'skipped' where series_id = $1 and occurrence_date = $2::date`, [
      fortnight,
      addDays(S, 28),
    ]);
    // Even if the cursor were wound back, the unique (series, version, date) index refuses it.
    await q(`update appointment_series set generated_through = $2::date where id = $1`, [fortnight, addDays(S, 14)]);
    await sweep(addDays(S, 28 - 20));
    v = await visits(fortnight);
    const s28 = v.filter((x: any) => x.d === addDays(S, 28));
    ok(s28.length === 1 && s28[0].cancel_reason === 'skipped', 'S+28 stays skipped — not re-booked');

    console.log('A CLASH GOES TO THE OWNER, NOT TO ANOTHER TIME');
    await q(
      `insert into appointment (business_id, customer_name, staff_id, scheduled_start_at, scheduled_end_at, status, source)
       values ($1, 'Someone Else', $2, $3, $4, 'confirmed', 'owner')`,
      [biz, lisa, elevenOn(addDays(S, 42)), new Date(new Date(elevenOn(addDays(S, 42))).getTime() + 30 * 60_000).toISOString()],
    );
    await sweep(addDays(S, 42 - 20));
    v = await visits(fortnight);
    ok(!v.some((x: any) => x.d === addDays(S, 42)), 'S+42 is not booked on top of the clash');
    ok((await issues(fortnight)).some((i: any) => i.d === addDays(S, 42) && i.reason === 'slot_taken'), 'it is on Needs attention as slot_taken');
    ok((await cursor(fortnight)).g === addDays(S, 42), 'and the series carries on past it');

    console.log('A STYLIST WHO LEAVES PAUSES THE SERIES');
    await q(`update staff set is_active = false where id = $1`, [lisa]);
    await sweep(addDays(S, 56 - 20));
    const c = await cursor(fortnight);
    ok(c.status === 'paused' && c.pause_reason === 'stylist_unavailable', 'paused, reason stylist_unavailable');
    ok((await issues(fortnight)).some((i: any) => i.d === addDays(S, 56) && i.reason === 'stylist_unavailable'), 'and flagged');
    await sweep(addDays(S, 70 - 20));
    ok(!(await visits(fortnight)).some((x: any) => x.d >= addDays(S, 56)), 'nothing is booked while paused');
    await q(`update staff set is_active = true where id = $1`, [lisa]);

    console.log('A CLOSED DAY IS SKIPPED SILENTLY');
    const eightly = await series({ staff: john, every: 8, phone: '+919000000002' }); // S+8 is a Sunday
    await sweep(addDays(S, 16 - 20));
    const e = await visits(eightly);
    ok(!e.some((x: any) => x.d === addDays(S, 8)), 'Sunday S+8 is not booked');
    ok(e.some((x: any) => x.d === addDays(S, 16)), 'Monday S+16 is');
    ok((await issues(eightly)).length === 0, 'and nothing is flagged for the closed day');

    console.log('"AFTER 2 VISITS" ENDS THE SERIES');
    const twice = await series({ staff: null, every: 21, endType: 'count', endCount: 2, phone: '+919000000003' });
    await sweep(addDays(S, 21 - 20));
    ok((await visits(twice)).length === 1, 'the second (last) visit is booked');
    // Not ended yet: its last visit is still ahead, so it stays in Regulars and blocks a second
    // series for the same phone (the bug smoke-recurring.mjs caught on 2026-10-03).
    ok((await cursor(twice)).status === 'active', 'still active while its last visit is ahead');
    await sweep(addDays(S, 22));
    ok((await cursor(twice)).status === 'ended', 'ended the day after the last visit');
    ok((await visits(twice)).length === 1, 'nothing after the end');

    console.log('ONE OPEN SERIES PER PHONE (DATABASE BACKSTOP)');
    let refused = false;
    try {
      await series({ staff: john, every: 14, phone: '+919000000002' });
    } catch (err: any) {
      refused = err?.code === '23505';
    }
    ok(refused, 'a second open series for the same phone violates uq_appointment_series_open_phone');
  } finally {
    await q('delete from business where id = $1', [biz]);
  }
  try {
    await phase2(q, S, TZ);
  } finally {
    await pool.end();
  }
}

/**
 * Phase 2 — moving a visit, changing all future visits, booking a Needs-attention date — against
 * real SQL, in a store of its own. The invariant checked after every step: at most ONE live row
 * (not replaced by a change) per (series, date), whatever happened before.
 */
async function phase2(q: (sql: string, params?: unknown[]) => Promise<any[]>, S: string, TZ: string) {
  const series = await import('../src/modules/appointments/series.service');
  const { rescheduleByOwner } = await import('../src/modules/appointments/reschedule.service');
  const { addDays, occurrenceStart } = await import('../src/lib/recurrence');
  /** The job's / editor's clock: 09:00 store time on that day. */
  const at = (date: string) => occurrenceStart(date, '09:00', TZ);
  const iso = (date: string, hhmm: string) => occurrenceStart(date, hhmm, TZ).toISOString();
  const D = (n: number) => addDays(S, n);

  const [{ id: biz }] = await q(
    `insert into business (slug, name, category, timezone) values ($1, 'Recurring Edit Smoke', 'Salon & Barber', $2) returning id`,
    [`smoke-recurring-edit-${Date.now()}`, TZ],
  );
  try {
    for (let d = 0; d <= 6; d += 1) {
      await q(
        `insert into business_hour (business_id, day_of_week, opens_at, closes_at, is_closed) values ($1, $2, '10:00', '20:00', $3)`,
        [biz, d, d === 0],
      );
    }
    const [{ id: lisa }] = await q(`insert into staff (business_id, name) values ($1, 'Lisa') returning id`, [biz]);
    const [{ id: john }] = await q(`insert into staff (business_id, name) values ($1, 'John') returning id`, [biz]);
    const [{ id: haircut }] = await q(
      `insert into service (business_id, name, duration_minutes, price_paise) values ($1, 'Haircut', 30, 35000) returning id`,
      [biz],
    );

    let n = 0;
    const mk = async (o: { every: number; staff: string; phone: string; endType?: string; endCount?: number }) => {
      const [{ id }] = await q(
        `insert into appointment_series
           (business_id, customer_name, customer_phone, staff_id, staff_locked, start_time, anchor_date, interval_days,
            end_type, end_count, generated_through, manage_token)
         values ($1, 'Edit Regular', $2, $3, true, '11:00', $4::date, $5, $6, $7, $4::date, $8)
         returning id`,
        [biz, o.phone, o.staff, S, o.every, o.endType ?? 'never', o.endCount ?? null, `edittoken${String(++n).padStart(7, '0')}`],
      );
      await q(`insert into appointment_series_service (series_id, service_id, name, position) values ($1, $2, 'Haircut', 0)`, [id, haircut]);
      return id as string;
    };
    const oneOff = async (staff: string, date: string, hhmm: string) => {
      const [{ id }] = await q(
        `insert into appointment (business_id, customer_name, staff_id, scheduled_start_at, scheduled_end_at, status, source)
         values ($1, 'One-off', $2, $3, $4, 'confirmed', 'owner') returning id`,
        [biz, staff, iso(date, hhmm), new Date(new Date(iso(date, hhmm)).getTime() + 30 * 60_000).toISOString()],
      );
      return id as string;
    };
    const rows = async (sid: string) =>
      q(
        `select id, occurrence_date::text as d, status, cancel_reason, rescheduled_at, staff_id, scheduled_start_at, series_version
           from appointment where series_id = $1 order by occurrence_date, created_at`,
        [sid],
      );
    const live = (rs: any[]) => rs.filter((r) => r.cancel_reason !== 'superseded');
    const startOf = (r: any) => new Date(r.scheduled_start_at).toISOString();
    const noDupes = async (sid: string) =>
      (await q(
        `select occurrence_date from appointment where series_id = $1 and cancel_reason is distinct from 'superseded'
          group by 1 having count(*) > 1`,
        [sid],
      )).length === 0;
    const sweep = (date: string) => series.recurringSweep(at(date), { businessId: biz });
    const errCode = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return null;
      } catch (e: any) {
        return e?.code ?? 'ERR';
      }
    };

    console.log('PHASE 2 — A SKIP SURVIVES A CHANGE OF TIME');
    const A = await mk({ every: 14, staff: lisa, phone: '+919100000001' });
    await sweep(D(8)); // horizon S+28 → S+14 and S+28 booked
    ok(live(await rows(A)).map((x) => x.d).join() === [D(14), D(28)].join(), 'S+14 and S+28 booked');
    await q(`update appointment set status = 'cancelled', cancel_reason = 'skipped' where series_id = $1 and occurrence_date = $2::date`, [A, D(28)]);
    const change1 = { fromDate: D(14), slotStart: iso(D(14), '12:00') };
    const preview = await series.previewChangeByOwner(biz, A, change1, at(D(9)));
    ok(preview.dates.find((d) => d.date === D(28))?.status === 'skipped', 'preview: S+28 stays skipped');
    ok(preview.conflicts.length === 0, 'preview: nothing to resolve');
    await series.changeSeriesByOwner(biz, A, change1, null, at(D(9)));
    let r = await rows(A);
    const s14 = live(r).filter((x) => x.d === D(14));
    ok(s14.length === 1 && startOf(s14[0]) === iso(D(14), '12:00') && s14[0].series_version === 2, 'S+14 re-booked at 12:00 under version 2');
    ok(r.some((x) => x.d === D(14) && x.cancel_reason === 'superseded'), 'the old S+14 visit is superseded, not deleted');
    const s28 = live(r).filter((x) => x.d === D(28));
    ok(s28.length === 1 && s28[0].cancel_reason === 'skipped', 'S+28 is still skipped — the new version did not re-book it');
    ok(await noDupes(A), 'invariant: one live row per date');

    console.log('PHASE 2 — A VISIT MOVED BY HAND KEEPS ITS TIME THROUGH A CHANGE');
    await sweep(D(23)); // horizon S+43 → S+42 at the new 12:00
    const v42 = live(await rows(A)).find((x) => x.d === D(42));
    ok(!!v42 && startOf(v42) === iso(D(42), '12:00'), 'S+42 booked at the new 12:00');
    await rescheduleByOwner(biz, v42.id, { slotStart: iso(D(42), '15:00') }, null, at(D(23)));
    const keptPreview = await series.previewChangeByOwner(biz, A, { fromDate: D(42), staffId: john }, at(D(23)));
    ok(keptPreview.dates.find((d) => d.date === D(42))?.status === 'kept', 'preview: the moved visit is kept');
    await series.changeSeriesByOwner(biz, A, { fromDate: D(42), staffId: john }, null, at(D(23)));
    const k42 = live(await rows(A)).filter((x) => x.d === D(42));
    ok(k42.length === 1 && !!k42[0].rescheduled_at && k42[0].staff_id === lisa && startOf(k42[0]) === iso(D(42), '15:00'),
      'the moved S+42 visit kept 15:00 with Lisa');
    const [a3] = await q('select version, staff_id from appointment_series where id = $1', [A]);
    ok(a3.version === 3 && a3.staff_id === john, 'the series now runs with John (version 3)');
    await sweep(D(37)); // horizon S+57 → S+56
    ok(live(await rows(A)).find((x) => x.d === D(56))?.staff_id === john, 'the next date is booked with John');
    ok(await noDupes(A), 'invariant holds');

    console.log('PHASE 2 — A TAKEN DATE NEEDS A CHOICE; NOTHING IS WRITTEN UNTIL IT HAS ONE');
    const B = await mk({ every: 14, staff: lisa, phone: '+919100000002' });
    await sweep(D(8)); // S+14 and S+28 at 11:00
    await oneOff(lisa, D(28), '13:00'); // someone else holds Lisa at 13:00 on S+28
    const change2 = { fromDate: D(14), slotStart: iso(D(14), '13:00') };
    ok((await errCode(() => series.changeSeriesByOwner(biz, B, change2, null, at(D(9))))) === 'CHANGE_CONFLICTS', '409 CHANGE_CONFLICTS');
    const [b1] = await q('select version from appointment_series where id = $1', [B]);
    ok(b1.version === 1 && !(await rows(B)).some((x) => x.cancel_reason === 'superseded'), 'nothing written: still version 1, no visit replaced');
    await series.changeSeriesByOwner(
      biz,
      B,
      { ...change2, resolutions: [{ date: D(28), slotStart: iso(D(28), '16:00') }] },
      null,
      at(D(9)),
    );
    r = live(await rows(B));
    ok(startOf(r.find((x) => x.d === D(14))) === iso(D(14), '13:00'), 'S+14 at the new 13:00');
    const b28 = r.find((x) => x.d === D(28));
    ok(!!b28 && startOf(b28) === iso(D(28), '16:00') && !!b28.rescheduled_at, 'S+28 at the chosen 16:00, marked as moved');
    ok(await noDupes(B), 'invariant holds');

    console.log('PHASE 2 — "AFTER 4 VISITS" STILL ENDS AT 4 AFTER A CHANGE');
    const C = await mk({ every: 14, staff: john, phone: '+919100000003', endType: 'count', endCount: 4 });
    await q(
      `insert into appointment (business_id, customer_name, staff_id, scheduled_start_at, scheduled_end_at, status, source,
         series_id, series_version, occurrence_date)
       values ($1, 'Edit Regular', $2, $3, $4, 'confirmed', 'online', $5, 1, $6::date)`,
      [biz, john, iso(S, '11:00'), new Date(new Date(iso(S, '11:00')).getTime() + 30 * 60_000).toISOString(), C, S],
    );
    await sweep(D(8));
    await series.changeSeriesByOwner(biz, C, { fromDate: D(14), slotStart: iso(D(14), '14:00') }, null, at(D(9)));
    await sweep(D(30));
    await sweep(D(60));
    const cv = live(await rows(C)).filter((x) => x.status !== 'cancelled');
    ok(cv.map((x) => x.d).join() === [S, D(14), D(28), D(42)].join(), `4 visits in total (got ${cv.length})`);
    const [c1] = await q('select status, anchor_index from appointment_series where id = $1', [C]);
    ok(c1.status === 'ended' && c1.anchor_index === 1, 'ended after the 4th, with anchor_index 1');

    console.log('PHASE 2 — BOOK ANOTHER TIME');
    const E = await mk({ every: 14, staff: lisa, phone: '+919100000004' });
    await oneOff(lisa, D(14), '11:00'); // the clash the job will flag
    await sweep(D(8));
    const [issue] = await q(
      `select id, occurrence_date::text as d from appointment_series_issue where series_id = $1 and resolved_at is null`,
      [E],
    );
    ok(issue?.d === D(14), 'the clash is on Needs attention');
    await series.bookIssue(biz, issue.id, { slotStart: iso(D(14), '17:00') }, null as unknown as string, null, at(D(9)));
    const e14 = live(await rows(E)).find((x) => x.d === D(14));
    ok(!!e14 && startOf(e14) === iso(D(14), '17:00') && !!e14.rescheduled_at && e14.series_version === 1,
      'booked at 17:00, under the issue’s version, marked as moved');
    const [res] = await q('select resolution from appointment_series_issue where id = $1', [issue.id]);
    ok(res.resolution === 'booked', 'the issue is closed as booked');
    ok((await errCode(() => series.bookIssue(biz, issue.id, { slotStart: iso(D(14), '18:00') }, null as unknown as string, null, at(D(9)))))
      === 'INVALID_STATE_TRANSITION', 'booking it twice is refused');
    ok(await noDupes(E), 'invariant holds');

    console.log('PHASE 2 — TWO MOVES INTO ONE SLOT: EXACTLY ONE WINS');
    const o1 = await oneOff(john, D(4), '10:00');
    const o2 = await oneOff(john, D(4), '11:00');
    const both = await Promise.allSettled([
      rescheduleByOwner(biz, o1, { slotStart: iso(D(4), '15:00') }, null, at(D(1))),
      rescheduleByOwner(biz, o2, { slotStart: iso(D(4), '15:00') }, null, at(D(1))),
    ]);
    ok(both.filter((x) => x.status === 'fulfilled').length === 1, 'exactly one of two simultaneous moves wins');

    console.log('PHASE 2 — A CHANGE AND THE HOURLY JOB AT THE SAME TIME');
    const F = await mk({ every: 7, staff: john, phone: '+919100000005' });
    await sweep(D(1)); // S+7, S+14, S+21
    await Promise.allSettled([
      series.changeSeriesByOwner(biz, F, { fromDate: D(7), slotStart: iso(D(7), '10:30') }, null, at(D(2))),
      series.recurringSweep(at(D(5)), { businessId: biz }),
    ]);
    ok(await noDupes(F), 'one live row per date, whichever ran first');
  } finally {
    await q('delete from business where id = $1', [biz]);
  }
}

main()
  .catch((e) => {
    fail++;
    console.error('  ✗ CRASH:', e);
  })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
