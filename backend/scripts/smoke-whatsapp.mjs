// End-to-end smoke test for WhatsApp to Indian (+91) customers (docs/whatsapp-india.md): the three
// customer messages go to Meta's WhatsApp Cloud API as the approved templates when the customer's
// number is +91, and by Twilio SMS otherwise; Meta's webhook moves the notification row to
// delivered / failed and honours STOP. Real HTTP against a running API + a seeded throwaway
// database, which this script also reads.
//
// No message can leave the machine: the script runs its own stand-in for Meta's Graph API and the
// API under test is pointed at it with WHATSAPP_API_BASE_URL. Phones are +91 5… numbers (no Indian
// mobile number starts with 5) and +1 555 numbers (not an assigned NANP area code).
//
// RUNNING IT
//   cd backend
//   DATABASE_URL=<throwaway> npm run migrate && DATABASE_URL=<throwaway> npm run seed
//   DATABASE_URL=<throwaway> SMS_ENABLED=false WHATSAPP_ENABLED=true \
//     WHATSAPP_API_BASE_URL=http://localhost:8790 WHATSAPP_ACCESS_TOKEN=smoke WHATSAPP_PHONE_NUMBER_ID=smoke \
//     WHATSAPP_APP_SECRET=smoke-app-secret WHATSAPP_WEBHOOK_VERIFY_TOKEN=smoke-verify WHATSAPP_TEST_TO= \
//     npm run dev
//   SMOKE_DATABASE_URL=<the same throwaway> node scripts/smoke-whatsapp.mjs
//
// THE FLAG OFF (run first, against an API started the same way but with WHATSAPP_ENABLED=false):
//   SMOKE_DATABASE_URL=<the same throwaway> node scripts/smoke-whatsapp.mjs --expect-disabled
// proves WHATSAPP_ENABLED works like SMS_ENABLED: the +91 message is recorded on the whatsapp
// channel as deferred, and the stand-in for Meta receives nothing at all.
//
// SMOKE_WA_STUB_PORT (8790), SMOKE_WA_APP_SECRET and SMOKE_WA_VERIFY_TOKEN must match the API's
// WHATSAPP_API_BASE_URL / WHATSAPP_APP_SECRET / WHATSAPP_WEBHOOK_VERIFY_TOKEN. SMOKE_DATABASE_URL is
// refused when it is the database backend/.env points at — that is the live preprod DB.
//
// It spends 5 public writes (1 with --expect-disabled; publicWrite allows 20/hour) and 1 login,
// sets the Sharp Cuts Google review link, clears Lisa's chair, and leaves its rows behind. It makes
// unique phone numbers per run, so it needs no re-seed between runs. SMOKE_BASE_URL overrides
// the API's address.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
const SLUG = 'sharp-cuts';
const OWNER_PHONE = '919399385943';
const OWNER_PASSWORD = 'password123';
const STUB_PORT = Number(process.env.SMOKE_WA_STUB_PORT ?? 8790);
const APP_SECRET = process.env.SMOKE_WA_APP_SECRET ?? 'smoke-app-secret';
const VERIFY_TOKEN = process.env.SMOKE_WA_VERIFY_TOKEN ?? 'smoke-verify';
const EXPECT_DISABLED = process.argv.includes('--expect-disabled');
const REVIEW_URL = 'https://g.page/r/smoke-whatsapp/review';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// ── The stand-in for Meta's Graph API: records every message the API sends ─────────────────────
const sent = [];
let seq = 0;
const stub = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.method === 'POST' && /\/messages$/.test(req.url ?? '')) {
      const id = `wamid.smoke-${Date.now()}-${++seq}`;
      sent.push({ id, url: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messaging_product: 'whatsapp', contacts: [], messages: [{ id }] }));
      return;
    }
    res.writeHead(404).end();
  });
});

/** POSTs a webhook delivery the way Meta does: signed over the exact bytes. */
async function webhook(value, { secret = APP_SECRET } = {}) {
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value }] }] });
  const res = await fetch(`${BASE}/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` },
    body: raw,
  });
  return res.status;
}

const db = new pg.Client({ connectionString: dbUrl });

// Unique per run: +91 5xxxxxxxxx (never an Indian mobile) and +1 555xxxxxxx.
const stamp = String(Date.now()).slice(-7);
const inPhone = (n) => `+915${String((Number(stamp) * 10 + n) % 1_000_000_000).padStart(9, '0')}`;
const usPhone = (n) => `+1555${String((Number(stamp) + n) % 10_000_000).padStart(7, '0')}`;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const rowsFor = async (column, id) =>
  (
    await db.query(
      `select template, channel, status, provider_message_id, error, to_address from notification where ${column} = $1 order by created_at`,
      [id],
    )
  ).rows;

/** Sends run after the HTTP answer in places (checkout), so give a row a moment to land. */
async function waitForRows(column, id, want, ms = 8000) {
  const until = Date.now() + ms;
  let rows = await rowsFor(column, id);
  while (rows.length < want && Date.now() < until) {
    await sleep(250);
    rows = await rowsFor(column, id);
  }
  return rows;
}

async function main() {
  await new Promise((resolve, reject) => stub.once('error', reject).listen(STUB_PORT, resolve));
  await db.connect();

  const site = await call('GET', `/public/businesses/${SLUG}`);
  const haircut = site.json.services?.find((s) => s.name === 'Haircut');
  const lisa = site.json.staff?.find((s) => s.name === 'Lisa');
  const store = (await db.query('select id, name, phone_full from business where slug = $1', [SLUG])).rows[0];
  ok(site.status === 200 && !!haircut && !!lisa && !!store, 'seed has Sharp Cuts, a Haircut and Lisa');

  // An open day a few days out, so the booking is never inside the 15-minute reminder window.
  let slot = null;
  for (let i = 3; i <= 12 && !slot; i += 1) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
    const r = await call('GET', `/public/businesses/${SLUG}/slots?date=${ymd(d)}&serviceIds=${haircut.id}&staffId=${lisa.id}`);
    if (r.json.slots?.length) slot = r.json.slots;
  }
  ok(!!slot, 'found a day with free times');
  const book = (name, phone, smsOptIn, i) =>
    call('POST', `/public/businesses/${SLUG}/appointments`, {
      body: { name, phone, serviceIds: [haircut.id], preferredStaffId: lisa.id, slotStart: slot[i % slot.length].startAt, smsOptIn, reviewSmsOptIn: smsOptIn },
    });

  console.log('WEBHOOK HANDSHAKE (works whatever WHATSAPP_ENABLED says)');
  const hs = await fetch(`${BASE}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY_TOKEN)}&hub.challenge=4815162342`);
  const hsText = await hs.text();
  if (hs.status !== 200) {
    console.error(`Aborting: the API did not answer the handshake (${hs.status}). Start it with WHATSAPP_WEBHOOK_VERIFY_TOKEN=${VERIFY_TOKEN} (see the header).`);
    process.exit(1);
  }
  ok(hsText === '4815162342', 'the right verify token → the challenge comes back');
  const hsBad = await fetch(`${BASE}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1`);
  ok(hsBad.status === 403, `a wrong verify token → 403 (got ${hsBad.status})`);

  if (EXPECT_DISABLED) {
    console.log('WHATSAPP_ENABLED=false: recorded as WhatsApp, deferred, nothing reaches Meta');
    const off = await book('Smoke Off Asha', inPhone(9), true, 0);
    ok(off.status === 201, `a +91 booking with the box ticked (got ${off.status})`);
    const rows = await waitForRows('appointment_id', off.json.appointmentId, 1);
    if (!rows.length && off.status === 201) {
      console.error('Aborting: the booking left no notification row in SMOKE_DATABASE_URL — it is not the API\'s database.');
      process.exit(1);
    }
    ok(rows.length === 1 && rows[0].channel === 'whatsapp' && rows[0].template === 'booking_confirmed', 'one booking_confirmed row on the whatsapp channel');
    ok(rows[0]?.status === 'failed' && rows[0]?.error === 'WhatsApp send failed or deferred' && !rows[0]?.provider_message_id, `deferred, with no Meta id (status ${rows[0]?.status}, "${rows[0]?.error}")`);
    await sleep(1500);
    ok(sent.length === 0, `the stand-in for Meta received nothing (got ${sent.length} request(s))`);
    return;
  }

  const login = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  ok(login.status === 200 && !!login.json.accessToken, 'owner login');
  const token = login.json.accessToken;
  const setReview = await call('PATCH', '/business', { token, body: { googleReviewUrl: REVIEW_URL } });
  ok(setReview.status === 200, 'the store has a Google review link (message 3 needs one)');

  // ── 1. Booking ────────────────────────────────────────────────────────────────────────────────
  console.log('BOOKING FROM A +91 NUMBER: the booking_confirmed template, on WhatsApp');
  const asha = inPhone(1);
  const a = await book('Smoke Asha Rao', asha, true, 0);
  ok(a.status === 201, `booked with the box ticked (got ${a.status})`);
  let rows = await waitForRows('appointment_id', a.json.appointmentId, 1);
  if (!rows.length) {
    console.error('Aborting: the booking left no notification row in SMOKE_DATABASE_URL — it is not the API\'s database.');
    process.exit(1);
  }
  if (rows[0].channel === 'whatsapp' && rows[0].status === 'sent' && sent.length === 0) {
    console.error('Aborting: the API sent a WhatsApp message, but not to this stand-in. Check WHATSAPP_API_BASE_URL.');
    process.exit(1);
  }
  ok(rows.length === 1 && rows[0].channel === 'whatsapp' && rows[0].template === 'booking_confirmed', 'one booking_confirmed row on the whatsapp channel');
  ok(rows[0].status === 'sent' && rows[0].provider_message_id === sent[0]?.id, "status sent, holding Meta's message id");
  const m = sent[0]?.body;
  ok(m?.to === asha.slice(1) && m?.type === 'template', `Meta got a template message to ${asha.slice(1)} (digits, no +)`);
  ok(m?.template?.name === 'booking_confirmed' && m?.template?.language?.code === 'en', 'template booking_confirmed, language en');
  const p = (m?.template?.components?.[0]?.parameters ?? []).map((x) => x.text);
  ok(
    p.length === 5 && p[0] === 'Smoke' && p[1] === store.name && /^[A-Z][a-z]{2} \d{1,2}$/.test(p[2]) && /^\d{1,2}:\d{2} [AP]M$/.test(p[3]) && p[4].endsWith(`/${store.phone_full}`),
    `variables in order: name, store, date, time, link (${JSON.stringify(p)})`,
  );
  ok(/^Bearer \S+/.test(sent[0]?.auth ?? ''), 'sent with a bearer token');

  console.log('BOOKING FROM A +1 NUMBER: still SMS');
  const before = sent.length;
  const b = await book('Smoke Bob', usPhone(2), true, 1);
  ok(b.status === 201, 'booked');
  rows = await waitForRows('appointment_id', b.json.appointmentId, 1);
  ok(rows.length === 1 && rows[0].channel === 'sms', `recorded on the sms channel (got ${rows[0]?.channel})`);
  ok(sent.length === before, 'and nothing went to Meta');

  console.log('BOX NOT TICKED: nothing');
  const c = await book('Smoke Quiet', inPhone(3), false, 2);
  ok(c.status === 201, 'booked without the box');
  await sleep(1000);
  ok((await rowsFor('appointment_id', c.json.appointmentId)).length === 0 && sent.length === before, 'no row, no message');

  // ── 2. Check in ───────────────────────────────────────────────────────────────────────────────
  /** Empty Lisa's chair through the owner API, so a check-in is first in line. */
  async function clearChair(staffId) {
    for (let i = 0; i < 20; i += 1) {
      const { rows: q } = await db.query(
        `select id, status from queue_entry
          where business_id = $1 and staff_id = $2 and status in ('waiting', 'in_service')
          order by (status = 'in_service') desc, position`,
        [store.id, staffId],
      );
      if (!q.length) return true;
      if (q[0].status === 'in_service') await call('POST', `/queue/${q[0].id}/checkout`, { token, body: { amountPaise: 35000 } });
      else await call('DELETE', `/queue/${q[0].id}`, { token });
    }
    return false;
  }
  const join = (name, phone) =>
    call('POST', `/public/businesses/${SLUG}/queue`, {
      body: { name, phone, serviceIds: [haircut.id], preferredStaffId: lisa.id, smsOptIn: true, reviewSmsOptIn: true },
    });
  /** Start and check out a visit through the owner API — the review request follows checkout. */
  async function serve(entryId) {
    const st = await call('POST', `/queue/${entryId}/start`, { token });
    const co = await call('POST', `/queue/${entryId}/checkout`, { token, body: { amountPaise: 35000 } });
    return st.status === 200 && co.status === 200;
  }

  console.log('CHECK IN FROM A +91 NUMBER: confirmation on WhatsApp, review request after checkout');
  ok(await clearChair(lisa.id), "Lisa's chair cleared");
  const dev = inPhone(4);
  const d = await join('Smoke Dev Mehta', dev);
  ok(d.status === 201 && !!d.json.ticketId, `checked in with the box ticked (got ${d.status})`);
  rows = await waitForRows('queue_entry_id', d.json.ticketId, 1);
  ok(rows.length === 1 && rows[0].channel === 'whatsapp' && rows[0].template === 'booking_confirmed' && rows[0].status === 'sent', 'a WhatsApp confirmation');
  const dWamid = rows[0]?.provider_message_id;
  ok(await serve(d.json.ticketId), 'the owner starts and checks out the visit');
  rows = await waitForRows('queue_entry_id', d.json.ticketId, 2);
  const review = rows.find((r) => r.template === 'review_request');
  ok(review?.channel === 'whatsapp' && review?.status === 'sent', 'a WhatsApp review request after checkout');
  const rv = sent.find((s) => s.id === review?.provider_message_id)?.body;
  const rp = (rv?.template?.components?.[0]?.parameters ?? []).map((x) => x.text);
  ok(rv?.template?.name === 'review_request' && rp[0] === store.name && rp[1] === 'Smoke' && rp[2].endsWith(`/${store.phone_full}/r`), `review_request variables: store, name, short link (${JSON.stringify(rp)})`);

  // ── 3. Webhook: delivery statuses ─────────────────────────────────────────────────────────────
  console.log('WEBHOOK: delivery statuses');
  const status = async (wamid) => (await db.query('select status, error from notification where provider_message_id = $1', [wamid])).rows[0];
  const aWamid = sent[0].id;
  ok((await webhook({ statuses: [{ id: aWamid, status: 'delivered', recipient_id: asha.slice(1) }] })) === 200, 'a signed delivery report → 200');
  ok((await status(aWamid))?.status === 'delivered', 'the booking confirmation is now delivered');
  ok((await webhook({ statuses: [{ id: aWamid, status: 'sent' }] })) === 200 && (await status(aWamid))?.status === 'delivered', 'a late "sent" does not move it back');

  const forged = await webhook({ statuses: [{ id: dWamid, status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] }] }, { secret: 'not-the-app-secret' });
  ok(forged === 401 && (await status(dWamid))?.status === 'sent', `a wrongly signed call → 401, and the row is untouched (got ${forged})`);
  await webhook({ statuses: [{ id: dWamid, status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] }] });
  let ds = await status(dWamid);
  ok(ds?.status === 'failed' && ds?.error === '131026: Message undeliverable', `a signed failure → failed with Meta's code ("${ds?.error}")`);
  await webhook({ statuses: [{ id: dWamid, status: 'delivered' }] });
  ds = await status(dWamid);
  ok(ds?.status === 'failed', 'a "delivered" after the failure does not hide it');

  // ── 4. Webhook: STOP ──────────────────────────────────────────────────────────────────────────
  console.log('WEBHOOK: STOP');
  const eve = inPhone(5);
  const e = await join('Smoke Eve', eve);
  ok(e.status === 201, 'another +91 customer checks in with the box ticked');
  await waitForRows('queue_entry_id', e.json.ticketId, 1);
  const forgedStop = await webhook({ messages: [{ from: eve.slice(1), type: 'text', text: { body: 'STOP' } }] }, { secret: 'not-the-app-secret' });
  const optOut = async () => (await db.query('select sms_opt_out_at from customer where business_id = $1 and phone = $2', [store.id, eve])).rows[0]?.sms_opt_out_at;
  ok(forgedStop === 401 && !(await optOut()), 'a forged STOP → 401, and the customer is still opted in');
  ok((await webhook({ messages: [{ from: eve.slice(1), type: 'text', text: { body: 'Stop' } }] })) === 200, 'the customer replies "Stop" on WhatsApp');
  ok(!!(await optOut()), 'the customer is opted out');
  const sentBefore = sent.length;
  ok(await serve(e.json.ticketId), 'the owner starts and checks out the visit');
  // No consent → no row at all (not even an unsent one), so give a stray one time to appear.
  rows = await waitForRows('queue_entry_id', e.json.ticketId, 2, 2500);
  ok(!rows.some((r) => r.template === 'review_request') && sent.length === sentBefore, `no review request reaches Meta after STOP, and none is stored (${rows.length} row(s): ${rows.map((r) => r.template).join(', ')})`);
}

main()
  .catch((err) => { fail++; console.error(err); })
  .finally(async () => {
    await db.end().catch(() => undefined);
    stub.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
