// End-to-end smoke test for the Check in texts (docs/sms-opt-in-a2p.md, client request 2026-10-06):
// a website check-in with the box ticked gets the approved confirmation, and the approved
// "starts in 15 minutes" text only if it joined with MORE than 15 minutes to wait. Real HTTP
// against a running API + a seeded throwaway database, which this script also reads (and, for
// one thing HTTP cannot move — the clock — writes: it backdates a started visit's started_at,
// exactly as the seed pins Aisha's).
//
// RUNNING IT
//   cd backend
//   DATABASE_URL=<throwaway> npm run migrate && DATABASE_URL=<throwaway> npm run seed
//   DATABASE_URL=<throwaway> SMS_ENABLED=false npm run dev        # nothing leaves for Twilio
//   SMOKE_DATABASE_URL=<the same throwaway> node scripts/smoke-checkin-sms.mjs
//
// SMOKE_DATABASE_URL must be the API's database (the script aborts if its first ticket is not in
// it) and is refused when it is the database backend/.env points at — that is the live preprod DB.
// With SMS_ENABLED=false every text is still recorded as a `notification` row (channel 'sms',
// status 'failed', "deferred"), which is what this asserts on. Phones are +1 555 numbers: 555 is
// not an assigned NANP area code, so even a misconfigured API with SMS on cannot reach anyone.
//
// It spends 5 public writes (publicWrite allows 20/hour), mutates the Sharp Cuts queue (clears
// Lisa's and Mike's chairs), and leaves its rows behind — re-seed between runs, as for smoke-rest.
// SMOKE_BASE_URL points the run at a non-default port.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
const SLUG = 'sharp-cuts';
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Unique per run, so the one-ticket-per-phone-per-day rule never sees a previous run's ticket.
const stamp = String(Date.now()).slice(-7);
const phone = (n) => `+1555${String((Number(stamp) + n) % 10_000_000).padStart(7, '0')}`;

const texts = async (entryId) =>
  (await db.query('select template, channel from notification where queue_entry_id = $1 order by created_at', [entryId])).rows;
const countOf = (rows, template) => rows.filter((r) => r.template === template).length;
const entryRow = async (entryId) =>
  (await db.query('select join_wait_minutes, notified_eta_15_at, status from queue_entry where id = $1', [entryId])).rows[0];

/** The reminder is sent fire-and-forget after the broadcast, so give it a moment to land. */
async function waitForTexts(entryId, template, want, ms = 8000) {
  const until = Date.now() + ms;
  let rows = await texts(entryId);
  while (countOf(rows, template) < want && Date.now() < until) {
    await sleep(250);
    rows = await texts(entryId);
  }
  return rows;
}

async function main() {
  await db.connect();

  const login = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  ok(login.status === 200 && !!login.json.accessToken, 'owner login');
  const token = login.json.accessToken;
  const businessId = (await db.query('select id from business where slug = $1', [SLUG])).rows[0]?.id;

  const site = await call('GET', `/public/businesses/${SLUG}`);
  const haircut = site.json.services?.find((s) => s.name === 'Haircut');
  const lisa = site.json.staff?.find((s) => s.name === 'Lisa');
  const mike = site.json.staff?.find((s) => s.name === 'Mike');
  ok(!!businessId && !!haircut && !!lisa && !!mike, 'seed has Sharp Cuts, a 30-min Haircut, Lisa and Mike');

  /** Empty a chair through the owner API: check out whoever is in service, take the rest off. */
  async function clearChair(staffId) {
    for (let i = 0; i < 20; i += 1) {
      const { rows } = await db.query(
        `select id, status from queue_entry
          where business_id = $1 and staff_id = $2 and status in ('waiting', 'in_service')
          order by (status = 'in_service') desc, position`,
        [businessId, staffId],
      );
      if (!rows.length) return true;
      const e = rows[0];
      if (e.status === 'in_service') await call('POST', `/queue/${e.id}/checkout`, { token, body: { amountPaise: 35000 } });
      else await call('DELETE', `/queue/${e.id}`, { token });
    }
    return false;
  }

  /** A started Haircut with 10 minutes left: started_at moved 20 minutes back. */
  async function startedWithTenLeft(staffId, name) {
    const add = await call('POST', '/queue', { token, body: { name, serviceId: haircut.id, staffId, position: 'end' } });
    const id = add.json.entry?.id;
    await call('POST', `/queue/${id}/start`, { token });
    await db.query(`update queue_entry set started_at = now() - interval '20 minutes' where id = $1`, [id]);
    return id;
  }

  const join = (name, ph, staffId, smsOptIn) =>
    call('POST', `/public/businesses/${SLUG}/queue`, {
      body: { name, phone: ph, serviceIds: [haircut.id], preferredStaffId: staffId, smsOptIn, reviewSmsOptIn: smsOptIn },
    });

  // ── 1. A long wait: confirmation now, the 15-minute text later ──────────────────────────────
  console.log('CHECK IN WITH A LONG WAIT (> 15 min): confirmation now, "starts in 15 minutes" later');
  ok(await clearChair(mike.id), "Mike's chair cleared");
  await startedWithTenLeft(mike.id, 'Smoke Head');
  const behind = await call('POST', '/queue', { token, body: { name: 'Smoke Ahead', serviceId: haircut.id, staffId: mike.id, position: 'end' } });
  const aheadId = behind.json.entry?.id;

  const longPhone = phone(1);
  const long = await join('Smoke Long', longPhone, mike.id, true);
  ok(long.status === 201 && !!long.json.ticketId, `check-in with the box ticked (got ${long.status})`);
  const longId = long.json.ticketId;
  const longRow = await entryRow(longId);
  if (!longRow) {
    console.error('Aborting: the ticket is not in SMOKE_DATABASE_URL — it is not the API\'s database.');
    process.exit(1);
  }
  ok(long.json.waitMinutes > 15, `the customer is told a wait over 15 minutes (got ${long.json.waitMinutes})`);
  ok(longRow.join_wait_minutes === long.json.waitMinutes, `the wait at check-in is stored (${longRow.join_wait_minutes})`);
  let rows = await texts(longId);
  ok(countOf(rows, 'booking_confirmed') === 1 && rows.every((r) => r.channel === 'sms'), 'exactly one confirmation text, on the sms channel');
  ok(countOf(rows, 'appointment_reminder') === 0, 'no 15-minute text yet');

  const dup = await join('Smoke Long', longPhone, mike.id, true);
  ok(dup.json.alreadyInQueue === true && dup.json.ticketId === longId, 'the same number again → "already on the waitlist", same ticket');
  rows = await texts(longId);
  ok(countOf(rows, 'booking_confirmed') === 1, 'and no second confirmation');

  // The visit ahead leaves: 10 minutes left on the chair → the wait drops into 1–15 minutes.
  await call('DELETE', `/queue/${aheadId}`, { token });
  rows = await waitForTexts(longId, 'appointment_reminder', 1);
  ok(countOf(rows, 'appointment_reminder') === 1, 'the wait drops to 15 or less → exactly one "starts in 15 minutes" text');
  await call('POST', '/queue', { token, body: { name: 'Smoke Later', serviceId: haircut.id, staffId: mike.id, position: 'end' } });
  await sleep(1500);
  rows = await texts(longId);
  ok(countOf(rows, 'appointment_reminder') === 1, 'another queue change does not send it again');

  // ── 2. Box not ticked: nothing ──────────────────────────────────────────────────────────────
  console.log('CHECK IN WITHOUT THE BOX: no texts');
  const quiet = await join('Smoke Quiet', phone(2), 'any', false);
  ok(quiet.status === 201, 'check-in without the box');
  await sleep(1000);
  ok((await texts(quiet.json.ticketId)).length === 0, 'no text of any kind is recorded');
  ok((await entryRow(quiet.json.ticketId)).join_wait_minutes === null, 'and no wait is stored for it');

  // ── 3. No wait: confirmation only ───────────────────────────────────────────────────────────
  console.log('CHECK IN WITH NO WAIT: confirmation only');
  ok(await clearChair(lisa.id), "Lisa's chair cleared");
  const now = await join('Smoke Now', phone(3), lisa.id, true);
  ok(now.status === 201 && now.json.waitMinutes === 0, `no wait on a free chair (got ${now.json.waitMinutes})`);
  rows = await texts(now.json.ticketId);
  ok(countOf(rows, 'booking_confirmed') === 1, 'the confirmation is still sent');
  ok((await entryRow(now.json.ticketId)).join_wait_minutes === 0, 'the stored wait is 0');
  await sleep(1000);
  ok(countOf(await texts(now.json.ticketId), 'appointment_reminder') === 0, 'no 15-minute text');
  await call('DELETE', `/queue/${now.json.ticketId}`, { token });

  // ── 4. A short wait (1–15): confirmation only, even though the 15-minute window is open ──────
  console.log('CHECK IN WITH A SHORT WAIT (1-15 min): confirmation only');
  await startedWithTenLeft(lisa.id, 'Smoke Short Head');
  const short = await join('Smoke Short', phone(4), lisa.id, true);
  ok(short.status === 201 && short.json.waitMinutes > 0 && short.json.waitMinutes <= 15, `a short wait (got ${short.json.waitMinutes})`);
  const shortRow = await entryRow(short.json.ticketId);
  ok(shortRow.notified_eta_15_at !== null, 'the one-shot 15-minute claim was taken at check-in');
  await sleep(1500);
  rows = await texts(short.json.ticketId);
  ok(countOf(rows, 'booking_confirmed') === 1 && countOf(rows, 'appointment_reminder') === 0, 'one confirmation and no 15-minute text');
  await call('POST', '/queue', { token, body: { name: 'Smoke Later 2', serviceId: haircut.id, staffId: lisa.id, position: 'end' } });
  await sleep(1500);
  ok(countOf(await texts(short.json.ticketId), 'appointment_reminder') === 0, 'still none after another queue change');
}

main()
  .catch((err) => { fail++; console.error(err); })
  .finally(async () => {
    await db.end().catch(() => undefined);
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
