// End-to-end smoke test for "Due to come back" (docs/customer-due-list.md): an owner sees a regular
// who is due, logs what a call achieved (and undoes it), and books them from the list — real HTTP
// against a running API + a seeded throwaway database. The database is also written to for the one
// thing HTTP cannot do: a customer's rhythm needs visits weeks old, and only checkout writes a visit
// (stamped now). So the script inserts three backdated visits by SQL, exactly as
// smoke-checkin-sms.mjs backdates a started visit.
//
// RUNNING IT
//   cd backend
//   DATABASE_URL=<throwaway> npm run migrate && DATABASE_URL=<throwaway> npm run seed
//   DATABASE_URL=<throwaway> npm run dev
//   SMOKE_DATABASE_URL=<the same throwaway> node scripts/smoke-due-list.mjs
//
// SMOKE_DATABASE_URL must be the API's database and is refused when it is the database backend/.env
// points at — that is the live preprod DB. The rules themselves (store-local days, exclusions, the
// clock) are covered by smoke-due-list-db.ts; this proves the HTTP surface and its guards.
//
// RE-RUNNABLE: it makes its own chair, customers and staff login each run, cancels its booking and
// removes the login and chair at the end. The backdated visits stay (they count in the seed store's
// revenue — re-seed if that matters). It spends two logins and no public writes.
// SMOKE_BASE_URL points the run at a non-default port.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
const OWNER_PHONE = '919399385943';
const OWNER_PASSWORD = 'password123';

const dbUrl = process.env.SMOKE_DATABASE_URL;
if (!dbUrl) {
  console.error('SMOKE_DATABASE_URL is required: the throwaway database the API under test is using.');
  process.exit(1);
}
try {
  const here = dirname(fileURLToPath(import.meta.url));
  const dotenvUrl = readFileSync(join(here, '..', '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DATABASE_URL='))
    ?.slice('DATABASE_URL='.length)
    .trim();
  if (dotenvUrl && dotenvUrl === dbUrl) {
    console.error('Refusing: SMOKE_DATABASE_URL is the database backend/.env points at. Use a throwaway one.');
    process.exit(1);
  }
} catch {
  // No backend/.env — nothing to compare against.
}

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

const db = new pg.Client({ connectionString: dbUrl });
const stamp = String(Date.now()).slice(-7);
const phone = (n) => `+91700${String((Number(stamp) + n) % 10_000_000).padStart(7, '0')}`;
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function main() {
  await db.connect();

  console.log('SETUP');
  const login = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  ok(login.status === 200 && login.json.accessToken, 'owner login');
  const token = login.json.accessToken;
  const businessId = login.json.user?.businessId ?? login.json.business?.id;
  const [{ id: bizId, timezone }] = (
    await db.query('select b.id, b.timezone from business b join app_user u on u.business_id = b.id where u.phone like $1 limit 1', [
      `%${OWNER_PHONE.slice(-10)}`,
    ])
  ).rows;
  ok(!!bizId && (!businessId || businessId === bizId), 'the API and SMOKE_DATABASE_URL are the same store');

  const seat = await call('POST', '/staff', { token, body: { name: `Due Smoke ${stamp}`, roleLabel: 'Smoke', colorToken: 'secondary' } });
  ok(seat.status === 201, 'a fresh chair of our own');
  const chair = seat.json.id;
  const services = (await call('GET', '/services', { token })).json.data ?? [];
  const haircut = services.find((s) => s.name === 'Haircut' && s.isActive !== false);
  ok(!!haircut, 'the seeded Haircut service');

  const mk = async (name, n) => {
    const r = await call('POST', '/customers', { token, body: { name, phone: phone(n) } });
    ok(r.status === 201, `customer ${name} created`);
    return r.json;
  };
  const regular = await mk(`Due Regular ${stamp}`, 1);
  const other = await mk(`Due Other ${stamp}`, 2);

  // Read the store's "today" from the list itself, then give the regular a 20-day rhythm ending
  // 20 days ago: expected today, so "due soon".
  const first = await call('GET', '/customers/due', { token });
  ok(first.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(first.json.today), `GET /customers/due → 200 (today ${first.json.today})`);
  const today = first.json.today;
  for (const n of [-60, -40, -20]) {
    await db.query(
      `insert into visit (business_id, customer_id, staff_id, service_name, amount_paise, completed_at, queue_entry_id)
       values ($1, $2, $3, 'Haircut', 35000, ($4::date + time '11:00') at time zone $5, null)`,
      [bizId, regular.id, chair, addDays(today, n), timezone],
    );
  }

  console.log('THE LIST');
  const due = async () => (await call('GET', '/customers/due', { token })).json;
  let list = await due();
  const mine = (l) => l.data?.find((r) => r.customerId === regular.id);
  ok(mine(list)?.status === 'due_soon' && mine(list)?.usualDays === 20, 'the regular is listed as due soon, every 20 days');
  ok(mine(list)?.lastStaff?.id === chair && mine(list)?.lastVisitDate === addDays(today, -20), 'with their last stylist and visit day');
  ok(!list.data?.some((r) => r.customerId === other.id), 'a customer with no visits is not');

  console.log('WHAT THE CALL ACHIEVED');
  const put = (id, body) => call('PUT', `/customers/${id}/followup`, { token, body });
  const undo = (id) => call('DELETE', `/customers/${id}/followup`, { token });
  let r = await put(regular.id, { outcome: 'not_interested' });
  ok(r.status === 200 && r.json.outcome === 'not_interested', 'not interested → 200');
  list = await due();
  ok(!mine(list) && list.hidden?.some((x) => x.customerId === regular.id && x.hiddenReason === 'not_interested'), 'moved to hidden');
  ok((await undo(regular.id)).status === 200 && !!mine(await due()), 'undo puts them back');
  ok((await undo(regular.id)).status === 200, 'undo again is harmless');
  r = await put(regular.id, { outcome: 'call_later', callBackOn: today });
  ok(r.status === 400, `"call back on" today → 400 (got ${r.status})`);
  r = await put(regular.id, { outcome: 'call_later', callBackOn: addDays(today, 61) });
  ok(r.status === 400, `"call back on" in 61 days → 400 (got ${r.status})`);
  r = await put(regular.id, { outcome: 'call_later', callBackOn: addDays(today, 1) });
  ok(r.status === 200 && r.json.snoozeUntil === addDays(today, 1), '"call back on" tomorrow → hidden until then');
  ok(!mine(await due()), 'not on the list today');
  ok((await put(other.id, { outcome: 'no_answer' })).status === 422, 'a customer with no visits → 422');
  ok((await put('00000000-1111-4222-8333-444444444444', { outcome: 'no_answer' })).status === 404, 'an unknown customer → 404');

  console.log('BOOK FROM THE LIST');
  let slot = null;
  let day = null;
  for (let i = 1; i <= 7 && !slot; i++) {
    day = addDays(today, i);
    const s = await call('GET', `/appointments/slots?date=${day}&staffId=${chair}&serviceIds=${haircut.id}`, { token });
    if (i === 1) ok(s.status === 200 && s.json.today === today, `GET /appointments/slots → 200 (got ${s.status})`);
    slot = s.json.slots?.[0]?.startAt ?? null;
  }
  ok(!!slot, `a free time on ${day}`);
  const booked = await call('POST', '/appointments', {
    token,
    body: { customerId: regular.id, serviceIds: [haircut.id], staffId: chair, slotStart: slot },
  });
  ok(booked.status === 201 && booked.json.staffId === chair, `book the regular → 201 (got ${booked.status})`);
  const [stored] = (
    await db.query('select source, sms_opt_in from appointment where id = $1', [booked.json.id])
  ).rows;
  ok(stored?.source === 'owner' && stored?.sms_opt_in === false, 'an owner booking, with no texts');
  const [{ n: left }] = (await db.query('select count(*)::int as n from customer_followup where customer_id = $1', [regular.id])).rows;
  ok(left === 0, 'booking settled the "call back later"');
  list = await due();
  ok(!mine(list) && !list.hidden?.some((x) => x.customerId === regular.id), 'a booked customer leaves the list');
  const clash = await call('POST', '/appointments', {
    token,
    body: { customerId: other.id, serviceIds: [haircut.id], staffId: chair, slotStart: slot },
  });
  ok(clash.status === 409 && clash.json.error?.code === 'SLOT_UNAVAILABLE', `the same chair and time again → 409 (got ${clash.status})`);

  console.log('A STAFF LOGIN');
  const staffPhone = `91${String(Date.now()).slice(-10)}`;
  const created = await call('POST', '/users', {
    token,
    body: { name: 'Due Smoke Staff', phone: staffPhone, password: 'smoketest123', role: 'staff', staffId: chair },
  });
  ok(created.status === 201, 'owner creates a staff login on the chair');
  const staffLogin = await call('POST', '/auth/login', { body: { phone: staffPhone, password: 'smoketest123' } });
  ok(staffLogin.status === 200, 'staff login');
  const staffToken = staffLogin.json.accessToken;
  ok((await call('GET', '/customers/due', { token: staffToken })).status === 403, 'staff without Customers access → 403');
  const staffBook = await call('POST', '/appointments', {
    token: staffToken,
    body: { customerId: other.id, serviceIds: [haircut.id], slotStart: slot },
  });
  ok(staffBook.status === 403, `staff with view-only Appointments cannot book → 403 (got ${staffBook.status})`);

  console.log('CLEANUP');
  ok((await call('POST', `/appointments/${booked.json.id}/cancel`, { token })).status === 200, 'cancel the booking');
  await call('DELETE', `/users/${created.json.id}`, { token });
  ok((await call('DELETE', `/staff/${chair}`, { token })).status === 200, 'remove the chair');
}

main()
  .catch((e) => {
    fail++;
    console.error('  ✗ CRASH:', e);
  })
  .finally(async () => {
    await db.end().catch(() => {});
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
