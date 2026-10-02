// Staff commission end to end: a running API over real HTTP, against a seeded THROWAWAY database.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate && npm run seed && npm run dev
//   node scripts/smoke-commission.mjs
//
// What it proves, through the same endpoints owner-web and the app call:
//   - a rate starts on the store's today by default, and a checkout earns the rate of its day;
//   - saving again for today re-prices today; a change scheduled for tomorrow does not;
//   - a day that is over is locked (409 COMMISSION_RATE_LOCKED);
//   - a staff login sees its own earnings from the start, with no grant, and ONLY its own chair;
//     an old app's permission save carrying `commission` neither hides nor raises it; and it can
//     never read or set a rate;
//   - a chair removed mid-period keeps its work in the reports (regression: /dashboard/by-staff
//     used to drop it).
// The "20% on the 2nd, 30% from the 16th" history itself needs dated visits, which no API can
// create — that is scripts/smoke-commission-db.mjs.
//
// RE-RUNNABLE: it creates its own chair and its own staff login each run (and removes both at the
// end), so it does not depend on — or disturb — the seeded queue. Each run spends two logins of
// the 10-per-5-minutes limiter (see smoke-rest.mjs); restart the API if they start reading 429.
//
// SMOKE_BASE_URL points the run at a non-default port, for when a dev API already holds 8080.
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

/** `YYYY-MM-DD` ± n days, on the calendar (no timezone involved). */
function shiftDay(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log('SETUP');
  const login = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  ok(login.status === 200 && login.json.accessToken, 'owner login');
  const token = login.json.accessToken;

  const seat = await call('POST', '/staff', {
    token,
    body: { name: `Commission Smoke ${Date.now()}`, roleLabel: 'Smoke', colorToken: 'secondary' },
  });
  ok(seat.status === 201, 'a fresh chair of our own');
  const chair = seat.json.id;

  const summary = async (qs = '', t = token) => (await call('GET', `/commission/summary${qs}`, { token: t })).json;
  const mine = (s) => s.staff?.find((x) => x.staffId === chair);

  console.log('RATES: none to begin with; a rate starts on the store\'s today by default');
  const rates = await call('GET', '/commission/rates', { token });
  ok(rates.status === 200, 'the owner reads the rates');
  const today = rates.json.today;
  ok(/^\d{4}-\d{2}-\d{2}$/.test(today ?? ''), `the server says which day it is in the store (${today})`);
  ok(rates.json.data.find((r) => r.staffId === chair)?.current === null, 'a new chair has no rate');

  const set20 = await call('PUT', `/commission/rates/${chair}`, { token, body: { rateBp: 2000 } });
  ok(
    set20.status === 200 && set20.json.data?.current?.rateBp === 2000 && set20.json.data?.current?.from === today,
    `20% from today when no date is given (got ${set20.status} ${JSON.stringify(set20.json.data?.current)})`,
  );

  console.log('A CHECKOUT EARNS THE RATE OF ITS DAY');
  const add = await call('POST', '/queue', {
    token,
    body: { name: 'Commission Walk-in', phone: '+919000000077', staffId: chair, position: 'end' },
  });
  ok(add.status === 201, 'walk-in on the new chair');
  const entry = add.json.entry?.id;
  ok((await call('POST', `/queue/${entry}/start`, { token })).status === 200, 'start');
  const out = await call('POST', `/queue/${entry}/checkout`, { token, body: { amountPaise: 100000 } });
  ok(out.status === 200, 'check out ₹1,000');

  let s = await summary();
  ok(mine(s)?.commission?.amount === 20000, `₹1,000 × 20% = ₹200 (got ${mine(s)?.commission?.amount})`);
  ok(
    s.totals?.salonKeeps?.amount === s.totals?.revenue?.amount - s.totals?.commission?.amount,
    'salon keeps = revenue − commission',
  );

  console.log('SAME DAY: today is not over, so replacing today\'s rate re-prices today');
  const set30 = await call('PUT', `/commission/rates/${chair}`, { token, body: { rateBp: 3000, effectiveFrom: today } });
  ok(set30.status === 200 && set30.json.data?.current?.rateBp === 3000, 'today\'s rate replaced with 30%');
  s = await summary();
  ok(mine(s)?.commission?.amount === 30000, `today's visit is now 30% = ₹300 (got ${mine(s)?.commission?.amount})`);

  console.log('SCHEDULED: a change from tomorrow leaves today alone');
  const tomorrow = shiftDay(today, 1);
  const set50 = await call('PUT', `/commission/rates/${chair}`, { token, body: { rateBp: 5000, effectiveFrom: tomorrow } });
  ok(set50.status === 200 && set50.json.data?.upcoming?.[0]?.from === tomorrow, 'scheduled 50% from tomorrow');
  s = await summary();
  ok(mine(s)?.commission?.amount === 30000, `today stays at ₹300 (got ${mine(s)?.commission?.amount})`);
  ok(mine(s)?.nextRate?.rateBp === 5000, 'the owner sees what is coming');
  const cancel = await call('DELETE', `/commission/rates/${chair}/${tomorrow}`, { token });
  ok(cancel.status === 200 && cancel.json.data?.upcoming?.length === 0, 'cancelling the scheduled change removes it');

  console.log('HISTORY IS LOCKED');
  const yesterday = shiftDay(today, -1);
  const past = await call('PUT', `/commission/rates/${chair}`, { token, body: { rateBp: 9000, effectiveFrom: yesterday } });
  ok(past.status === 409 && past.json.error?.code === 'COMMISSION_RATE_LOCKED', `a day that is over → 409 (got ${past.status} ${past.json.error?.code})`);
  const pastDel = await call('DELETE', `/commission/rates/${chair}/${yesterday}`, { token });
  ok(pastDel.status === 409, `removing a past day's rate → 409 (got ${pastDel.status})`);
  const tooMuch = await call('PUT', `/commission/rates/${chair}`, { token, body: { rateBp: 10001 } });
  ok(tooMuch.status === 400, `above 100% → 400 (got ${tooMuch.status})`);

  console.log('VISIT LIST');
  const list = await call('GET', `/commission/visits?staffId=${chair}`, { token });
  const v = list.json.data?.[0];
  ok(list.status === 200 && list.json.data?.length === 1, 'one visit on the chair');
  ok(v?.rateBp === 3000 && v?.commission?.amount === 30000, `it shows its day's rate and earnings (got ${v?.rateBp} / ${v?.commission?.amount})`);
  ok(v?.localDate === today && /^\d{2}:\d{2}$/.test(v?.localTime ?? ''), 'with store-local date and time from the server');
  ok(v?.customerName === 'Commission Walk-in', 'the owner sees who it was');

  console.log('STAFF LOGIN: sees its own earnings with no grant, own chair only, never sets a rate');
  const staffPhone = `91${String(Date.now()).slice(-10)}`;
  const created = await call('POST', '/users', {
    token,
    body: { name: 'Commission Smoke Staff', phone: staffPhone, password: 'smoketest123', role: 'staff', staffId: chair },
  });
  ok(created.status === 201, `owner creates a staff login on the chair (got ${created.status})`);
  const staffUser = created.json.id;
  ok(created.json.permissions?.commission === 'view', 'earnings are shown from the start — nothing to grant');

  const modules = await call('GET', '/users/modules', { token });
  ok(
    modules.status === 200 && !modules.json.modules?.some((m) => m.key === 'commission'),
    'and the Team grid has no commission row to toggle',
  );

  const staffLogin = await call('POST', '/auth/login', { body: { phone: staffPhone, password: 'smoketest123' } });
  ok(staffLogin.status === 200, 'staff login');
  const staffToken = staffLogin.json.accessToken;
  const me = await call('GET', '/auth/me', { token: staffToken });
  ok(me.json.permissions?.commission === 'view', '/auth/me tells the clients to draw "My earnings"');

  // An app build from when earnings were a toggle sends its complete map, `commission` included.
  const perms = { ...created.json.permissions };
  delete perms.team;
  const hide = await call('PUT', `/users/${staffUser}/permissions`, { token, body: { permissions: { ...perms, commission: 'none' } } });
  ok(hide.status === 200, `an old app's save carrying commission: none still saves (got ${hide.status})`);
  ok(hide.json.permissions?.commission === 'view', '…and does not hide their earnings');

  const own = await summary('', staffToken);
  ok(own.scope === 'self' && own.staff?.length === 1 && own.staff[0].staffId === chair, 'they see exactly their own chair');
  ok(own.totals?.commission?.amount === 30000, `and their own earnings (got ${own.totals?.commission?.amount})`);
  ok(own.totals?.salonKeeps === null && own.unassigned === null, 'but nothing about the shop\'s takings');

  const others = (await call('GET', '/staff', { token })).json.data.filter((x) => x.id !== chair && x.isActive);
  const peek = await call('GET', `/commission/visits?staffId=${others[0]?.id}`, { token: staffToken });
  ok(peek.status === 403, `another chair's visits → 403 (got ${peek.status})`);
  const ownList = await call('GET', '/commission/visits', { token: staffToken });
  ok(ownList.status === 200 && ownList.json.data?.length === 1, 'their own visit list');
  ok(ownList.json.data?.[0]?.customerName === undefined, 'without customer names (they have no customer access)');

  ok((await call('GET', '/commission/rates', { token: staffToken })).status === 403, 'staff cannot read rates');
  ok(
    (await call('PUT', `/commission/rates/${chair}`, { token: staffToken, body: { rateBp: 9000 } })).status === 403,
    'staff cannot set their own rate',
  );
  const escalate = await call('PUT', `/users/${staffUser}/permissions`, { token, body: { permissions: { ...perms, commission: 'manage' } } });
  ok(escalate.status === 200 && escalate.json.permissions?.commission === 'view', 'sending "manage" for a staff login is ignored');
  ok(
    (await call('PUT', `/commission/rates/${chair}`, { token: staffToken, body: { rateBp: 9000 } })).status === 403,
    '…so it still cannot set its own rate',
  );

  console.log('PERIODS');
  const week = await summary('?range=week');
  ok(week.from <= today && new Date(`${week.from}T00:00:00Z`).getUTCDay() === 1, `a week starts on Monday (${week.from})`);
  const dashWeek = await call('GET', '/dashboard/summary?range=week', { token });
  ok(dashWeek.status === 200 && dashWeek.json.from === week.from, 'revenue and commission cover the same week');
  const custom = await summary(`?range=custom&from=${today}&to=${today}`);
  ok(mine(custom)?.commission?.amount === 30000, 'a custom range of just today matches today');
  const backwards = await call('GET', `/commission/summary?range=custom&from=${today}&to=${yesterday}`, { token });
  ok(backwards.status === 400, `a backwards custom range → 400 (got ${backwards.status})`);

  console.log('A CHAIR REMOVED MID-PERIOD KEEPS ITS WORK');
  await call('DELETE', `/users/${staffUser}`, { token });
  const removed = await call('DELETE', `/staff/${chair}`, { token });
  ok(removed.status === 200, 'remove the chair');
  s = await summary();
  ok(mine(s)?.isActive === false && mine(s)?.commission?.amount === 30000, 'the commission report still pays its work');
  const byStaff = await call('GET', '/dashboard/by-staff', { token });
  ok(
    byStaff.json.data?.some((x) => x.staffId === chair && x.isActive === false),
    'and the per-stylist revenue breakdown still lists it (it used to vanish)',
  );
  const onRemoved = await call('PUT', `/commission/rates/${chair}`, { token, body: { rateBp: 2000 } });
  ok(onRemoved.status === 404, `a removed chair takes no new rate (got ${onRemoved.status})`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
