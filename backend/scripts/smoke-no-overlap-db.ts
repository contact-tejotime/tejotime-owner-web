// "A stylist never has two bookings at once" — against a REAL migrated Postgres, through every way
// a booking is made or moved: the customer's own booking (public bookSlot), the owner's booking
// ("Due to come back" → Book, POST /appointments), the owner's and the customer's moves, "any
// stylist" bookings, and both sides at the same moment. See docs/customer-due-list.md and
// docs/customer-booking-page-copy-2026-09-06.md.
//
// WHY A DB SCRIPT
//   The guard is a rule (lib/booking-slots.ts `isBookable`) plus a per-store advisory lock; only a
//   real database shows that two writers racing for one chair end with exactly one booking, and that
//   the bookings the rule reads are the right ones (status, overlap window, a checked-in visit).
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate
//   DATABASE_URL=<throwaway> npx tsx scripts/smoke-no-overlap-db.ts
//
//   A MIGRATED database (not seeded). It makes its own store, books two days ahead on the real
//   clock (public booking takes no injected clock), and deletes the store at the end. It refuses the
//   database backend/.env points at — the live preprod DB. SMS is forced off.
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
  const { bookSlot } = await import('../src/modules/public/public.service');
  const { bookByOwner } = await import('../src/modules/appointments/owner-booking.service');
  const { rescheduleByOwner, rescheduleByCustomer } = await import('../src/modules/appointments/reschedule.service');
  const { addDays, occurrenceStart, storeToday } = await import('../src/lib/recurrence');
  const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

  const TZ = 'Asia/Kolkata';
  const D = addDays(storeToday(new Date(), TZ), 2); // inside the customer's 14-day window
  const at = (hhmm: string) => occurrenceStart(D, hhmm, TZ).toISOString();
  const stamp = String(Date.now()).slice(-6);
  let n = 0;
  const phone = () => `+9198${stamp}${String(++n).padStart(2, '0')}`;

  const slug = `smoke-overlap-${Date.now()}`;
  const [{ id: biz }] = await q(
    `insert into business (slug, name, category, timezone) values ($1, 'Overlap Smoke', 'Salon & Barber', $2) returning id`,
    [slug, TZ],
  );
  try {
    for (let d = 0; d <= 6; d += 1) {
      await q(
        `insert into business_hour (business_id, day_of_week, opens_at, closes_at, is_closed) values ($1, $2, '09:00', '20:00', false)`,
        [biz, d],
      );
    }
    const [{ id: lisa }] = await q(`insert into staff (business_id, name) values ($1, 'Lisa') returning id`, [biz]);
    const [{ id: john }] = await q(`insert into staff (business_id, name) values ($1, 'John') returning id`, [biz]);
    const svc = async (name: string, mins: number) =>
      (await q(`insert into service (business_id, name, duration_minutes, price_paise) values ($1, $2, $3, 35000) returning id`, [biz, name, mins]))[0]
        .id as string;
    const cut = await svc('Haircut', 30);
    const color = await svc('Colour', 60);

    /** The customer's own booking (the store page / chat). Resolves to the booking id, or the error code. */
    const customer = async (staff: string | 'any', service: string, hhmm: string) => {
      try {
        const r = await bookSlot(slug, {
          serviceIds: [service],
          name: `Customer ${n}`,
          phone: phone(),
          preferredStaffId: staff,
          slotStart: at(hhmm),
        });
        return { id: r.appointmentId as string };
      } catch (e: any) {
        return { code: `${e?.httpStatus} ${e?.code}` };
      }
    };
    /** The owner's booking ("Due to come back" → Book). */
    const owner = async (staff: string | 'any', service: string, hhmm: string) => {
      try {
        const r = await bookByOwner(biz, {
          customerName: `Owner booked ${n}`,
          customerPhone: phone(),
          serviceIds: [service],
          staffId: staff,
          slotStart: at(hhmm),
        }, null);
        return { id: r.id as string };
      } catch (e: any) {
        return { code: `${e?.httpStatus} ${e?.code}` };
      }
    };
    const taken = (r: { id?: string; code?: string }) => r.code === '409 SLOT_UNAVAILABLE';
    const okId = (r: { id?: string; code?: string }) => !!r.id;

    console.log(`CUSTOMER BOOKS FIRST, THEN THE OWNER (${D})`);
    ok(okId(await customer(lisa, color, '10:00')), 'customer: Lisa 10:00–11:00 (Colour, 60 min)');
    ok(taken(await owner(lisa, cut, '10:30')), 'owner: Lisa 10:30 → refused (inside her 10:00–11:00)');
    ok(taken(await owner(lisa, cut, '10:00')), 'owner: Lisa 10:00 → refused (same start)');
    ok(taken(await owner(lisa, color, '09:30')), 'owner: Lisa 09:30–10:30 → refused (runs into it)');
    ok(okId(await owner(john, cut, '10:30')), 'owner: John 10:30 → booked (another stylist)');
    const back2back = await owner(lisa, cut, '11:00');
    ok(okId(back2back), 'owner: Lisa 11:00 → booked (back to back is not an overlap)');

    console.log('OWNER BOOKS FIRST, THEN THE CUSTOMER');
    ok(okId(await owner(lisa, color, '14:00')), 'owner: Lisa 14:00–15:00');
    ok(taken(await customer(lisa, cut, '14:30')), 'customer: Lisa 14:30 → refused');
    ok(taken(await customer(lisa, color, '13:30')), 'customer: Lisa 13:30–14:30 → refused');
    ok(okId(await customer(lisa, cut, '15:00')), 'customer: Lisa 15:00 → booked (right after)');

    console.log('BOTH AT THE SAME MOMENT');
    const race = await Promise.all([
      customer(lisa, cut, '16:00'),
      owner(lisa, cut, '16:00'),
      customer(lisa, color, '16:00'),
      owner(lisa, color, '16:00'),
    ]);
    ok(race.filter(okId).length === 1 && race.filter(taken).length === 3, `four tries at Lisa 16:00 at once → exactly one booked (${race.map((r) => r.id ? 'booked' : r.code).join(', ')})`);

    console.log('"ANY STYLIST" USES UP A CHAIR');
    ok(okId(await customer('any', cut, '18:00')), 'customer: any stylist 18:00');
    ok(okId(await owner('any', cut, '18:00')), 'owner: any stylist 18:00 (2 chairs, 2 bookings)');
    ok(taken(await customer('any', cut, '18:00')), 'customer: a third "any" at 18:00 → refused');
    ok(taken(await owner(lisa, cut, '18:00')), 'owner: Lisa 18:00 → refused (both chairs are taken)');

    console.log('MOVING A BOOKING');
    ok(
      await rescheduleByOwner(biz, back2back.id!, { slotStart: at('10:30') }, null).then(() => false, (e: any) => e?.code === 'SLOT_UNAVAILABLE'),
      "owner: move Lisa's 11:00 onto 10:30 → refused",
    );
    const johnsVisit = await customer(john, cut, '12:00');
    ok(
      await rescheduleByCustomer(biz, johnsVisit.id!, { slotStart: at('10:00'), staffId: lisa }).then(() => false, (e: any) => e?.code === 'SLOT_UNAVAILABLE'),
      "customer: move John's 12:00 to Lisa 10:00 → refused",
    );
    ok(
      await rescheduleByCustomer(biz, johnsVisit.id!, { slotStart: at('12:30') }).then(() => true, () => false),
      'customer: move it to a free time → moved',
    );

    console.log('A CHECKED-IN VISIT STILL HOLDS THE CHAIR');
    const early = await owner(lisa, color, '12:00'); // 12:00–13:00
    ok(okId(early), 'owner: Lisa 12:00–13:00');
    // What check-in does to the booking (appointment_check_in): it becomes `checked_in` and the
    // customer is in the chair — the rest of the hour is still theirs.
    await q(`update appointment set status = 'checked_in' where id = $1`, [early.id]);
    ok(taken(await owner(lisa, cut, '12:30')), 'owner: Lisa 12:30 after the 12:00 customer checked in → refused');
    ok(taken(await customer(lisa, cut, '12:30')), 'customer: Lisa 12:30 → refused');
    ok(okId(await owner(lisa, cut, '13:00')), 'owner: Lisa 13:00 → booked (after their hour)');

    console.log('A CANCELLED BOOKING FREES THE TIME');
    const gone = await owner(john, cut, '19:00');
    await q(`update appointment set status = 'cancelled' where id = $1`, [gone.id]);
    ok(okId(await customer(john, cut, '19:00')), 'customer: John 19:00 after a cancellation → booked');

    console.log('THE WHOLE DAY, CHECKED IN THE DATABASE');
    const [{ clashes }] = await q(
      `select count(*)::int as clashes
         from appointment a
         join appointment b on b.business_id = a.business_id and b.staff_id = a.staff_id and a.id < b.id
        where a.business_id = $1
          and a.status in ('pending', 'confirmed', 'checked_in') and b.status in ('pending', 'confirmed', 'checked_in')
          and a.scheduled_start_at < b.scheduled_end_at and b.scheduled_start_at < a.scheduled_end_at`,
      [biz],
    );
    ok(clashes === 0, `no stylist holds two live bookings that overlap (${clashes} found)`);
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
