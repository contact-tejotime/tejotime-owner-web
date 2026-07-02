// End-to-end smoke test against the running server + seeded Sharp Cuts data.
const BASE = 'http://localhost:8080/api/v1';
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
  const login = await call('POST', '/auth/login', { body: { handle: 'sharpcuts', password: 'password123' } });
  ok(login.status === 200 && login.json.accessToken, 'login returns access token');
  const token = login.json.accessToken;
  ok(login.json.business?.slug === 'sharp-cuts', 'login returns business');
  const bad = await call('POST', '/auth/login', { body: { handle: 'sharpcuts', password: 'wrong' } });
  ok(bad.status === 401, 'wrong password → 401');
  const me = await call('GET', '/auth/me', { token });
  ok(me.status === 200 && me.json.user, 'GET /auth/me works');

  console.log('QUEUE (read)');
  let q = await call('GET', '/queue?view=grouped', { token });
  ok(q.status === 200 && q.json.seats?.length === 3, 'grouped queue has 3 seats');
  const john = seatOf(q.json.seats, 'John');
  ok(john.serving && john.servingName === 'Aisha Khan', 'John serving Aisha');
  ok(john.cards[1].rightText === '~45 min', 'first John waiter ETA ~45 min');
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
  ok(site.status === 200 && site.json.services.length === 4, 'microsite returns 4 services');
  ok(site.json.staff.length === 3 && typeof site.json.live.waitMinutes === 'number', 'microsite staff + live wait');
  const avail = await call('GET', '/public/businesses/sharp-cuts/availability');
  ok(avail.status === 200 && 'queueCount' in avail.json, 'availability endpoint');
  const join = await call('POST', '/public/businesses/sharp-cuts/queue', { body: { serviceId: haircut.id, name: 'Public Joe', phone: '+919555000111', preferredStaffId: 'any' } });
  ok(join.status === 201 && /^A-\d+$/.test(join.json.token), `join issues token (${join.json.token})`);
  const ticket = await call('GET', `/public/tickets/${join.json.ticketId}`);
  ok(ticket.status === 200 && typeof ticket.json.ahead === 'number', 'ticket status readable');
  const leave = await call('DELETE', `/public/tickets/${join.json.ticketId}`);
  ok(leave.status === 200 && leave.json.ok, 'leave queue works');

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
