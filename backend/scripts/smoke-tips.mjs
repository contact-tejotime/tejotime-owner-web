// Tips at checkout end to end: a running API over real HTTP, against a seeded THROWAWAY database.
// docs/checkout-tips.md, migration 0046.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate && npm run seed && npm run dev
//   node scripts/smoke-tips.mjs
//
// What it proves, through the same endpoints owner-web and the app call:
//   - there is NO Tips switch: GET /business, GET /queue/:id and the reports carry none, and
//     PATCH /business refuses one;
//   - a tip is recorded BESIDE the bill: revenue, the stylist's commission and the customer's spend
//     are the bill alone — a 20% chair earns 20% of the bill, never of bill + tip;
//   - the stylist sees the tip below commission (summary and visit list), and a staff login sees
//     its own tips and no other chair's;
//   - a bad tip (negative, fractional, over the cap) is a 400, and a checkout from before tips
//     still works and records none;
//   - the tip is in the store's own currency: the seeded store is in rupees, and tips work there;
//   - a CARD charge is bill + tip: the reader is charged the sum, the visit banks the bill, the
//     chair gets the tip, and a refund takes the tip back out with the rest (US store, via admin).
//
// The card half needs an admin to create a US store: SMOKE_ADMIN_MOBILE + SMOKE_ADMIN_PASSWORD, or
// SMOKE_ADMIN_TOKEN, defaulting to the demo admin `npm run migrate` gives a throwaway database
// (919399385943 / admin456). Without one the card half is skipped, loudly.
//
// RE-RUNNABLE: it makes its own chairs, staff login and (for the card half) its own US store, and
// removes or deactivates them. Each run spends
// three logins of the 10-per-5-minutes limiter (see smoke-rest.mjs).
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

async function main() {
  const run = Date.now();
  const tail = String(run).slice(-8);

  console.log('SETUP: THE SEEDED STORE (RUPEES), A CHAIR AT 20%, AND ITS STAFF LOGIN');
  const login = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  ok(login.status === 200 && login.json.accessToken, 'owner login');
  const token = login.json.accessToken;
  ok(login.json.business?.currency === 'INR', `the seeded store is priced in rupees (got ${login.json.business?.currency})`);

  const seat = await call('POST', '/staff', {
    token,
    body: { name: `Tip Smoke ${run}`, roleLabel: 'Smoke', colorToken: 'secondary' },
  });
  ok(seat.status === 201, 'a fresh chair of our own');
  const chair = seat.json.id;
  const other = await call('POST', '/staff', {
    token,
    body: { name: `Tip Smoke Other ${run}`, roleLabel: 'Smoke', colorToken: 'secondary' },
  });
  ok(other.status === 201, 'and a second chair, to prove one stylist cannot see the other\'s tips');
  const otherChair = other.json.id;
  ok((await call('PUT', `/commission/rates/${chair}`, { token, body: { rateBp: 2000 } })).status === 200, 'the chair earns 20%');
  ok((await call('PUT', `/commission/rates/${otherChair}`, { token, body: { rateBp: 2000 } })).status === 200, 'so does the other');

  const staffPhone = `91${String(run).slice(-10)}`;
  const st = await call('POST', '/users', {
    token,
    body: { name: 'Tip Smoke Staff', phone: staffPhone, password: 'smoketest123', role: 'staff', staffId: chair },
  });
  ok(st.status === 201, `a staff login on the chair (got ${st.status} ${st.json.error?.message ?? ''})`);
  const staffToken = (await call('POST', '/auth/login', { body: { phone: staffPhone, password: 'smoketest123' } })).json.accessToken;
  ok(!!staffToken, 'it logs in');

  const summary = async (t = token) => (await call('GET', '/commission/summary', { token: t })).json;
  const mine = (s, id = chair) => s.staff?.find((x) => x.staffId === id);
  const revenue = async () => (await call('GET', '/dashboard/summary', { token })).json.kpis.revenue.amount;
  const detail = async (id, t = token) => (await call('GET', `/queue/${id}`, { token: t })).json;
  async function inChair(name, phone, staffId = chair) {
    const add = await call('POST', '/queue', { token, body: { name, phone, staffId, position: 'end' } });
    ok(add.status === 201, `walk-in ${name}`);
    const id = add.json.entry?.id;
    ok((await call('POST', `/queue/${id}/start`, { token })).status === 200, `start ${name}`);
    return id;
  }

  console.log('NO SWITCH: EVERY STORE AND EVERY ROLE HAS THE TIP');
  const biz0 = await call('GET', '/business', { token });
  ok(biz0.status === 200 && !('tipEnabled' in biz0.json), 'GET /business carries no Tips switch');
  const aId = await inChair('Tip Ada', `+9190${tail}`);
  ok(!('tipEnabled' in (await detail(aId))), 'and neither does the checkout sheet (the Tip row is always there)');
  const flip = await call('PATCH', '/business', { token, body: { tipEnabled: true } });
  ok(flip.status === 400, `the old switch is refused, it is gone (got ${flip.status})`);
  ok(!('tipsEnabled' in (await summary())), 'and the reports carry none either');

  console.log('A TIP IS BESIDE THE BILL, NEVER IN IT');
  const r0 = await revenue();
  const s0 = await summary();
  // ₹1,000 bill, ₹150 tip (15%): the 20% chair earns ₹200 of the bill, and keeps the ₹150.
  const out = await call('POST', `/queue/${aId}/checkout`, { token, body: { amountPaise: 100000, tipPaise: 15000 } });
  ok(out.status === 200, `check out ₹1,000 with a ₹150 tip (got ${out.status} ${out.json.error?.code ?? ''})`);
  ok((await revenue()) - r0 === 100000, 'revenue went up by the bill alone (₹1,000), not ₹1,150');
  let s = await summary();
  ok(mine(s)?.revenue?.amount - (mine(s0)?.revenue?.amount ?? 0) === 100000, "the chair's revenue is the bill");
  ok(mine(s)?.commission?.amount === 20000, `commission is 20% of the BILL = ₹200, not of ₹1,150 (got ${mine(s)?.commission?.amount})`);
  ok(mine(s)?.tips?.amount === 15000, `the chair's tips are ₹150 (got ${mine(s)?.tips?.amount})`);
  ok(
    s.totals?.salonKeeps?.amount === s.totals?.revenue?.amount - s.totals?.commission?.amount,
    'salon keeps = revenue − commission: it never keeps a tip',
  );
  ok(s.totals?.tips?.amount - (s0.totals?.tips?.amount ?? 0) === 15000, 'the store total of tips went up by ₹150');

  const visits = (await call('GET', `/commission/visits?staffId=${chair}`, { token })).json;
  const visit = visits.data?.[0];
  ok(visit?.amount?.amount === 100000 && visit?.tip?.amount === 15000, `the visit shows the bill and the tip apart (got ${visit?.amount?.amount} / ${visit?.tip?.amount})`);
  ok(visit?.commission?.amount === 20000, 'with the commission on the bill');
  ok(visits.totals?.tips?.amount === 15000, 'and the list totals the tips');

  const adaList = (await call('GET', `/customers?search=${tail}`, { token })).json.data ?? [];
  const ada = adaList.find((c) => c.name === 'Tip Ada');
  ok(ada?.totalSpend?.amount === 100000, `the customer's spend is the bill alone (got ${ada?.totalSpend?.amount})`);

  console.log('NO TIP, AND A CHECKOUT FROM BEFORE TIPS');
  const bId = await inChair('Tip Bo', `+9191${tail}`);
  ok((await call('POST', `/queue/${bId}/checkout`, { token, body: { amountPaise: 50000 } })).status === 200, 'a checkout with no tip field still works');
  const cId = await inChair('Tip Cy', `+9192${tail}`);
  ok((await call('POST', `/queue/${cId}/checkout`, { token, body: { amountPaise: 50000, tipPaise: 0 } })).status === 200, 'and an explicit 0');
  s = await summary();
  ok(mine(s)?.tips?.amount === 15000, `neither adds a tip (got ${mine(s)?.tips?.amount})`);
  ok(mine(s)?.commission?.amount === 40000, `but both earn their 20% (₹200 + ₹100 + ₹100; got ${mine(s)?.commission?.amount})`);

  console.log('A BAD TIP IS REFUSED, AND NOTHING IS CHECKED OUT');
  const dId = await inChair('Tip Di', `+9193${tail}`);
  for (const [label, tipPaise] of [['negative', -1], ['fractional', 12.5], ['over the cap', 100_000_001], ['not a number', 'lots']]) {
    const bad = await call('POST', `/queue/${dId}/checkout`, { token, body: { amountPaise: 50000, tipPaise } });
    ok(bad.status === 400, `a ${label} tip → 400 (got ${bad.status})`);
  }
  // None of the refusals consumed her: a valid checkout still goes through (no tip, so the
  // chair's tips below stay as counted).
  const diOk = await call('POST', `/queue/${dId}/checkout`, { token, body: { amountPaise: 50000, tipPaise: 0 } });
  ok(diOk.status === 200, `Di is still in the chair, and a valid checkout goes through (got ${diOk.status} ${diOk.json.error?.code ?? ''})`);

  console.log("A STAFF LOGIN SEES ITS OWN TIPS, AND ONLY ITS OWN");
  const eId = await inChair('Tip Ed', `+9194${tail}`, otherChair);
  ok((await call('POST', `/queue/${eId}/checkout`, { token, body: { amountPaise: 80000, tipPaise: 9000 } })).status === 200, 'the other chair earns a ₹90 tip');
  const own = await summary(staffToken);
  ok(own.scope === 'self' && own.staff?.length === 1 && own.staff[0].staffId === chair, 'the stylist reads only its own chair');
  ok(own.staff[0].tips?.amount === 15000 && own.totals?.tips?.amount === 15000, `with its own ₹150 of tips, not the other chair's ₹90 (got ${own.totals?.tips?.amount})`);
  ok(own.totals?.salonKeeps === null && own.unassigned === null, "and nothing about the shop's takings");
  const ownList = await call('GET', '/commission/visits', { token: staffToken });
  ok(ownList.status === 200 && ownList.json.data?.some((v) => v.tip?.amount === 15000), 'its visit list carries the tip');
  ok(ownList.json.totals?.tips?.amount === 15000, 'and totals it');
  ok((await call('GET', `/commission/visits?staffId=${otherChair}`, { token: staffToken })).status === 403, "another chair's visits → 403");
  s = await summary();
  ok(mine(s, otherChair)?.tips?.amount === 9000, "the owner sees the other chair's ₹90 on its own line");

  console.log('CLEANUP (SEEDED STORE)');
  await call('DELETE', `/users/${st.json.id}`, { token });
  ok((await call('DELETE', `/staff/${chair}`, { token })).status === 200, 'remove our chair');
  ok((await call('DELETE', `/staff/${otherChair}`, { token })).status === 200, 'and the other');
  // -------------------------------------------------------------------------------------------
  console.log('CARD: THE READER IS CHARGED BILL + TIP; THE VISIT BANKS THE BILL; THE CHAIR GETS THE TIP');
  const adminLogin = process.env.SMOKE_ADMIN_TOKEN
    ? null
    : await call('POST', '/admin/auth/login', {
        body: {
          mobile: process.env.SMOKE_ADMIN_MOBILE ?? '919399385943',
          password: process.env.SMOKE_ADMIN_PASSWORD ?? 'admin456',
        },
      });
  const admin = process.env.SMOKE_ADMIN_TOKEN ?? adminLogin?.json.token ?? null;
  if (!admin) {
    console.log('  ⚠ SKIPPED: no admin to create a US store with. The card half was NOT verified.');
    console.log(`\nRESULT: ${pass} passed, ${fail} failed (card half skipped)`);
    process.exit(fail ? 1 : 0);
  }

  const usNumber = `239558${String(run).slice(-4)}`;
  const storeFields = {
    name: `Tip US Smoke ${run}`,
    category: 'Hair Salon',
    address: '1 Smoke St',
    city: 'Naples',
    tagline: 'Smoke test store',
    countryCode: '1',
    phoneNumber: usNumber,
    timezone: 'America/New_York',
    hours: [],
    services: [],
    staff: [],
  };
  const created = await call('POST', '/admin/businesses', {
    token: admin,
    body: { ...storeFields, currency: 'USD', owner: { password: 'smoke-pass-123' } },
  });
  const usStoreId = created.json.id ?? created.json.business?.id ?? null;
  ok(created.status === 201 && !!usStoreId, `the admin creates a store priced in USD (${created.status}${created.json.error ? `: ${created.json.error.message}` : ''})`);
  const usLogin = await call('POST', '/auth/login', { body: { phone: `1${usNumber}`, password: 'smoke-pass-123' } });
  const us = usLogin.json.accessToken;
  ok(usLogin.status === 200 && !!us && usLogin.json.business?.currency === 'USD', 'its main owner logs in');

  const usSeat = await call('POST', '/staff', { token: us, body: { name: `Tip Card ${run}`, roleLabel: 'Smoke', colorToken: 'secondary' } });
  const usChair = usSeat.json.id;
  ok(usSeat.status === 201, 'a chair of our own in the US store');
  ok((await call('PUT', `/commission/rates/${usChair}`, { token: us, body: { rateBp: 2000 } })).status === 200, 'at 20%');
  ok((await call('PUT', '/card-payments/settings', { token: us, body: { enabled: true, paypalOrgRef: `smoke-tips-${run}` } })).status === 200, 'card payments on');
  const usRevenue = async () => (await call('GET', '/dashboard/summary', { token: us })).json.kpis.revenue.amount;
  const usSummary = async () => (await call('GET', '/commission/summary', { token: us })).json;
  async function usInChair(name, phone) {
    const add = await call('POST', '/queue', { token: us, body: { name, phone, staffId: usChair, position: 'end' } });
    const id = add.json.entry?.id;
    await call('POST', `/queue/${id}/start`, { token: us });
    return id;
  }

  const gId = await usInChair('Tip Gus', `+9186${tail}`);
  // $300 bill + $45 (15%) tip = a $345 charge on the reader.
  const tooBig = await call('POST', '/card-payments', { token: us, body: { queueEntryId: gId, amountPaise: 30000, tipPaise: 30001 } });
  ok(tooBig.status === 400, `a tip larger than the charge it is part of → 400 (got ${tooBig.status})`);
  const start = await call('POST', '/card-payments', { token: us, body: { queueEntryId: gId, amountPaise: 34500, tipPaise: 4500 } });
  ok(start.status === 201 && start.json.payment?.amount?.amount === 34500 && start.json.payment?.tip?.amount === 4500, `the charge is $345, $45 of it the tip (got ${start.status} ${start.json.payment?.amount?.amount}/${start.json.payment?.tip?.amount})`);
  const ref = start.json.payment?.id;
  const rev0 = await usRevenue();
  const sum0 = await usSummary();
  const report = { providerPaymentId: `pp-tip-${run}`, cardBrand: 'VISA', cardLast4: '4242', entryMode: 'CONTACTLESS', chargedAmountPaise: 34500 };
  const done = await call('POST', `/card-payments/${ref}/complete`, { token: us, body: report });
  ok(done.status === 200 && done.json.payment?.status === 'paid' && !!done.json.payment?.visitId, `the reader approves → paid, with a visit (got ${done.status} ${done.json.error?.code ?? ''})`);
  ok((await usRevenue()) - rev0 === 30000, 'revenue went up by the $300 bill, not $345');
  let us1 = await usSummary();
  ok(mine(us1, usChair)?.commission?.amount === 6000, `the chair earns 20% of the $300 bill = $60 (got ${mine(us1, usChair)?.commission?.amount})`);
  ok(mine(us1, usChair)?.tips?.amount === 4500, `and keeps the $45 tip (got ${mine(us1, usChair)?.tips?.amount})`);
  const usVisit = (await call('GET', `/commission/visits?staffId=${usChair}`, { token: us })).json.data?.[0];
  ok(usVisit?.amount?.amount === 30000 && usVisit?.tip?.amount === 4500, 'the visit: $300 bill, $45 tip');
  const again = await call('POST', `/card-payments/${ref}/complete`, { token: us, body: report });
  ok(again.status === 200 && (await usSummary()).totals?.tips?.amount === sum0.totals?.tips?.amount + 4500, 'a repeated report banks the tip once');
  const gus = ((await call('GET', `/customers?search=${tail}`, { token: us })).json.data ?? []).find((c) => c.name === 'Tip Gus');
  ok(gus?.totalSpend?.amount === 30000, `the customer's spend is the $300 bill (got ${gus?.totalSpend?.amount})`);

  const rf = await call('POST', `/card-payments/${ref}/refund`, { token: us, body: { refundReference: `rf-tip-${run}` } });
  ok(rf.status === 200 && rf.json.payment?.status === 'refunded', `refund → refunded (got ${rf.status} ${rf.json.error?.code ?? ''})`);
  us1 = await usSummary();
  ok(mine(us1, usChair)?.tips?.amount === 0, `the whole charge goes back, so the tip leaves too (got ${mine(us1, usChair)?.tips?.amount})`);
  ok(mine(us1, usChair)?.commission?.amount === 0, 'and the commission with it');
  ok((await usRevenue()) === rev0, 'and the $300 of revenue');
  const refunded = (await call('GET', `/commission/visits?staffId=${usChair}`, { token: us })).json.data?.[0];
  ok(refunded?.refunded === true && refunded?.tip?.amount === 0, 'the visit list shows it refunded, with no tip');

  // Cash with a tip on the same store: no reader, same split.
  const hId = await usInChair('Tip Hal', `+9185${tail}`);
  const cash = await call('POST', `/queue/${hId}/checkout`, { token: us, body: { amountPaise: 20000, paymentMethod: 'cash', tipPaise: 3000 } });
  ok(cash.status === 200, `cash with a tip (got ${cash.status} ${cash.json.error?.code ?? ''})`);
  ok(mine(await usSummary(), usChair)?.tips?.amount === 3000, 'the $30 cash tip is the chair\'s');

  console.log('CLEANUP (US STORE)');
  ok((await call('DELETE', `/staff/${usChair}`, { token: us })).status === 200, 'remove our chair');
  await call('PUT', '/card-payments/settings', { token: us, body: { enabled: false } });
  const off = await call('PUT', `/admin/businesses/${usStoreId}`, { token: admin, body: { ...storeFields, isActive: false } });
  ok(off.status === 200, `deactivate our US store (got ${off.status})`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
