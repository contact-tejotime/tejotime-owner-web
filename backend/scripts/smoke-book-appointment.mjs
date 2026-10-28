// End-to-end smoke test for Book appointment — the Appointments tab's "+" on owner-web and the app
// (docs/owner-book-appointment.md): an owner books a typed customer (name + phone) at a free time.
// Real HTTP against a running API + a seeded throwaway database.
//
// It proves:
//   - the free times come from GET /appointments/slots for the chosen services and stylist;
//   - POST /appointments with name + phone books it, and it is on that day's list;
//   - the phone makes it a customer record, and the same number booked again is the SAME customer
//     (no duplicate) — even under another name;
//   - no phone, or a number that isn't one, is refused (400) and books nothing;
//   - the same stylist at the same time is refused (409 SLOT_UNAVAILABLE);
//   - a staff login with the default view-only Appointments access cannot book (403).
//
// RUNNING IT
//   cd backend
//   DATABASE_URL=<throwaway> npm run migrate && DATABASE_URL=<throwaway> npm run seed
//   DATABASE_URL=<throwaway> npm run dev
//   node scripts/smoke-book-appointment.mjs
//
// RE-RUNNABLE: it makes its own chair and staff login each run, cancels its bookings and removes
// both at the end; its customers use unique numbers. It spends two logins and no public writes.
// SMOKE_BASE_URL points the run at a non-default port.
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
const OWNER_PHONE = '919399385943';
const OWNER_PASSWORD = 'password123';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const stamp = String(Date.now()).slice(-7);
const national = (n) => `98${String((Number(stamp) + n) % 100_000_000).padStart(8, '0')}`;
const e164 = (n) => `+91${national(n)}`;

async function main() {
  console.log('SETUP');
  const login = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  ok(login.status === 200 && login.json.accessToken, 'owner login');
  const token = login.json.accessToken;
  const seat = await call('POST', '/staff', { token, body: { name: `Book Smoke ${stamp}`, roleLabel: 'Smoke', colorToken: 'secondary' } });
  ok(seat.status === 201, 'a fresh chair of our own');
  const chair = seat.json.id;
  const haircut = ((await call('GET', '/services', { token })).json.data ?? []).find((s) => s.name === 'Haircut');
  ok(!!haircut, 'the seeded Haircut service');

  console.log('FREE TIMES');
  let day = null;
  let slots = [];
  for (let i = 1; i <= 7 && slots.length < 2; i++) {
    const today = (await call('GET', `/appointments/slots?date=2000-01-01&staffId=${chair}`, { token })).json.today;
    day = new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    const r = await call('GET', `/appointments/slots?date=${day}&staffId=${chair}&serviceIds=${haircut.id}`, { token });
    slots = r.json.slots ?? [];
  }
  ok(slots.length >= 2, `free times on ${day} for our chair`);
  const [first, second] = slots;

  console.log('BOOK A TYPED CUSTOMER');
  const booked = await call('POST', '/appointments', {
    token,
    body: { customerName: `Book Smoke ${stamp}`, customerPhone: e164(1), serviceIds: [haircut.id], staffId: chair, slotStart: first.startAt },
  });
  ok(booked.status === 201 && booked.json.staffId === chair && booked.json.source === 'owner', `name + phone → 201 (got ${booked.status})`);
  ok(booked.json.customerPhone === e164(1) && booked.json.serviceName === 'Haircut', 'with the phone and the service');
  const dayList = (await call('GET', `/appointments?date=${day}`, { token })).json.data ?? [];
  ok(dayList.some((a) => a.id === booked.json.id), "it is on that day's list");
  const found = async () =>
    ((await call('GET', `/customers?search=${national(1)}`, { token })).json.data ?? []).filter((c) => c.phone === e164(1));
  let matches = await found();
  ok(matches.length === 1, 'the phone made it a customer record');

  const again = await call('POST', '/appointments', {
    token,
    body: { customerName: 'Someone Else', customerPhone: e164(1), serviceIds: [haircut.id], staffId: chair, slotStart: second.startAt },
  });
  ok(again.status === 201, `the same number booked again → 201 (got ${again.status})`);
  matches = await found();
  ok(matches.length === 1 && matches[0].name === `Book Smoke ${stamp}`, 'still ONE customer for that number (no duplicate)');

  console.log('REFUSED');
  const noPhone = await call('POST', '/appointments', {
    token,
    body: { customerName: 'No Phone', serviceIds: [haircut.id], staffId: chair, slotStart: slots[2]?.startAt ?? first.startAt },
  });
  ok(noPhone.status === 400, `no phone → 400 (got ${noPhone.status})`);
  const badPhone = await call('POST', '/appointments', {
    token,
    body: { customerName: 'Bad Phone', customerPhone: '12', serviceIds: [haircut.id], staffId: chair, slotStart: slots[2]?.startAt ?? first.startAt },
  });
  ok(badPhone.status === 400, `a number that isn't one → 400 (got ${badPhone.status})`);
  const clash = await call('POST', '/appointments', {
    token,
    body: { customerName: 'Clash', customerPhone: e164(2), serviceIds: [haircut.id], staffId: chair, slotStart: first.startAt },
  });
  ok(clash.status === 409 && clash.json.error?.code === 'SLOT_UNAVAILABLE', `the same chair and time → 409 (got ${clash.status})`);
  const after = (await call('GET', `/appointments?date=${day}`, { token })).json.data ?? [];
  ok(after.filter((a) => a.staffId === chair && a.status !== 'cancelled').length === 2, 'only the two good bookings were written');

  console.log('A STAFF LOGIN');
  const staffPhone = `91${String(Date.now()).slice(-10)}`;
  const created = await call('POST', '/users', {
    token,
    body: { name: 'Book Smoke Staff', phone: staffPhone, password: 'smoketest123', role: 'staff', staffId: chair },
  });
  ok(created.status === 201, 'owner creates a staff login on the chair');
  const staffLogin = await call('POST', '/auth/login', { body: { phone: staffPhone, password: 'smoketest123' } });
  ok(staffLogin.status === 200, 'staff login');
  const staffBook = await call('POST', '/appointments', {
    token: staffLogin.json.accessToken,
    body: { customerName: 'Staff Try', customerPhone: e164(3), serviceIds: [haircut.id], slotStart: slots[2]?.startAt ?? first.startAt },
  });
  ok(staffBook.status === 403, `view-only Appointments access cannot book → 403 (got ${staffBook.status})`);

  console.log('CLEANUP');
  for (const id of [booked.json.id, again.json.id].filter(Boolean)) {
    ok((await call('POST', `/appointments/${id}/cancel`, { token })).status === 200, `cancel ${id.slice(0, 8)}`);
  }
  await call('DELETE', `/users/${created.json.id}`, { token });
  ok((await call('DELETE', `/staff/${chair}`, { token })).status === 200, 'remove the chair');
}

main()
  .catch((e) => {
    fail++;
    console.error('  ✗ CRASH:', e);
  })
  .finally(() => {
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
