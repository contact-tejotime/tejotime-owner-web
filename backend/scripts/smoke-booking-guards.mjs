// End-to-end smoke test for the server-side booking guards added after manual QA (30 Sep 2026):
// the booking endpoint now re-checks the slot under a per-store lock and refuses anything the
// slot list would not offer. Runs against a running server + seeded data, over real HTTP.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate && npm run seed && npm run dev
//   node scripts/smoke-booking-guards.mjs            # SMOKE_SLUG / SMOKE_BASE_URL to override
//
// Its own script because of `limiters.publicWrite` (20 writes per hour per IP): smoke-rest.mjs
// spends 14 and smoke-selfservice.mjs 14, this one 10. Run it against a freshly started API (the
// limiter is in-memory; a restart clears it). It only creates rows under its own unique phone
// numbers, so it needs no re-seed between runs.
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
const SLUG = process.env.SMOKE_SLUG ?? 'sharp-cuts';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

async function call(method, path, { body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const stamp = String(Date.now()).slice(-6);
const phone = (n) => `+91944${stamp}${n}`; // unique per run and per case
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function main() {
  const site = await call('GET', `/public/businesses/${SLUG}`);
  ok(site.status === 200, 'microsite loads');
  const services = site.json.services ?? [];
  const short = services.find((s) => s.durationMinutes === 30) ?? services[0];
  const long = [...services].sort((a, b) => b.durationMinutes - a.durationMinutes)[0];
  const stylist = site.json.staff[0];
  ok(!!short && !!long && long.durationMinutes > 30 && !!stylist, `fixtures: short "${short?.name}", long "${long?.name}" (${long?.durationMinutes} min), stylist ${stylist?.name}`);

  // A future open day, a few days out so earlier smoke runs do not collide.
  const openDays = [];
  for (let i = 2; i <= 12 && openDays.length < 2; i += 1) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
    const r = await call('GET', `/public/businesses/${SLUG}/slots?date=${ymd(d)}&serviceIds=${long.id}&staffId=${stylist.id}`);
    if (r.json.slots?.length) openDays.push({ date: ymd(d), slots: r.json.slots });
  }
  ok(openDays.length === 2, 'found two open days with free times');
  const [dayA, dayB] = openDays;
  const book = (ph, serviceId, staffId, slotStart) =>
    call('POST', `/public/businesses/${SLUG}/appointments`, {
      body: { name: 'Guard Test', phone: ph, serviceIds: [serviceId], preferredStaffId: staffId, slotStart, smsOptIn: false, reviewSmsOptIn: false },
    });

  console.log('SAME SLOT, SAME MOMENT');
  const slot = dayA.slots[dayA.slots.length - 1];
  const [a, b] = await Promise.all([book(phone(1), long.id, stylist.id, slot.startAt), book(phone(2), long.id, stylist.id, slot.startAt)]);
  const statuses = [a.status, b.status].sort();
  ok(statuses[0] === 201 && statuses[1] === 409, `two customers confirm together → exactly one booking (${a.status}/${b.status})`);
  const loser = a.status === 409 ? a : b;
  ok(loser.json.error?.code === 'SLOT_UNAVAILABLE', 'the other gets 409 SLOT_UNAVAILABLE');

  console.log('OVERLAP');
  const first = dayB.slots[0];
  const long1 = await book(phone(3), long.id, stylist.id, first.startAt);
  ok(long1.status === 201, `${long.name} booked at ${first.label}`);
  const inside = new Date(new Date(first.startAt).getTime() + 30 * 60_000).toISOString();
  const ov = await book(phone(4), short.id, stylist.id, inside);
  ok(ov.status === 409, `a ${short.name} 30 min into that ${long.durationMinutes}-min booking → 409 (got ${ov.status})`);
  const after = await call('GET', `/public/businesses/${SLUG}/slots?date=${dayB.date}&serviceIds=${short.id}&staffId=${stylist.id}`);
  ok(!after.json.slots.some((s) => s.startAt === inside), 'and the slot list no longer offers it');

  console.log('TIMES THE SLOT LIST WOULD NEVER OFFER');
  const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const far = new Date(); far.setDate(far.getDate() + 45);
  for (const [label, when] of [
    ['in the past', at(ymd(yesterday), '11:00')],
    ['at 11 PM', at(dayB.date, '23:00')],
    ['off the 30-minute grid', new Date(new Date(dayB.slots.at(-1).startAt).getTime() + 15 * 60_000).toISOString()],
    ['45 days out (beyond the booking window)', at(ymd(far), '11:00')],
  ]) {
    const r = await book(phone(5 + label.length % 4), short.id, stylist.id, when);
    ok(r.status === 409 && r.json.error?.code === 'SLOT_UNAVAILABLE', `a booking ${label} → 409 (got ${r.status})`);
  }

  console.log('STYLIST CHECKS');
  const foreign = await book(phone(8), short.id, '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f', dayB.slots.at(-1).startAt);
  ok(foreign.status === 400, `a stylist who is not at this store → 400 (got ${foreign.status})`);
  const malformed = await book(phone(9), short.id, 'abc', dayB.slots.at(-1).startAt);
  ok(malformed.status === 400, `a malformed stylist id → 400, not 500 (got ${malformed.status})`);
}

main()
  .catch((e) => { fail++; console.error('  ✗ CRASH:', e); })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
