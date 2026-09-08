// End-to-end smoke test against the running server + seeded Sharp Cuts data.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate && npm run seed && npm run dev
//   node scripts/smoke-rest.mjs
//
// Two things that will waste your time otherwise:
//
//  1. RE-SEED BETWEEN RUNS. There is no cleanup and the script mutates shared state (it upgrades
//     the tenant to premium and never reverts), so a second run against the same data fails on
//     the plan-gating assertions.
//  2. THE LOGIN LIMITER IS PER-PROCESS AND WILL BITE. `limiters.login` allows 10 attempts per
//     5 minutes keyed on (IP, phone), and each run spends two — including a deliberate wrong
//     password. Roughly five back-to-back runs and "wrong password → 401" starts reading 429
//     instead. The store is in-memory, so RESTARTING THE API clears it; waiting 5 minutes also
//     works. A 429 here is the harness, not a regression.
//
// SMOKE_BASE_URL points the run at a non-default port, for when a dev API already holds 8080.
// Overridable so a run can target a server that is not on the default port — e.g. when a
// dev API already holds 8080 and a throwaway instance is brought up beside it.
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
// The credential db/seed.ts prints on the way out. Digits-only full number, country code first.
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

const seatOf = (seats, name) => seats.find((s) => s.name === name);

async function main() {
  console.log('AUTH');
  // Phone + password, the credential the seed actually prints. This used to post a `handle`,
  // which `loginSchema` (.strict, and requiring `phone`) rejected as a 400 — the first
  // assertion failed and every later one cascaded off a missing token.
  const login = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  ok(login.status === 200 && login.json.accessToken, 'login returns access token');
  const token = login.json.accessToken;
  ok(login.json.business?.slug === 'sharp-cuts', 'login returns business');
  const bad = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: 'wrong' } });
  ok(bad.status === 401, 'wrong password → 401');
  const me = await call('GET', '/auth/me', { token });
  ok(me.status === 200 && me.json.user, 'GET /auth/me works');

  console.log('QUEUE (read)');
  let q = await call('GET', '/queue?view=grouped', { token });
  ok(q.status === 200 && q.json.seats?.length === 3, 'grouped queue has 3 seats');
  const john = seatOf(q.json.seats, 'John');
  ok(john.serving && john.servingName === 'Aisha Khan', 'John serving Aisha');
  // The first waiter's ETA is the in-service head's REMAINING time, not the service's full
  // estimate: `remainingMins` decays the head with wall-clock (queue-engine.ts). The seed pins
  // Aisha's started_at 15 minutes ago on a 45-minute "Haircut & Beard", so this reads ~30 and
  // keeps ticking down while the script runs. The old assertion hardcoded '~45 min' — the
  // undecayed figure — and had gone stale unnoticed because the script could not get past login.
  // Asserting the band rather than a literal is what keeps it from rotting again.
  const johnEta = parseInt(String(john.cards[1].rightText).replace(/\D/g, ''), 10);
  ok(johnEta > 0 && johnEta <= 30, `first John waiter ETA decays from the 45-min head (got ${john.cards[1].rightText})`);
  ok(john.subLine.startsWith('Serving Aisha'), 'John subLine correct');

  const services = await call('GET', '/services?active=true', { token });
  const haircut = services.json.data.find((s) => s.name === 'Haircut');
  ok(!!haircut, 'services list has Haircut');

  console.log('WALK-IN + AUTO SEAT + START + CHECKOUT (auto-promote)');
  const addA = await call('POST', '/queue', { token, body: { name: 'Walk A', phone: '+919000000001', serviceId: haircut.id, staffId: 'auto', position: 'end' } });
  ok(addA.status === 201 && addA.json.entry, 'walk-in A added');
  const seatA = addA.json.entry.seatName;
  ok(seatA === 'Mike', `A auto-assigned to lightest seat (got ${seatA})`);
  const idA = addA.json.entry.id;

  const addB = await call('POST', '/queue', { token, body: { name: 'Walk B', phone: '+919000000002', serviceId: haircut.id, staffId: 'auto', position: 'end' } });
  const idB = addB.json.entry.id;
  ok(addB.json.entry.seatName === 'Mike', 'walk-in B also on Mike');

  const start = await call('POST', `/queue/${idA}/start`, { token });
  ok(start.status === 200, 'start service A');
  const mikeAfterStart = seatOf(start.json.seats, 'Mike');
  ok(mikeAfterStart.serving && mikeAfterStart.servingName === 'Walk A', 'A now in service on Mike');

  const checkout = await call('POST', `/queue/${idA}/checkout`, { token });
  ok(checkout.status === 200, 'checkout A');
  ok(checkout.json.promoted?.name === 'Walk B', `checkout auto-promoted B (got ${checkout.json.promoted?.name})`);

  console.log('EXTEND (add-on) + MOVE + REASSIGN');
  const aishaId = john.cards[0].id;
  const ext = await call('POST', `/queue/${aishaId}/extend`, { token, body: { label: 'Beard trim', minutes: 15 } });
  ok(ext.status === 200, 'extend Aisha service');
  const johnAfterExt = seatOf(ext.json.seats, 'John');
  ok(johnAfterExt.cards[0].service.includes('Beard trim'), 'service name got "+ Beard trim"');

  q = await call('GET', '/queue?view=grouped', { token });
  const johnSeat = seatOf(q.json.seats, 'John');
  const waiters = johnSeat.cards.filter((c) => c.status === 'waiting');
  const sana = waiters.find((c) => c.name === 'Sana Iqbal');
  const move = await call('POST', `/queue/${sana.id}/move`, { token, body: { toIndex: 0 } });
  ok(move.status === 200, 'move Sana to front');
  const johnMoved = seatOf(move.json.seats, 'John');
  const firstWaiter = johnMoved.cards.filter((c) => c.status === 'waiting')[0];
  ok(firstWaiter.name === 'Sana Iqbal', 'Sana is now first waiter');

  const reassign = await call('POST', `/queue/${sana.id}/reassign`, { token, body: { staffId: seatOf(q.json.seats, 'Lisa').id } });
  ok(reassign.status === 200, 'reassign Sana to Lisa');
  const lisa = seatOf(reassign.json.seats, 'Lisa');
  ok(lisa.cards.some((c) => c.name === 'Sana Iqbal'), 'Sana now on Lisa');

  console.log('DASHBOARD');
  const dash = await call('GET', '/dashboard/summary', { token });
  ok(dash.status === 200 && dash.json.kpis.completed >= 1, 'dashboard completed >= 1');
  ok(dash.json.kpis.revenue.amount > 0, 'dashboard revenue > 0');

  console.log('CUSTOMERS + PLAN GATING');
  const free = await call('GET', '/customers', { token });
  ok(free.json.plan === 'free' && free.json.meta.shown === 2, 'free plan shows 2 customers');
  ok(free.json.meta.lockedCount === free.json.meta.total - 2 && free.json.meta.total >= 4, 'lockedCount = total - 2');
  const upg = await call('POST', '/subscription/upgrade', { token });
  ok(upg.status === 200 && upg.json.plan === 'premium', 'upgrade → premium');
  const premium = await call('GET', '/customers', { token });
  ok(premium.json.meta.shown === premium.json.meta.total && premium.json.meta.lockedCount === 0, 'premium shows all');
  const search = await call('GET', '/customers?search=neha', { token });
  ok(search.json.data.length === 1 && search.json.data[0].name === 'Neha Gupta', 'search by name works');

  console.log('PUBLIC MICROSITE + JOIN + TICKET');
  const site = await call('GET', '/public/businesses/sharp-cuts');
  ok(site.status === 200 && site.json.services.length === 5, 'microsite returns 5 services');
  ok(site.json.staff.length === 3 && typeof site.json.live.waitMinutes === 'number', 'microsite staff + live wait');
  const avail = await call('GET', '/public/businesses/sharp-cuts/availability');
  ok(avail.status === 200 && 'queueCount' in avail.json, 'availability endpoint');
  const join = await call('POST', '/public/businesses/sharp-cuts/queue', { body: { serviceId: haircut.id, name: 'Public Joe', phone: '+919555000111', preferredStaffId: 'any' } });
  ok(join.status === 201 && /^A-\d+$/.test(join.json.token), `join issues token (${join.json.token})`);
  const ticket = await call('GET', `/public/tickets/${join.json.ticketId}`);
  ok(ticket.status === 200 && typeof ticket.json.ahead === 'number', 'ticket status readable');
  const leave = await call('DELETE', `/public/tickets/${join.json.ticketId}`);
  ok(leave.status === 200 && leave.json.ok, 'leave queue works');


  console.log('MULTI-DAY BOOKING + PREFERRED PROVIDER');
  // Booking used to be today-only: the microsite asked for `new Date()` and nothing else, so a
  // customer arriving late in the day saw whatever was left of today and was pushed at the
  // waitlist. The API always accepted a date — these assertions pin the behaviour the date
  // picker now depends on, so a change to getSlots cannot quietly re-break multi-day booking.
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
  // The seed opens Mon–Sat and closes Sunday, so both cases below are fixture-stable.
  let nextOpen = null, nextSunday = null;
  for (let i = 1; i <= 7; i += 1) {
    const d = addDays(i);
    if (d.getDay() !== 0 && !nextOpen) nextOpen = d;
    if (d.getDay() === 0 && !nextSunday) nextSunday = d;
  }

  const futureSlots = await call('GET', `/public/businesses/sharp-cuts/slots?date=${ymd(nextOpen)}&serviceId=${haircut.id}`);
  ok(futureSlots.status === 200, 'slots endpoint accepts a future date');
  ok(futureSlots.json.date === ymd(nextOpen), 'slots response echoes the requested date');
  ok(futureSlots.json.slots.length > 0, `a future open day has bookable times (got ${futureSlots.json.slots.length})`);

  // A whole day of times, not just the tail of today — this is the actual gap the picker closes.
  const todaySlots = await call('GET', `/public/businesses/sharp-cuts/slots?date=${ymd(addDays(0))}&serviceId=${haircut.id}`);
  ok(todaySlots.status === 200, 'slots endpoint still serves today');
  ok(
    futureSlots.json.slots.length >= todaySlots.json.slots.length,
    `a future day offers at least as much as the remainder of today (${futureSlots.json.slots.length} vs ${todaySlots.json.slots.length})`,
  );

  // The closed-day case the greyed-out chips in the day strip render from.
  const closedDay = await call('GET', `/public/businesses/sharp-cuts/slots?date=${ymd(nextSunday)}`);
  ok(closedDay.status === 200 && closedDay.json.slots.length === 0, 'a closed weekday offers no slots');

  // Preferred provider. "No preference" sends no staffId; a named provider narrows to that chair.
  const provider = site.json.staff[0];
  const byProvider = await call(
    'GET',
    `/public/businesses/sharp-cuts/slots?date=${ymd(nextOpen)}&serviceId=${haircut.id}&staffId=${provider.id}`,
  );
  ok(byProvider.status === 200 && byProvider.json.slots.length > 0, `slots can be narrowed to ${provider.name}`);

  // Book a FUTURE slot with that provider — the flow the picker unlocks, end to end.
  const wanted = byProvider.json.slots[0];
  const booked = await call('POST', '/public/businesses/sharp-cuts/appointments', {
    body: {
      name: 'Future Fatima', phone: '+919555000444', serviceId: haircut.id,
      preferredStaffId: provider.id, slotStart: wanted.startAt,
    },
  });
  ok(booked.status === 201, `book a slot on a future day (got ${booked.status})`);
  ok(booked.json.scheduledStartAt === wanted.startAt, 'the appointment lands on exactly the slot that was picked');
  ok(booked.json.staffName === provider.name, `the preferred provider is kept (got ${booked.json.staffName})`);
  ok(booked.json.status === 'confirmed', 'a booked appointment is confirmed');

  // That time is now gone from the same provider's list — the day strip must never re-offer it.
  const after = await call(
    'GET',
    `/public/businesses/sharp-cuts/slots?date=${ymd(nextOpen)}&serviceId=${haircut.id}&staffId=${provider.id}`,
  );
  ok(!after.json.slots.some((x) => x.startAt === wanted.startAt), 'the booked time disappears from that provider\'s slots');

  console.log('SERVICE PRICING MODES');
  // What the customer is shown for each mode. The seed carries one of each: a fixed Haircut and
  // a banded Hair Extensions ("depends on the hair"). Before pricing modes there was one column
  // and a zero standing in for "not priced yet", which the microsite printed as the price.
  const allServices = await call('GET', '/services', { token });
  const fixedSvc = allServices.json.data.find((s) => s.name === 'Haircut');
  const rangeSvc = allServices.json.data.find((s) => s.name === 'Hair Extensions');
  ok(fixedSvc?.priceType === 'fixed' && fixedSvc.priceMax === null, 'fixed service has no ceiling');
  ok(fixedSvc?.price.amount === 35000, 'fixed service price is the amount itself');
  ok(rangeSvc?.priceType === 'range', 'range service reports its mode');
  ok(
    rangeSvc?.price.amount === 200000 && rangeSvc?.priceMax?.amount === 600000,
    `range service carries both bounds (got ${rangeSvc?.price.amount}–${rangeSvc?.priceMax?.amount})`,
  );
  ok(rangeSvc?.priceMax?.currency === rangeSvc?.price.currency, 'both bounds carry the store currency');

  // The customer-facing surface has to agree with the owner-facing one, or the microsite quotes
  // a band the shop does not think it published.
  const publicRange = site.json.services.find((s) => s.name === 'Hair Extensions');
  ok(publicRange?.priceType === 'range', 'microsite exposes the range mode');
  ok(
    publicRange?.price.amount === 200000 && publicRange?.priceMax?.amount === 600000,
    'microsite exposes both bounds',
  );
  ok(
    site.json.services.find((s) => s.name === 'Haircut')?.priceMax === null,
    'microsite fixed service has no ceiling',
  );

  // Negative cases first — the shapes the check constraint would otherwise reject as a 500.
  const zeroPrice = await call('POST', '/services', {
    token,
    body: { name: 'Smoke Unpriced', durationMinutes: 30, priceType: 'fixed', priceAmount: 0, colorToken: 'secondary' },
  });
  ok(zeroPrice.status === 400, `fixed price of 0 → 400 (got ${zeroPrice.status})`);

  const noCeiling = await call('POST', '/services', {
    token,
    body: { name: 'Smoke NoMax', durationMinutes: 30, priceType: 'range', priceAmount: 20000, colorToken: 'secondary' },
  });
  ok(noCeiling.status === 400, `range with no maximum → 400 (got ${noCeiling.status})`);

  const inverted = await call('POST', '/services', {
    token,
    body: {
      name: 'Smoke Inverted', durationMinutes: 30, priceType: 'range',
      priceAmount: 60000, priceMaxAmount: 20000, colorToken: 'secondary',
    },
  });
  ok(inverted.status === 400, `range maximum below minimum → 400 (got ${inverted.status})`);

  const ceilingOnFixed = await call('POST', '/services', {
    token,
    body: {
      name: 'Smoke FixedMax', durationMinutes: 30, priceType: 'fixed',
      priceAmount: 30000, priceMaxAmount: 50000, colorToken: 'secondary',
    },
  });
  ok(ceilingOnFixed.status === 400, `ceiling on a fixed price → 400 (got ${ceilingOnFixed.status})`);

  // Unique name per run: the smoke scripts have no cleanup, and the admin upsert matches on name.
  const svcName = `Smoke Range ${Date.now()}`;
  const created = await call('POST', '/services', {
    token,
    body: {
      name: svcName, durationMinutes: 40, priceType: 'range',
      priceAmount: 50000, priceMaxAmount: 90000, colorToken: 'secondary',
    },
  });
  ok(created.status === 201 && created.json.priceType === 'range', 'create a range-priced service');
  ok(created.json.price.amount === 50000 && created.json.priceMax.amount === 90000, 'created service round-trips both bounds');
  const svcId = created.json.id;

  // Pricing moves as a set. A lone amount cannot land, or a service switched from range to fixed
  // would keep the ceiling of the band it used to be.
  const halfPatch = await call('PATCH', `/services/${svcId}`, { token, body: { priceAmount: 70000 } });
  ok(halfPatch.status === 400, `amount without a mode → 400 (got ${halfPatch.status})`);

  const toFixed = await call('PATCH', `/services/${svcId}`, {
    token,
    body: { priceType: 'fixed', priceAmount: 70000 },
  });
  ok(toFixed.status === 200 && toFixed.json.priceType === 'fixed', 'switch a service to fixed');
  ok(toFixed.json.priceMax === null, 'switching to fixed clears the old ceiling');

  const backToRange = await call('PATCH', `/services/${svcId}`, {
    token,
    body: { priceType: 'range', priceAmount: 50000, priceMaxAmount: 90000 },
  });
  ok(backToRange.status === 200 && backToRange.json.priceMax?.amount === 90000, 'switch back to a range');

  console.log('CHECKOUT OF A RANGE-PRICED SERVICE');
  // A DEDICATED, EMPTY SEAT — not `staffId: 'auto'`.
  //
  // Auto-assignment picks the lightest seat, and by this point in the script every seat already
  // has someone in service (the checkout above auto-promoted Walk B onto Mike). `queue_start`
  // enforces uq_one_in_service_per_seat and raises SEAT_BUSY, so the start failed and every
  // assertion after it cascaded off an entry that was still `waiting` — including the 422
  // check, which passed for the WRONG reason (INVALID_STATE is also a 422; only asserting on
  // the error code caught it). A seat created here is guaranteed idle.
  const seatRes = await call('POST', '/staff', {
    token,
    body: { name: `Smoke Seat ${Date.now()}`, roleLabel: 'Smoke', colorToken: 'secondary' },
  });
  ok(seatRes.status === 201, 'dedicated checkout seat created');
  const smokeSeatId = seatRes.json.id;

  // The reason the mode exists: a derived total for a band would silently bank its floor, and
  // visit.amount_paise feeds customer lifetime spend and every revenue KPI.
  const revBefore = (await call('GET', '/dashboard/summary', { token })).json.kpis.revenue.amount;
  const rangeAdd = await call('POST', '/queue', {
    token,
    body: { name: 'Range Rita', phone: '+919555000222', serviceId: svcId, staffId: smokeSeatId, position: 'end' },
  });
  ok(rangeAdd.status === 201, 'walk-in on a range-priced service added');
  const rangeEntry = rangeAdd.json.entry.id;
  const rangeStart = await call('POST', `/queue/${rangeEntry}/start`, { token });
  ok(rangeStart.status === 200, `start the range-priced service (got ${rangeStart.status} ${rangeStart.json.error?.code ?? ''})`);

  const rangeBilling = await call('GET', `/queue/${rangeEntry}`, { token });
  ok(rangeBilling.json.amountRequired === true, 'checkout is told the amount is required');
  ok(rangeBilling.json.suggestedAmount === null, 'no suggested total to pre-fill for a range');
  ok(rangeBilling.json.servicePriceType === 'range', 'billing reports the range mode');
  ok(rangeBilling.json.serviceMaxAmount?.amount === 90000, 'billing carries the band so the sheet can show it');

  const noAmount = await call('POST', `/queue/${rangeEntry}/checkout`, { token });
  ok(noAmount.status === 422, `checkout with no amount → 422 (got ${noAmount.status})`);
  ok(noAmount.json.error?.code === 'AMOUNT_REQUIRED', `refusal names the reason (got ${noAmount.json.error?.code})`);

  const withAmount = await call('POST', `/queue/${rangeEntry}/checkout`, { token, body: { amountPaise: 72500 } });
  ok(withAmount.status === 200, 'checkout with an explicit amount succeeds');
  const revAfter = (await call('GET', '/dashboard/summary', { token })).json.kpis.revenue.amount;
  ok(
    revAfter - revBefore === 72500,
    `the typed amount is what got banked, not the band's floor (delta ${revAfter - revBefore})`,
  );

  // The positive control: a fixed service still checks out with no body at all, which is what
  // every client built before pricing modes sends.
  // Same seat — the range checkout above completed, so it is idle again.
  const fixedAdd = await call('POST', '/queue', {
    token,
    body: { name: 'Fixed Fiona', phone: '+919555000333', serviceId: fixedSvc.id, staffId: smokeSeatId, position: 'end' },
  });
  const fixedEntry = fixedAdd.json.entry.id;
  const fixedStart = await call('POST', `/queue/${fixedEntry}/start`, { token });
  ok(fixedStart.status === 200, `start the fixed-price service (got ${fixedStart.status})`);
  const fixedBilling = await call('GET', `/queue/${fixedEntry}`, { token });
  ok(fixedBilling.json.amountRequired === false, 'a fixed service does not demand an amount');
  ok(fixedBilling.json.suggestedAmount?.amount === 35000, 'a fixed service pre-fills its price');
  const fixedOut = await call('POST', `/queue/${fixedEntry}/checkout`, { token });
  ok(fixedOut.status === 200, 'fixed-price checkout still derives its total from an empty body');

  console.log('MULTI-SERVICE VISITS');
  // A visit is routinely more than one thing ("haircut AND a hair spa"). Picking one used to drop
  // the rest: the wait engine sized the visit by the first service and checkout rang up its price
  // alone. Multi-select reuses the primary + queue_entry_extra model (migration 0025), so these
  // assertions pin the two numbers that silently broke — DURATION and TOTAL.
  const spa = services.json.data.find((s) => s.name === 'Hair Spa');   // 60 min / ₹800
  ok(!!spa && haircut.durationMinutes === 30 && spa.durationMinutes === 60, 'fixtures: Haircut 30m, Hair Spa 60m');

  // A longer visit must consume a longer hole, or the next customer is offered an overlapping time.
  const oneSvc = await call('GET', `/public/businesses/sharp-cuts/slots?date=${ymd(nextOpen)}&serviceIds=${haircut.id}`);
  const twoSvc = await call('GET', `/public/businesses/sharp-cuts/slots?date=${ymd(nextOpen)}&serviceIds=${haircut.id},${spa.id}`);
  ok(
    twoSvc.json.slots.length < oneSvc.json.slots.length,
    `a two-service visit books a longer slot (${twoSvc.json.slots.length} vs ${oneSvc.json.slots.length})`,
  );

  // Join the waitlist with both.
  const multiJoin = await call('POST', '/public/businesses/sharp-cuts/queue', {
    body: { name: 'Multi Meera', phone: '+919555000901', serviceIds: [haircut.id, spa.id] },
  });
  ok(multiJoin.status === 201, 'join the waitlist with two services');
  ok(multiJoin.json.serviceName === 'Haircut + Hair Spa', `both services in the label (got ${multiJoin.json.serviceName})`);
  const multiEntry = multiJoin.json.ticketId;

  await call('POST', `/queue/${multiEntry}/start`, { token });
  const multiBill = await call('GET', `/queue/${multiEntry}`, { token });
  ok(multiBill.json.extras.some((x) => x.label === 'Hair Spa'), 'the second service is itemised as an extra');
  ok(
    multiBill.json.suggestedAmount?.amount === 115000,
    `checkout totals BOTH services (₹${(multiBill.json.suggestedAmount?.amount ?? 0) / 100}, expected ₹1150)`,
  );

  // An unknown service id is refused, never silently dropped — a quietly cheaper visit is the
  // exact failure this feature exists to prevent.
  const bogus = await call('POST', '/public/businesses/sharp-cuts/queue', {
    body: { name: 'Bogus Bob', phone: '+919555000903', serviceIds: [haircut.id, '00000000-0000-4000-8000-000000000000'] },
  });
  ok(bogus.status === 404, `an unknown service id is refused (got ${bogus.status})`);

  // Booking → check-in must carry EVERY service across, or the price collapses at the counter.
  const twoSlot = twoSvc.json.slots[0];
  const multiBook = await call('POST', '/public/businesses/sharp-cuts/appointments', {
    body: { name: 'Booked Bina', phone: '+919555000902', serviceIds: [haircut.id, spa.id], slotStart: twoSlot.startAt },
  });
  ok(multiBook.status === 201 && multiBook.json.serviceName === 'Haircut + Hair Spa', 'book an appointment with two services');
  const checkedIn = await call('POST', `/appointments/${multiBook.json.appointmentId}/check-in`, { token });
  ok(checkedIn.status === 201, 'check in the two-service appointment');
  const ciEntry = checkedIn.json.entry.id;
  await call('POST', `/queue/${ciEntry}/start`, { token });
  const ciBill = await call('GET', `/queue/${ciEntry}`, { token });
  ok(
    ciBill.json.suggestedAmount?.amount === 115000,
    `check-in carries both services into checkout (₹${(ciBill.json.suggestedAmount?.amount ?? 0) / 100}, expected ₹1150)`,
  );

  // The single-service form every already-shipped client sends must keep working unchanged.
  const legacy = await call('POST', '/public/businesses/sharp-cuts/queue', {
    body: { name: 'Legacy Lata', phone: '+919555000904', serviceId: haircut.id },
  });
  ok(legacy.status === 201 && legacy.json.serviceName === 'Haircut', 'the legacy single serviceId still works');

  console.log('APPOINTMENTS + CHECK-IN');
  const appts = await call('GET', '/appointments', { token });
  ok(appts.status === 200 && appts.json.data.length >= 1, 'appointments list (today)');
  const confirmable = appts.json.data.find((a) => a.status === 'confirmed');
  const checkin = await call('POST', `/appointments/${confirmable.id}/check-in`, { token });
  ok(checkin.status === 201 && checkin.json.entry, 'appointment check-in → queue entry');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
