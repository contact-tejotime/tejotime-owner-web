// Checkout add-ons end to end: a running API over real HTTP, against a seeded THROWAWAY database.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate && npm run seed && npm run dev
//   node scripts/smoke-checkout-addons.mjs
//
// What it proves, through the same endpoints owner-web and the app call (docs/checkout-add-ons.md):
//   - an add-on is recorded at the price the owner typed, not the platform default, and the bill
//     moves by exactly that price;
//   - the same add-on cannot go on twice (409 ALREADY_ADDED) — a second tap used to charge it twice;
//   - an old app build that sends no price still gets the catalog default;
//   - a highlighted chip's tap (remove-extra) takes the row, its minutes and its " + Label" off,
//     never the booked service itself, and an unknown add-on / a waiting customer is refused;
//   - a service booked as an extra at walk-in (multi-service) comes off the same way;
//   - an unpriced and a range service with priced add-ons: the server still suggests nothing, names
//     the service, and checkout banks exactly "service price + add-ons" — the sum the sheet's
//     "Total to charge" sends (the client's bug of 2026-10-06).
//
// RE-RUNNABLE: it creates its own chair and services each run (unique names) and removes the chair
// at the end, so it does not depend on — or disturb — the seeded queue. Each run spends ONE login
// of the 10-per-5-minutes limiter (see smoke-rest.mjs).
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
  console.log('SETUP');
  const login = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  ok(login.status === 200 && login.json.accessToken, 'owner login');
  const token = login.json.accessToken;

  const seat = await call('POST', '/staff', {
    token,
    body: { name: `Addons Smoke ${run}`, roleLabel: 'Smoke', colorToken: 'secondary' },
  });
  ok(seat.status === 201, 'a fresh chair of our own');
  const chair = seat.json.id;

  const mkService = async (name, body) => {
    const r = await call('POST', '/services', {
      token,
      body: { name, durationMinutes: 30, colorToken: 'primary', ...body },
    });
    ok(r.status === 201, `create service "${name}" (got ${r.status} ${r.json.error?.message ?? ''})`);
    return r.json;
  };
  const fixedSvc = await mkService(`Smoke Fixed ${run}`, { priceType: 'fixed', priceAmount: 30000 });
  const unsetSvc = await mkService(`Smoke Hair cut ${run}`, { priceType: 'unset' });
  const rangeSvc = await mkService(`Smoke Range ${run}`, { priceType: 'range', priceAmount: 200000, priceMaxAmount: 600000 });
  const washSvc = await mkService(`Smoke Wash ${run}`, { priceType: 'fixed', priceAmount: 10000 });

  const detail = async (id) => (await call('GET', `/queue/${id}`, { token })).json;
  const revenue = async () => (await call('GET', '/dashboard/summary', { token })).json.kpis.revenue.amount;
  const cardOf = (view, id) => view.seats?.flatMap((g) => g.cards).find((c) => c.id === id);

  /** Walk-in on our chair, started, plus one waiting customer behind it so the ETA is visible. */
  async function inChair(name, body) {
    const add = await call('POST', '/queue', { token, body: { name, staffId: chair, position: 'end', ...body } });
    ok(add.status === 201, `walk-in ${name}`);
    const id = add.json.entry?.id;
    const start = await call('POST', `/queue/${id}/start`, { token });
    ok(start.status === 200, `start ${name} (got ${start.status} ${start.json.error?.code ?? ''})`);
    return id;
  }

  console.log('A FIXED SERVICE: THE ADD-ON GOES ON AT THE TYPED PRICE');
  const fixedId = await inChair('Fixed Farah', { serviceId: fixedSvc.id });
  const waiter = await call('POST', '/queue', { token, body: { name: 'Waiting Wasim', staffId: chair, position: 'end' } });
  const waiterId = waiter.json.entry?.id;
  const etaOf = async () => cardOf((await call('GET', '/queue?view=grouped', { token })).json, waiterId)?.etaMinutes;

  let b = await detail(fixedId);
  ok(b.suggestedAmount?.amount === 30000 && b.extras.length === 0, 'starts at the service price with no add-ons');
  ok(b.serviceName === fixedSvc.name, `billing names the booked service on its own (got ${b.serviceName})`);
  const eta0 = await etaOf();

  const shave = await call('POST', `/queue/${fixedId}/extend`, { token, body: { label: 'Shave', minutes: 10, pricePaise: 12300 } });
  ok(shave.status === 200, `extend with a typed price (got ${shave.status} ${shave.json.error?.code ?? ''})`);
  b = await detail(fixedId);
  ok(b.extras.length === 1 && b.extras[0].pricePaise === 12300, `the add-on is recorded at ₹123, not the ₹50 default (got ${b.extras[0]?.pricePaise})`);
  ok(b.extrasAmount?.amount === 12300 && b.suggestedAmount?.amount === 42300, `the bill moves by exactly the typed price (got ${b.suggestedAmount?.amount})`);
  const eta1 = await etaOf();
  ok(eta1 - eta0 >= 9 && eta1 - eta0 <= 11, `the customer behind waits ~10 min longer (${eta0} → ${eta1})`);

  console.log('THE SAME ADD-ON CANNOT GO ON TWICE');
  const again = await call('POST', `/queue/${fixedId}/extend`, { token, body: { label: 'SHAVE', minutes: 10, pricePaise: 5000 } });
  ok(again.status === 409 && again.json.error?.code === 'ALREADY_ADDED', `a repeat (any case) → 409 ALREADY_ADDED (got ${again.status} ${again.json.error?.code})`);
  b = await detail(fixedId);
  ok(b.extras.length === 1 && b.suggestedAmount?.amount === 42300, 'nothing was charged twice');

  console.log('AN OLD APP BUILD (NO PRICE) STILL GETS THE CATALOG DEFAULT');
  const legacy = await call('POST', `/queue/${fixedId}/extend`, { token, body: { label: 'Beard trim', minutes: 15 } });
  ok(legacy.status === 200, 'extend with no price is still accepted');
  b = await detail(fixedId);
  ok(b.extras.find((x) => x.label === 'Beard trim')?.pricePaise === 8000, 'and is priced from the catalog (₹80)');
  // The bug as an old app build hits it: the same body twice, i.e. a second tap on the chip.
  const legacyAgain = await call('POST', `/queue/${fixedId}/extend`, { token, body: { label: 'Beard trim', minutes: 15 } });
  ok(legacyAgain.status === 409, `an old build's second tap → 409, not a second charge (got ${legacyAgain.status})`);
  b = await detail(fixedId);
  ok(b.extras.filter((x) => x.label === 'Beard trim').length === 1 && b.suggestedAmount?.amount === 50300, `Beard trim is on the bill once (got ${b.suggestedAmount?.amount})`);
  const neg = await call('POST', `/queue/${fixedId}/extend`, { token, body: { label: 'Hair wash', minutes: 10, pricePaise: -1 } });
  ok(neg.status === 400, `a negative price is refused (got ${neg.status})`);

  console.log('A HIGHLIGHTED CHIP COMES OFF');
  const off = await call('POST', `/queue/${fixedId}/remove-extra`, { token, body: { label: 'shave' } });
  ok(off.status === 200, `remove-extra (got ${off.status} ${off.json.error?.code ?? ''})`);
  const offCard = cardOf(off.json, fixedId);
  ok(offCard && !/shave/i.test(offCard.service) && /beard trim/i.test(offCard.service), `"+ Shave" is gone from the name, the rest stays (got "${offCard?.service}")`);
  b = await detail(fixedId);
  ok(b.extras.length === 1 && b.suggestedAmount?.amount === 38000, `its price comes off the bill (got ${b.suggestedAmount?.amount})`);
  const eta2 = await etaOf();
  ok(eta1 + 15 - eta2 >= 9 && eta1 + 15 - eta2 <= 11, `and its 10 minutes come off the wait (${eta1}+15 → ${eta2})`);
  const reAdd = await call('POST', `/queue/${fixedId}/extend`, { token, body: { label: 'Shave', minutes: 10, pricePaise: 6000 } });
  ok(reAdd.status === 200, 'once off, it can go back on at a new price');
  ok((await detail(fixedId)).suggestedAmount?.amount === 44000, 'at the new price');

  const unknown = await call('POST', `/queue/${fixedId}/remove-extra`, { token, body: { label: 'Head massage' } });
  ok(unknown.status === 404, `removing an add-on that is not on the visit → 404 (got ${unknown.status})`);
  const base = await call('POST', `/queue/${fixedId}/remove-extra`, { token, body: { label: fixedSvc.name } });
  ok(base.status === 404, `the booked service itself is not an add-on → 404 (got ${base.status})`);
  ok(cardOf((await call('GET', '/queue?view=grouped', { token })).json, fixedId)?.service.startsWith(fixedSvc.name), 'and its name is untouched');
  const notInChair = await call('POST', `/queue/${waiterId}/remove-extra`, { token, body: { label: 'Shave' } });
  ok(notInChair.status === 422, `a customer who is still waiting → 422 (got ${notInChair.status})`);
  const noAuth = await call('POST', `/queue/${fixedId}/remove-extra`, { body: { label: 'Shave' } });
  ok(noAuth.status === 401, `no login → 401 (got ${noAuth.status})`);

  const revFixed = await revenue();
  const outFixed = await call('POST', `/queue/${fixedId}/checkout`, { token, body: { amountPaise: 44000 } });
  ok(outFixed.status === 200, 'check out the fixed visit at its total');
  ok((await revenue()) - revFixed === 44000, 'banked ₹440');

  console.log('A SERVICE BOOKED AS AN EXTRA (MULTI-SERVICE) COMES OFF THE SAME WAY');
  // The waiter was promoted by that checkout; finish them so the chair is free.
  await call('POST', `/queue/${waiterId}/checkout`, { token, body: { amountPaise: 100 } });
  const multiId = await inChair('Multi Meera', { serviceIds: [fixedSvc.id, washSvc.id] });
  b = await detail(multiId);
  ok(b.extras.length === 1 && b.extras[0].label === washSvc.name && b.suggestedAmount?.amount === 40000, 'the second service is an extra (₹300 + ₹100)');
  const offWash = await call('POST', `/queue/${multiId}/remove-extra`, { token, body: { label: washSvc.name } });
  ok(offWash.status === 200, 'remove it');
  ok(cardOf(offWash.json, multiId)?.service === fixedSvc.name, `the name is just the booked service again (got "${cardOf(offWash.json, multiId)?.service}")`);
  ok((await detail(multiId)).suggestedAmount?.amount === 30000, 'and the bill is just the booked service');
  await call('POST', `/queue/${multiId}/checkout`, { token, body: { amountPaise: 30000 } });

  console.log('THE REPORTED BUG: AN UNPRICED SERVICE WITH PRICED ADD-ONS');
  const unsetId = await inChair('Unpriced Uday', { serviceId: unsetSvc.id });
  await call('POST', `/queue/${unsetId}/extend`, { token, body: { label: 'Hair wash', minutes: 10, pricePaise: 10000 } });
  await call('POST', `/queue/${unsetId}/extend`, { token, body: { label: 'Blow-dry', minutes: 15, pricePaise: 8000 } });
  b = await detail(unsetId);
  ok(b.amountRequired === true && b.suggestedAmount === null, 'the server still suggests nothing for the unpriced service');
  ok(b.servicePriceType === 'unset' && b.serviceName === unsetSvc.name, 'and names the service the sheet must ask the price of');
  ok(b.extrasAmount?.amount === 18000, `the add-ons total is known (₹100 + ₹80, got ${b.extrasAmount?.amount})`);
  const unsetBare = await call('POST', `/queue/${unsetId}/checkout`, { token });
  ok(unsetBare.status === 422 && unsetBare.json.error?.code === 'AMOUNT_REQUIRED', 'no amount → 422 AMOUNT_REQUIRED, as before');
  // The sheet sends service price (typed ₹200) + add-ons: what "Total to charge" shows.
  const revUnset = await revenue();
  const outUnset = await call('POST', `/queue/${unsetId}/checkout`, { token, body: { amountPaise: 20000 + b.extrasAmount.amount } });
  ok(outUnset.status === 200, 'check out at Hair cut ₹200 + add-ons ₹180');
  ok((await revenue()) - revUnset === 38000, 'banked ₹380');

  console.log('A RANGE SERVICE WITH AN ADD-ON');
  const rangeId = await inChair('Range Rhea', { serviceId: rangeSvc.id });
  await call('POST', `/queue/${rangeId}/extend`, { token, body: { label: 'Head massage', minutes: 15, pricePaise: 0 } });
  b = await detail(rangeId);
  ok(b.extras[0]?.pricePaise === 0, 'a free add-on (₹0) is recorded as free');
  ok(b.servicePriceType === 'range' && b.suggestedAmount === null && b.serviceMaxAmount?.amount === 600000, 'still a range with nothing suggested');
  const revRange = await revenue();
  await call('POST', `/queue/${rangeId}/checkout`, { token, body: { amountPaise: 450000 + b.extrasAmount.amount } });
  ok((await revenue()) - revRange === 450000, 'banked the chosen ₹4,500');

  console.log('CLEANUP');
  const removed = await call('DELETE', `/staff/${chair}`, { token });
  ok(removed.status === 200, 'remove our chair');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
