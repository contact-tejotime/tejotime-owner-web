// "Due to come back" against a REAL migrated Postgres, with an injected clock. See
// docs/customer-due-list.md.
//
// WHY THIS IS NOT AN HTTP SMOKE
//   A customer's rhythm comes from visits weeks or months old, and HTTP cannot backdate a visit
//   (only checkout writes one, stamped now()). This script inserts backdated `visit` rows and calls
//   the real service functions with `now` injected, so it proves the real SQL: store-local days
//   (`at time zone`), the six-most-recent-days window, the exclusions (bookings, series, today's
//   queue — by customer id AND by a phone stored without its '+'), the follow-up table's casts and
//   checks, the staff scope, the services pre-fill, and the owner booking under the `appt:` lock.
//   The router-level test (tests/unit/customers-due.test.ts) pins the same rules against a fake.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate
//   DATABASE_URL=<throwaway> npx tsx scripts/smoke-due-list-db.ts
//
//   It needs a MIGRATED database (not seeded). It creates its own store in 2030 and deletes it at
//   the end (cascade), so runs are independent and the seed tenant is untouched. DATABASE_URL must
//   be exported explicitly, and it refuses the database backend/.env points at — that file holds
//   the live preprod database. SMS is forced off.
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
process.env.WHATSAPP_ENABLED = 'false';
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
  const due = await import('../src/modules/customers/due.service');
  const { bookByOwner } = await import('../src/modules/appointments/owner-booking.service');
  const { addDays, occurrenceStart } = await import('../src/lib/recurrence');
  const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

  const TZ = 'Asia/Kolkata';
  const T = '2030-06-19'; // a Wednesday — "today" for most of this script
  const at = (date: string, hhmm = '12:00') => occurrenceStart(date, hhmm, TZ);
  const NOW = at(T);
  const D = (n: number) => addDays(T, n);

  const slug = `smoke-due-${Date.now()}`;
  const [{ id: biz }] = await q(
    `insert into business (slug, name, category, timezone) values ($1, 'Due Smoke', 'Salon & Barber', $2) returning id`,
    [slug, TZ],
  );
  try {
    // Every day 10:00–20:00 (Sunday closed), two chairs, two services and a switched-off one.
    for (let d = 0; d <= 6; d += 1) {
      await q(
        `insert into business_hour (business_id, day_of_week, opens_at, closes_at, is_closed) values ($1, $2, '10:00', '20:00', $3)`,
        [biz, d, d === 0],
      );
    }
    const [{ id: lisa }] = await q(`insert into staff (business_id, name) values ($1, 'Lisa') returning id`, [biz]);
    const [{ id: john }] = await q(`insert into staff (business_id, name) values ($1, 'John') returning id`, [biz]);
    const svc = async (name: string, mins: number, active = true) =>
      (
        await q(
          `insert into service (business_id, name, duration_minutes, price_paise, is_active) values ($1, $2, $3, 35000, $4) returning id`,
          [biz, name, mins, active],
        )
      )[0].id as string;
    const haircut = await svc('Haircut', 30);
    const spa = await svc('Hair Spa', 60);
    const retired = await svc('Old Colour', 45, false);

    let phoneN = 0;
    const customer = async (name: string) => {
      const phone = `+9190000${String(++phoneN).padStart(5, '0')}`;
      const [{ id }] = await q(`insert into customer (business_id, name, phone) values ($1, $2, $3) returning id`, [biz, name, phone]);
      return { id: id as string, name, phone };
    };
    /** A finished visit on a store-local day at a store-local time. */
    const visit = async (
      c: { id: string; name: string },
      day: string,
      opts: { hhmm?: string; staff?: string; refunded?: boolean; entry?: string | null } = {},
    ) => {
      const done = at(day, opts.hhmm ?? '11:00').toISOString();
      await q(
        `insert into visit (business_id, customer_id, staff_id, service_name, amount_paise, completed_at, queue_entry_id, refunded_at)
         values ($1, $2, $3, 'Haircut', 35000, $4, $5, $6)`,
        [biz, c.id, opts.staff ?? lisa, done, opts.entry ?? null, opts.refunded ? done : null],
      );
    };
    /** Visits 60, 40 and 20 days ago: every 20 days, expected today — "due soon". */
    const regular = async (name: string, staff = lisa) => {
      const c = await customer(name);
      for (const n of [-60, -40, -20]) await visit(c, D(n), { staff });
      return c;
    };
    const list = async (now = NOW, seat: string | null = null) => due.listDue(biz, seat, now);
    const row = (l: Awaited<ReturnType<typeof list>>, id: string) => l.data.find((r) => r.customerId === id);
    const hiddenRow = (l: Awaited<ReturnType<typeof list>>, id: string) => l.hidden.find((r) => r.customerId === id);

    console.log('WHO IS DUE — STATUSES ON THE STORE’S CALENDAR');
    const asha = await customer('Asha');
    await visit(asha, D(-60));
    await visit(asha, D(-40));
    await visit(asha, D(-20), { hhmm: '10:00' });
    await visit(asha, D(-20), { hhmm: '15:00' }); // two services checked out separately: one visit day
    // Just after midnight IST — the previous day in UTC.
    const mira = await customer('Mira');
    for (const n of [-60, -40, -20]) await visit(mira, D(n), { hhmm: '00:10' });
    const bina = await customer('Bina');
    for (const n of [-70, -50, -30]) await visit(bina, D(n), { staff: john }); // overdue
    const chitra = await customer('Chitra');
    for (const n of [-85, -65, -45]) await visit(chitra, D(n)); // not back for a while
    const deepa = await customer('Deepa');
    for (const n of [-90, -80, -40, -18]) await visit(deepa, D(n)); // 10, 40, 22: irregular
    const esha = await customer('Esha');
    for (const n of [-40, -20]) await visit(esha, D(n)); // two visits only
    const farah = await customer('Farah');
    for (const n of [-225, -205, -185]) await visit(farah, D(n)); // gone over 180 days
    const gita = await customer('Gita');
    await visit(gita, D(-60));
    await visit(gita, D(-40));
    await visit(gita, D(-20), { refunded: true }); // a refunded visit still counts
    const weekly = await customer('Wasim');
    for (const n of [-15, -10, -5]) await visit(weekly, D(n)); // every 5 days: under a week

    let l = await list();
    ok(l.today === T, `today is the store's day (${l.today})`);
    ok(row(l, asha.id)?.status === 'due_soon' && row(l, asha.id)?.usualDays === 20, 'every 20 days, last 20 days ago → due soon');
    ok(row(l, asha.id)?.lastVisitDate === D(-20), 'two checkouts on one day are one visit day');
    ok(row(l, mira.id)?.lastVisitDate === D(-20), '00:10 IST counts on the store-local day, not the UTC one');
    ok(row(l, bina.id)?.status === 'overdue', 'last visit 30 days ago on a 20-day rhythm → overdue');
    ok(row(l, chitra.id)?.status === 'lapsed', 'last visit 45 days ago on a 20-day rhythm → not back for a while');
    ok(!row(l, deepa.id) && !hiddenRow(l, deepa.id), 'an irregular customer is not listed');
    ok(!row(l, esha.id), 'two visit days are not a rhythm yet');
    ok(!row(l, farah.id), 'gone over 180 days → dropped');
    ok(row(l, gita.id)?.status === 'due_soon', 'a refunded visit still counts as a visit');
    ok(!row(l, weekly.id), 'a rhythm under 7 days is left out');
    ok(l.data[0]?.status === 'overdue', 'overdue customers come first');
    ok(
      l.counts.overdue === l.data.filter((r) => r.status === 'overdue').length && l.counts.dueSoon >= 3 && l.counts.lapsed >= 1,
      `counts match the rows (${JSON.stringify(l.counts)})`,
    );
    ok(!row(await list(at(D(-3))), asha.id), 'three days before the expected day: not listed yet');
    ok(row(await list(at(D(-2))), asha.id)?.status === 'due_soon', 'two days before: listed');

    console.log('EXCLUSIONS — ALREADY COMING');
    const hari = await regular('Hari');
    await q(
      `insert into appointment (business_id, customer_id, customer_name, customer_phone, staff_id, scheduled_start_at, status, source)
       values ($1, $2, 'Hari', $3, $4, $5, 'confirmed', 'owner')`,
      [biz, hari.id, hari.phone, lisa, at(D(2), '11:00').toISOString()],
    );
    const isha = await regular('Isha');
    // Booked on the website with the number written without '+', and no customer link.
    await q(
      `insert into appointment (business_id, customer_name, customer_phone, scheduled_start_at, status, source)
       values ($1, 'Isha', $2, $3, 'pending', 'online')`,
      [biz, isha.phone.replace('+', ''), at(D(3), '11:00').toISOString()],
    );
    const jaya = await regular('Jaya');
    const kiran = await regular('Kiran');
    const series = async (c: { name: string; phone: string; id?: string }, status: string, token: string, linkId = false) =>
      q(
        `insert into appointment_series
           (business_id, customer_id, customer_name, customer_phone, staff_id, staff_locked, start_time, anchor_date,
            interval_days, end_type, generated_through, manage_token, status, pause_reason)
         values ($1, $2, $3, $4, $5, true, '11:00', $6::date, 14, 'never', $6::date, $7, $8, $9)`,
        [biz, linkId ? c.id : null, c.name, c.phone, lisa, D(30), token, status, status === 'paused' ? 'owner' : null],
      );
    await series(jaya, 'active', `smokedue${Date.now()}a`, true);
    await series(kiran, 'paused', `smokedue${Date.now()}b`);
    const lata = await regular('Lata');
    await q(
      `insert into queue_entry (business_id, customer_id, customer_name, customer_phone, token_day, status, source)
       values ($1, $2, 'Lata', $3, $4::date, 'waiting', 'walk_in')`,
      [biz, lata.id, lata.phone, T],
    );
    const omar = await regular('Omar');
    await q(
      `insert into appointment (business_id, customer_id, customer_name, customer_phone, staff_id, scheduled_start_at, status, source)
       values ($1, $2, 'Omar', $3, $4, $5, 'confirmed', 'owner')`,
      [biz, omar.id, omar.phone, lisa, at(T, '10:00').toISOString()], // this morning — late, still booked
    );
    // Things that do NOT keep someone off the list.
    const neha = await regular('Neha');
    await series(neha, 'ended', `smokedue${Date.now()}c`, true);
    await q(
      `insert into appointment (business_id, customer_id, customer_name, scheduled_start_at, status, source, cancel_reason)
       values ($1, $2, 'Neha', $3, 'cancelled', 'owner', 'cancelled'),
              ($1, $2, 'Neha', $4, 'cancelled', 'owner', 'superseded')`,
      [biz, neha.id, at(D(2), '11:00').toISOString(), at(D(4), '11:00').toISOString()],
    );
    await q(
      `insert into queue_entry (business_id, customer_id, customer_name, token_day, status, source)
       values ($1, $2, 'Neha', $3::date, 'waiting', 'walk_in')`,
      [biz, neha.id, D(-1)],
    );

    l = await list();
    ok(!row(l, hari.id), 'an upcoming booking (by customer) keeps them off the list');
    ok(!row(l, isha.id), 'an upcoming booking matched by phone digits alone keeps them off');
    ok(!row(l, jaya.id), 'an active repeating booking keeps them off');
    ok(!row(l, kiran.id), 'a paused repeating booking keeps them off');
    ok(!row(l, lata.id), 'waiting in today’s queue keeps them off');
    ok(!row(l, omar.id), 'a booking earlier today (store midnight onward) keeps them off');
    ok(!!row(l, neha.id), 'an ended series, cancelled/superseded bookings and yesterday’s queue do not');

    console.log('STAFF SCOPE — LAST VISIT’S CHAIR');
    const johns = await list(NOW, john);
    ok(johns.data.length === 1 && johns.data[0].customerId === bina.id, 'John sees only customers last served in his chair');
    const nobody = await list(NOW, '00000000-0000-0000-0000-000000000000');
    ok(nobody.data.length === 0 && nobody.hidden.length === 0, 'a staff login with no chair sees nobody');

    console.log('SERVICES TO PRE-FILL');
    const priya = await customer('Priya');
    await visit(priya, D(-60));
    await visit(priya, D(-40));
    const [{ id: entry }] = await q(
      `insert into queue_entry (business_id, customer_id, customer_name, service_id, service_name, status, source)
       values ($1, $2, 'Priya', $3, 'Haircut + Hair Spa', 'completed', 'walk_in') returning id`,
      [biz, priya.id, haircut],
    );
    await q(`insert into queue_entry_extra (queue_entry_id, label, minutes) values ($1, 'Hair Spa', 60)`, [entry]);
    await visit(priya, D(-20), { entry });
    const rita = await customer('Rita');
    await visit(rita, D(-60));
    await visit(rita, D(-40));
    const [{ id: entry2 }] = await q(
      `insert into queue_entry (business_id, customer_id, customer_name, service_id, service_name, status, source)
       values ($1, $2, 'Rita', $3, 'Old Colour + Head massage', 'completed', 'walk_in') returning id`,
      [biz, rita.id, retired],
    );
    await q(`insert into queue_entry_extra (queue_entry_id, label, minutes) values ($1, 'Head massage', 15)`, [entry2]);
    await visit(rita, D(-20), { entry: entry2 });
    l = await list();
    const p = row(l, priya.id);
    ok(
      JSON.stringify(p?.serviceIds) === JSON.stringify([haircut, spa]) && p?.servicesResolved === true,
      'the last visit’s service and its extra (named after a service) pre-fill in order',
    );
    const r = row(l, rita.id);
    ok(r?.serviceIds.length === 0 && r?.servicesResolved === false, 'a switched-off service and a non-service add-on: owner must pick');

    console.log('FOLLOW-UPS — WHAT THE CALL ACHIEVED');
    const f1 = await due.setFollowup(biz, asha.id, { outcome: 'no_answer' }, null, null, NOW);
    ok(f1.snoozeUntil === D(1) && f1.aboutLastVisit === D(-20), '"no answer" snoozes to the store’s tomorrow');
    l = await list();
    ok(!row(l, asha.id) && hiddenRow(l, asha.id)?.hiddenReason === 'snoozed', 'snoozed: moved to hidden');
    ok(!!row(await list(at(D(1))), asha.id), 'back on the list tomorrow');

    let refused = false;
    try {
      await due.setFollowup(biz, gita.id, { outcome: 'call_later', callBackOn: T }, null, null, NOW);
    } catch (e: any) {
      refused = e?.httpStatus === 400;
    }
    ok(refused, '"call back on" today is refused (400)');
    await due.setFollowup(biz, gita.id, { outcome: 'call_later', callBackOn: D(3) }, null, null, NOW);
    ok(!row(await list(at(D(2))), gita.id) && !!row(await list(at(D(3))), gita.id), '"call back on" hides until that day');

    // A snooze about an older visit no longer holds; "not interested" holds through anything.
    await q(
      `insert into customer_followup (customer_id, business_id, outcome, snooze_until, about_last_visit)
       values ($1, $2, 'call_later', $3::date, $4::date)`,
      [mira.id, biz, D(20), D(-40)],
    );
    ok(!!row(await list(), mira.id), 'a snooze logged before their latest visit is stale: listed');
    await due.setFollowup(biz, chitra.id, { outcome: 'not_interested' }, null, null, NOW);
    await visit(chitra, D(-1)); // came in by themselves since
    ok(
      !(await list(at(D(30)))).data.some((x) => x.customerId === chitra.id),
      '"not interested" survives a newer visit until undone',
    );
    await due.clearFollowup(biz, chitra.id, null);
    const [{ n: left }] = await q('select count(*)::int as n from customer_followup where customer_id = $1', [chitra.id]);
    ok(left === 0, 'undo deletes the row');
    await due.clearFollowup(biz, chitra.id, null);
    ok(true, 'undo is safe to repeat');

    let shapeRefused = false;
    try {
      await q(
        `insert into customer_followup (customer_id, business_id, outcome, snooze_until, about_last_visit)
         values ($1, $2, 'not_interested', $3::date, $3::date)`,
        [neha.id, biz, T],
      );
    } catch {
      shapeRefused = true;
    }
    ok(shapeRefused, 'the table refuses "not interested" with a snooze day (ck_customer_followup_shape)');

    let scopeRefused = false;
    try {
      await due.setFollowup(biz, asha.id, { outcome: 'no_answer' }, null, john, NOW);
    } catch (e: any) {
      scopeRefused = e?.httpStatus === 404;
    }
    ok(scopeRefused, 'a staff login cannot log a call for another chair’s customer (404)');

    console.log('BOOK FROM THE LIST');
    const slot = at(D(1), '10:00').toISOString();
    await due.setFollowup(biz, bina.id, { outcome: 'call_later', callBackOn: D(5) }, null, null, NOW);
    const appt = await bookByOwner(biz, { customerId: bina.id, serviceIds: [haircut, spa], staffId: john, slotStart: slot }, null, NOW);
    ok(appt.staffId === john && appt.serviceName === 'Haircut + Hair Spa', 'booked Bina with John for both services');
    const [stored] = await q(
      `select source, sms_opt_in, review_sms_opt_in, customer_id, scheduled_end_at,
              (select count(*)::int from appointment_service s where s.appointment_id = a.id) as items
         from appointment a where a.id = $1`,
      [appt.id],
    );
    ok(
      stored.source === 'owner' && stored.sms_opt_in === false && stored.review_sms_opt_in === false && stored.items === 2,
      'source owner, no texts, both services itemised',
    );
    ok(new Date(stored.scheduled_end_at).toISOString() === at(D(1), '11:30').toISOString(), 'the slot is the sum of the services (90 min)');
    const [{ n: bf }] = await q('select count(*)::int as n from customer_followup where customer_id = $1', [bina.id]);
    ok(bf === 0, 'booking settles the logged call outcome');
    ok(!row(await list(), bina.id), 'a booked customer leaves the list');

    let taken = false;
    try {
      await bookByOwner(biz, { customerId: gita.id, serviceIds: [haircut], staffId: john, slotStart: slot }, null, NOW);
    } catch (e: any) {
      taken = e?.httpStatus === 409 && e?.code === 'SLOT_UNAVAILABLE';
    }
    ok(taken, 'the same chair at the same time again → 409 SLOT_UNAVAILABLE');
    const both = await Promise.allSettled(
      [asha, gita].map((c) =>
        bookByOwner(biz, { customerId: c.id, serviceIds: [haircut], staffId: lisa, slotStart: at(D(2), '14:00').toISOString() }, null, NOW),
      ),
    );
    ok(both.filter((x) => x.status === 'fulfilled').length === 1, 'two owners booking one slot at once: exactly one wins');
  } finally {
    await q('delete from business where id = $1', [biz]);
    await pool.end();
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
