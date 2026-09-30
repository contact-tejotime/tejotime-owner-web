// End-to-end smoke test for customer self-service — the flows the store chat drives on a
// customer's behalf: book → see it → cancel it, and check in → find it again → leave it.
// Runs against a running server + seeded Sharp Cuts data, over real HTTP.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate && npm run seed && npm run dev
//   node scripts/smoke-selfservice.mjs
//
// WHY A SEPARATE SCRIPT (not a section of smoke-rest.mjs): `limiters.publicWrite` allows 20 public
// writes per hour per IP and smoke-rest.mjs already spends 14 of them. This script spends 14, so
// run it against a FRESHLY STARTED API (the limiter is in-memory; a restart clears it) — a 429 here
// is the harness, not a regression. It only creates rows under its own unique phone numbers, so it
// does not need a re-seed between runs.
//
// SMOKE_BASE_URL points the run at a non-default port.
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
// Override to run against another store, e.g. SMOKE_SLUG=demo-store.
const SLUG = process.env.SMOKE_SLUG ?? 'sharp-cuts';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

async function call(method, path, { body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// Unique per run so repeated runs never collide with each other's bookings or tickets.
const stamp = String(Date.now()).slice(-7);
const PHONE_BOOK = `+91955${stamp}`;
const PHONE_JOIN = `+91966${stamp}`;
const PHONE_NOBODY = `+91977${stamp}`;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function main() {
  const site = await call('GET', `/public/businesses/${SLUG}`);
  ok(site.status === 200, 'microsite loads');
  const haircut = site.json.services.find((s) => s.name === 'Haircut');
  const provider = site.json.staff[0];
  ok(!!haircut && !!provider, 'seed has Haircut and a provider');

  // The seed opens Mon–Sat; take the next open day so the slot is always in the future.
  let day = null;
  for (let i = 1; i <= 7 && !day; i += 1) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
    if (d.getDay() !== 0) day = d;
  }
  const slotsPath = `/public/businesses/${SLUG}/slots?date=${ymd(day)}&serviceIds=${haircut.id}&staffId=${provider.id}`;

  console.log('APPOINTMENT SELF-SERVICE: book → view → cancel');
  const before = await call('GET', slotsPath);
  const wanted = before.json.slots?.[0];
  ok(!!wanted, `a future day has a bookable time with ${provider.name}`);

  const booked = await call('POST', `/public/businesses/${SLUG}/appointments`, {
    body: { name: 'Chat Chitra', phone: PHONE_BOOK, serviceIds: [haircut.id], preferredStaffId: provider.id, slotStart: wanted.startAt },
  });
  ok(booked.status === 201, `booking succeeds (got ${booked.status})`);
  const apptId = booked.json.appointmentId;
  const key = booked.json.appointmentKey;
  ok(/^[0-9a-f]{24}$/.test(key ?? ''), 'booking hands the booking browser an appointmentKey');

  const read = await call('GET', `/public/appointments/${apptId}`, { headers: { 'x-appointment-key': key } });
  ok(read.status === 200 && read.json.status === 'confirmed', 'the key reads the appointment back as confirmed');
  const noKey = await call('GET', `/public/appointments/${apptId}`);
  ok(noKey.status === 404, 'no key → 404 (the id alone opens nothing)');

  const lookup = await call('POST', `/public/businesses/${SLUG}/appointments/lookup`, { body: { phone: PHONE_BOOK } });
  const found = lookup.json.appointments?.find((a) => a.appointmentId === apptId);
  ok(lookup.status === 200 && !!found, 'phone lookup (another device) lists the booking');
  ok(found && !('appointmentKey' in found), 'phone lookup never returns the key, so it cannot cancel');
  const nobody = await call('POST', `/public/businesses/${SLUG}/appointments/lookup`, { body: { phone: PHONE_NOBODY } });
  ok(nobody.status === 200 && nobody.json.appointments.length === 0, 'a different number sees nothing');

  const wrongKey = key.slice(0, -1) + (key.endsWith('0') ? '1' : '0');
  const denied = await call('POST', `/public/appointments/${apptId}/cancel`, { body: { key: wrongKey } });
  ok(denied.status === 404, `a wrong key cannot cancel (got ${denied.status})`);

  const cancelled = await call('POST', `/public/appointments/${apptId}/cancel`, { body: { key } });
  ok(cancelled.status === 200 && cancelled.json.status === 'cancelled', 'the right key cancels');
  const again = await call('POST', `/public/appointments/${apptId}/cancel`, { body: { key } });
  ok(again.status === 422 && again.json.error?.message === 'This appointment is already cancelled', 'cancelling twice → 422');

  const after = await call('GET', slotsPath);
  ok(after.json.slots.some((s) => s.startAt === wanted.startAt), 'the cancelled time is offered again');
  const reread = await call('GET', `/public/appointments/${apptId}`, { headers: { 'x-appointment-key': key } });
  ok(reread.json.status === 'cancelled', 'the status read now says cancelled');

  console.log('WAITLIST SELF-SERVICE: check in → duplicate → track → leave');
  const join = await call('POST', `/public/businesses/${SLUG}/queue`, {
    body: { name: 'Chat Kiran', phone: PHONE_JOIN, serviceIds: [haircut.id], preferredStaffId: 'any' },
  });
  ok(join.status === 201 && /^A-\d+$/.test(join.json.token ?? ''), `check-in issues a token (${join.json.token})`);
  const dup = await call('POST', `/public/businesses/${SLUG}/queue`, {
    body: { name: 'Chat Kiran', phone: PHONE_JOIN, serviceIds: [haircut.id], preferredStaffId: 'any' },
  });
  ok(dup.json.alreadyInQueue === true && dup.json.ticketId === join.json.ticketId, 'the same number again returns the SAME ticket, not a second one');
  ok(!dup.json.socket?.ticketKey, 'the duplicate join does NOT hand out the ticket key (it would let anyone leave)');

  const track = await call('POST', `/public/businesses/${SLUG}/track`, { body: { phone: PHONE_JOIN } });
  ok(track.json.found === true && track.json.ticketId === join.json.ticketId, 'waitlist status by phone finds the ticket');
  ok(!track.json.socket?.ticketKey && !('customerName' in track.json), 'tracking by phone returns position only — no ticket key, no customer name');
  const miss = await call('POST', `/public/businesses/${SLUG}/track`, { body: { phone: PHONE_NOBODY } });
  ok(miss.json.found === false, 'a different number is not on the waitlist');

  // A stranger who looked the number up has the ticket id but not the key.
  const stranger = await call('DELETE', `/public/tickets/${track.json.ticketId}`);
  const still = await call('GET', `/public/tickets/${join.json.ticketId}`);
  ok(stranger.status === 404 && still.json.status === 'waiting', 'leaving without the ticket key → 404, the place is kept');
  const keyHdr = { 'x-ticket-key': join.json.socket?.ticketKey ?? '' };
  const left = await call('DELETE', `/public/tickets/${join.json.ticketId}`, { headers: keyHdr });
  ok(left.status === 200 && left.json.ok, 'leaving with the key works');
  const leftAgain = await call('DELETE', `/public/tickets/${join.json.ticketId}`, { headers: keyHdr });
  ok(leftAgain.status === 409, 'leaving twice is refused (409)');
  const gone = await call('GET', `/public/tickets/${join.json.ticketId}`);
  ok(gone.json.status === 'cancelled', 'the ticket reads back as cancelled');
}

main()
  .catch((e) => { fail++; console.error('  ✗ CRASH:', e); })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
