// "Paid by" at checkout end to end: a running API over real HTTP, against a seeded THROWAWAY database.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate && npm run seed && npm run dev
//   node scripts/smoke-payment-method.mjs
//
// What it proves, through the same endpoints owner-web and the app call
// (docs/card-payments-paypal.md, migration 0042). "Paid by" is for US stores only (client decision
// 2026-10-15), so it runs visits on both kinds:
//   - a store that is NOT a US store (the seeded `sharp-cuts`, priced in rupees) has no "Paid by":
//     a method is refused, and the old bare checkout works exactly as before;
//   - a US store (priced in dollars) asks "Paid by" only while Card payments is switched on (client
//     2026-10-16): a new store reports it off and checks out the old way; switched on, it reports
//     on, and Card and Cash are each written onto the visit and come back on the customer's visit
//     history; switched off again it reports off, and a Cash picked on a sheet opened before the
//     switch is still recorded. Anything else (UPI, Venmo, Other) or an unknown method is refused
//     and nothing is checked out; the bare checkout old app builds send still works;
//   - revenue moves by exactly the amounts checked out.
//
// The US store is its own, created each run through the admin API and deactivated at the end. That
// needs an admin: SMOKE_ADMIN_MOBILE + SMOKE_ADMIN_PASSWORD, or SMOKE_ADMIN_TOKEN; they default to
// the demo admin `npm run migrate` gives a throwaway database (919399385943 / admin456). The script
// never edits an existing store's currency: the admin store save is a full save that rebuilds
// hours, services and staff.
//
// RE-RUNNABLE: it creates its own chairs, services and US store each run (unique names/numbers) and
// removes or deactivates them at the end. Each run spends THREE logins of the 10-per-5-minutes
// limiter (three different numbers).
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

async function adminToken() {
  if (process.env.SMOKE_ADMIN_TOKEN) return process.env.SMOKE_ADMIN_TOKEN;
  const mobile = process.env.SMOKE_ADMIN_MOBILE ?? '919399385943';
  const password = process.env.SMOKE_ADMIN_PASSWORD ?? 'admin456';
  const login = await call('POST', '/admin/auth/login', { body: { mobile, password } });
  return login.json.token ?? login.json.accessToken ?? null;
}

/** A chair and a fixed 300 service of our own in a store, and helpers to seat a customer there. */
async function storeKit(token, run, phone) {
  const seat = await call('POST', '/staff', {
    token,
    body: { name: `Paid By Smoke ${run}`, roleLabel: 'Smoke', colorToken: 'secondary' },
  });
  ok(seat.status === 201, 'a fresh chair of our own');
  const svc = await call('POST', '/services', {
    token,
    body: { name: `Paid By Cut ${run}`, durationMinutes: 30, colorToken: 'primary', priceType: 'fixed', priceAmount: 30000 },
  });
  ok(svc.status === 201, 'a fixed 300 service of our own');
  return {
    chair: seat.json.id,
    revenue: async () => (await call('GET', '/dashboard/summary', { token })).json.kpis.revenue.amount,
    async inChair(name) {
      const add = await call('POST', '/queue', {
        token,
        body: { name, phone, serviceId: svc.json.id, staffId: seat.json.id, position: 'end' },
      });
      ok(add.status === 201, `walk-in ${name}`);
      const id = add.json.entry?.id;
      const start = await call('POST', `/queue/${id}/start`, { token });
      ok(start.status === 200, `start ${name} (got ${start.status} ${start.json.error?.code ?? ''})`);
      return id;
    },
  };
}

async function main() {
  const run = Date.now();
  const tail = String(run).slice(-4);

  console.log('NOT A US STORE (THE SEEDED STORE, IN RUPEES): NO "PAID BY", THE OLD CHECKOUT');
  const inr = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  const inrToken = inr.json.accessToken;
  ok(inr.status === 200 && !!inrToken, 'owner login');
  ok(inr.json.business?.currency === 'INR', `the seeded store is a rupee store (got ${inr.json.business?.currency})`);
  const inrKit = await storeKit(inrToken, run, `+9198${String(run).slice(-8)}`);
  const inrId = await inrKit.inChair('Payer rupee');
  for (const method of ['card', 'cash']) {
    const r = await call('POST', `/queue/${inrId}/checkout`, { token: inrToken, body: { amountPaise: 30000, paymentMethod: method } });
    ok(r.status === 400 && r.json.error?.details?.[0]?.field === 'paymentMethod', `${method} is not offered on a rupee store → 400 (got ${r.status})`);
  }
  const revInr = await inrKit.revenue();
  const inrOut = await call('POST', `/queue/${inrId}/checkout`, { token: inrToken, body: { amountPaise: 30000 } });
  ok(inrOut.status === 200, `the old checkout, no method (got ${inrOut.status} ${inrOut.json.error?.code ?? ''})`);
  ok((await inrKit.revenue()) - revInr === 30000, 'revenue moves by exactly 300');
  ok((await call('DELETE', `/staff/${inrKit.chair}`, { token: inrToken })).status === 200, 'remove our chair');

  console.log('A US STORE (DOLLARS): CARD AND CASH');
  const admin = await adminToken();
  ok(!!admin, 'an admin, to create a US store');
  const usNumber = `239556${tail}`;
  const storeFields = {
    name: `Paid By US Smoke ${run}`,
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
  const us = await call('POST', '/auth/login', { body: { phone: `1${usNumber}`, password: 'smoke-pass-123' } });
  const token = us.json.accessToken;
  ok(us.status === 200 && us.json.business?.currency === 'USD', `its owner logs in, store in USD (got ${us.status} ${us.json.business?.currency ?? us.json.error?.code})`);
  const usPhone = `+1239557${tail}`;
  const { chair, revenue, inChair } = await storeKit(token, run, usPhone);
  const expected = [];
  /** What the checkout sheets read to decide whether to ask "Paid by" (`paidByChoices`). */
  const cardsFlag = async (id) => (await call('GET', `/queue/${id}`, { token })).json.cardPaymentsEnabled;
  const setCards = async (enabled) => call('PUT', '/card-payments/settings', { token, body: { enabled } });

  try {
    // The sheets ask "Paid by" only while the store has Card payments switched on (client
    // 2026-10-16); a US store that has not is the old checkout. The asking itself is client logic
    // (`npm run test:checkout`); what is proved here is the flag the sheets are fed, and that the
    // checkout each state sends goes through.
    console.log('A NEW US STORE HAS CARD PAYMENTS OFF: NO "PAID BY", THE OLD CHECKOUT');
    const offId = await inChair('Payer cards off');
    const offFlag = await cardsFlag(offId);
    ok(offFlag === false, `GET /queue/:id reports Card payments off, so the sheet asks nothing (got ${offFlag})`);
    const offOut = await call('POST', `/queue/${offId}/checkout`, { token, body: { amountPaise: 29900 } });
    ok(offOut.status === 200, `the old checkout, no method (got ${offOut.status} ${offOut.json.error?.code ?? ''})`);
    expected.push({ method: null, amount: 29900 });

    console.log('SWITCHED ON: THE SHEET ASKS "PAID BY" — CARD AND CASH');
    const on = await setCards(true);
    ok(on.status === 200 && on.json.enabled === true, `the main owner switches Card payments on (got ${on.status} ${on.json.error?.code ?? ''})`);
    for (const [i, method] of ['card', 'cash'].entries()) {
      const id = await inChair(`Payer ${method}`);
      if (i === 0) {
        const onFlag = await cardsFlag(id);
        ok(onFlag === true, `GET /queue/:id now reports Card payments on (got ${onFlag})`);
      }
      const amount = 30100 + i * 100; // a distinct amount per visit, to match them up in the history
      const rev = await revenue();
      const out = await call('POST', `/queue/${id}/checkout`, { token, body: { amountPaise: amount, paymentMethod: method } });
      ok(out.status === 200, `check out paid by ${method} (got ${out.status} ${out.json.error?.code ?? ''})`);
      ok((await revenue()) - rev === amount, `revenue moves by exactly ${amount / 100}`);
      expected.push({ method, amount });
    }

    console.log('SWITCHED OFF AGAIN: BACK TO NO "PAID BY"; AN ANSWER FROM A SHEET OPENED BEFORE STILL LANDS');
    const staleId = await inChair('Payer stale sheet');
    const off = await setCards(false);
    ok(off.status === 200 && off.json.enabled === false, `the main owner switches Card payments off (got ${off.status})`);
    const offAgain = await cardsFlag(staleId);
    ok(offAgain === false, `GET /queue/:id reports Card payments off again (got ${offAgain})`);
    const stale = await call('POST', `/queue/${staleId}/checkout`, { token, body: { amountPaise: 30300, paymentMethod: 'cash' } });
    ok(stale.status === 200, `Cash picked before the switch is recorded, not refused (got ${stale.status} ${stale.json.error?.code ?? ''})`);
    expected.push({ method: 'cash', amount: 30300 });

    console.log('A US STORE OFFERS NOTHING ELSE FOR NOW');
    const refusedId = await inChair('Payer refused');
    for (const method of ['upi', 'venmo', 'other']) {
      const r = await call('POST', `/queue/${refusedId}/checkout`, { token, body: { amountPaise: 30000, paymentMethod: method } });
      ok(r.status === 400 && r.json.error?.details?.[0]?.field === 'paymentMethod', `${method} is not offered → 400 (got ${r.status})`);
    }
    const junk = await call('POST', `/queue/${refusedId}/checkout`, { token, body: { amountPaise: 30000, paymentMethod: 'bitcoin' } });
    ok(junk.status === 400, `an unknown method → 400 (got ${junk.status})`);
    const still = await call('GET', `/queue/${refusedId}`, { token });
    ok(still.json.status === 'in-service' || still.json.status === 'in_service', `nothing was checked out (status ${still.json.status})`);

    console.log('THE BARE CHECKOUT OLD APP BUILDS SEND STILL WORKS ON A US STORE');
    const bare = await call('POST', `/queue/${refusedId}/checkout`, { token });
    ok(bare.status === 200, `bare checkout (got ${bare.status} ${bare.json.error?.code ?? ''})`);
    expected.push({ method: null, amount: 30000 });

    console.log("THE CUSTOMER'S HISTORY SHOWS HOW EACH VISIT WAS PAID");
    const found = await call('GET', `/customers?search=${encodeURIComponent(usPhone.slice(-10))}`, { token });
    const customer = found.json.data?.[0];
    ok(found.json.data?.length === 1, `one customer for the number (got ${found.json.data?.length})`);
    const visits = (await call('GET', `/customers/${customer?.id}/visits`, { token })).json.data ?? [];
    ok(visits.length === expected.length, `${expected.length} visits (got ${visits.length})`);
    for (const e of expected) {
      const v = visits.find((x) => x.amount?.amount === e.amount && x.paymentMethod === e.method);
      ok(!!v, `${e.amount / 100} paid by ${e.method ?? '(not recorded)'} is in the history`);
    }
    ok(visits.every((v) => v.refunded === false), 'none of them refunded');
  } finally {
    console.log('CLEANUP');
    ok((await call('DELETE', `/staff/${chair}`, { token })).status === 200, 'remove our chair');
    // There is no delete-store endpoint: deactivate it (the update schema is strict, so only the
    // store fields the admin form sends).
    if (usStoreId) {
      const off = await call('PUT', `/admin/businesses/${usStoreId}`, { token: admin, body: { ...storeFields, isActive: false } });
      ok(off.status === 200, `deactivate our US store (got ${off.status})`);
    }
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
