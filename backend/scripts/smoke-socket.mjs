// Realtime smoke test: assert owner + customer sockets receive events on mutations.
import { io } from 'socket.io-client';
const BASE = 'http://localhost:8080/api/v1';
const ORIGIN = 'http://localhost:8080';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function once(socket, event, timeout = 4000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeout);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

async function main() {
  const login = await call('POST', '/auth/login', { body: { handle: 'sharpcuts', password: 'password123' } });
  const token = login.json.accessToken;
  const services = await call('GET', '/services?active=true', { token });
  const haircut = services.json.data.find((s) => s.name === 'Haircut');

  console.log('OWNER SOCKET');
  const owner = io(`${ORIGIN}/owner`, { auth: { token }, transports: ['websocket'] });
  const connected = await once(owner, 'connected');
  ok(!!connected, 'owner socket connects (JWT handshake)');

  const createdP = once(owner, 'queue:entry.created');
  const snapshotP = once(owner, 'queue:snapshot');
  await call('POST', '/queue', { token, body: { name: 'Sock Walk', phone: '+919000111222', serviceId: haircut.id, staffId: 'auto', position: 'end' } });
  const created = await createdP;
  const snapshot = await snapshotP;
  ok(!!created && created.source === 'walk_in', 'owner receives queue:entry.created');
  ok(!!snapshot && Array.isArray(snapshot.seats), 'owner receives queue:snapshot with seats');

  console.log('OWNER SOCKET AUTH REJECTION');
  const badOwner = io(`${ORIGIN}/owner`, { auth: { token: 'garbage' }, transports: ['websocket'] });
  const err = await new Promise((r) => { badOwner.on('connect_error', (e) => r(e.message)); setTimeout(() => r(null), 3000); });
  ok(err === 'unauthorized', 'owner socket rejects bad token');
  badOwner.close();

  console.log('CUSTOMER TICKET SOCKET');
  const join = await call('POST', '/public/businesses/sharp-cuts/queue', { body: { serviceId: haircut.id, name: 'Sock Cust', phone: '+919000333444', preferredStaffId: 'any' } });
  const { ticketId, socket: sinfo } = join.json;
  const cust = io(`${ORIGIN}/customer`, { auth: { businessId: sinfo.businessId, ticketId, ticketKey: sinfo.ticketKey }, transports: ['websocket'] });
  await once(cust, 'connected');
  const updatedP = once(cust, 'ticket:updated', 5000);
  // Trigger a queue change in the same business → ticket rebroadcast.
  await call('POST', '/queue', { token, body: { name: 'Trigger', phone: '+919000555666', serviceId: haircut.id, staffId: 'auto', position: 'end' } });
  const updated = await updatedP;
  ok(!!updated && typeof updated.ahead === 'number', 'customer receives ticket:updated on queue change');

  const availP = once(cust, 'availability:updated', 5000);
  await call('POST', '/queue', { token, body: { name: 'Trigger2', phone: '+919000777888', serviceId: haircut.id, staffId: 'auto', position: 'end' } });
  const avail = await availP;
  ok(!!avail && typeof avail.queueCount === 'number', 'customer receives availability:updated');

  owner.close();
  cust.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await wait(200);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
