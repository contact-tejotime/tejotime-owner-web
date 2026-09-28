// Migration 0030 (optional stylists / services), exercised against a REAL migrated Postgres.
//
// WHY THIS IS NOT PART OF smoke-rest.mjs
//   A store with no stylists cannot be reached over HTTP from the seeded data: Sharp Cuts has
//   three chairs, the owner API cannot delete the last ones while they hold entries, and the seed
//   creates no platform admin to provision a fresh empty store. The behaviour under test lives in
//   plpgsql (`_queue_renumber`, `queue_start`, `queue_move`, `queue_checkout`), so this drives
//   those functions directly.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate
//   DATABASE_URL=<throwaway> node scripts/smoke-seatless.mjs
//
//   It needs a MIGRATED database, not a seeded one, and does not touch the seed tenant.
//   DATABASE_URL must be exported explicitly — this file deliberately does NOT load backend/.env,
//   so it can never fall through to whatever database that file happens to point at.
//
// SAFETY
//   Everything happens inside ONE transaction that is always rolled back, so nothing persists and
//   there is no cleanup (and runs are independent — unlike smoke-rest.mjs). Failures that are
//   EXPECTED (a refused start, a refused checkout) are wrapped in savepoints so they do not abort
//   the transaction.
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (this script does not read backend/.env on purpose).');
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: /sslmode=require|railway|proxy\.rlwy/i.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});

const q = async (text, params) => (await client.query(text, params)).rows;

/** Call a queue_* function the way backend/src/db/rpc.ts does — named args — returning its jsonb. */
async function rpc(fn, args) {
  const keys = Object.keys(args);
  const sql = `select ${fn}(${keys.map((k, i) => `${k} := $${i + 1}`).join(', ')}) as r`;
  const rows = await q(sql, keys.map((k) => args[k]));
  return rows[0].r;
}

let sp = 0;
/** Run something that is EXPECTED to raise `TEJO:<code>`; returns the code raised, or null. */
async function raised(fn) {
  const name = `s${++sp}`;
  await client.query(`savepoint ${name}`);
  try {
    await fn();
    await client.query(`release savepoint ${name}`);
    return null;
  } catch (e) {
    await client.query(`rollback to savepoint ${name}`);
    const m = /TEJO:([A-Z_]+)/.exec(String(e.message));
    return m ? m[1] : `OTHER(${e.message})`;
  }
}

const waitingOrder = async (biz) =>
  (await q(
    `select customer_name, position from queue_entry
      where business_id = $1 and status = 'waiting' and staff_id is null
      order by position, joined_at`,
    [biz],
  )).map((r) => `${r.customer_name}:${r.position}`);

async function add(biz, name, extra = {}) {
  return rpc('queue_add', {
    p_business_id: biz,
    p_name: name,
    p_phone: null,
    p_service_id: extra.serviceId ?? null,
    p_staff_id: extra.staffId ?? null,
    p_position: extra.position ?? 'end',
    p_source: 'walk_in',
  });
}

async function main() {
  await client.connect();
  await client.query('begin');
  try {
    const slug = `smoke-seatless-${Date.now()}`;
    const [{ id: biz }] = await q(
      `insert into business (slug, name, category) values ($1, 'Seatless Smoke', 'Salon & Barber') returning id`,
      [slug],
    );

    console.log('SEATLESS LANE: positions are maintained (they were stuck at the 1000000 sentinel)');
    const a = await add(biz, 'A');
    const b = await add(biz, 'B');
    const c = await add(biz, 'C');
    ok(a.staff_id === null && b.staff_id === null, 'entries queue with no seat');
    ok(JSON.stringify(await waitingOrder(biz)) === JSON.stringify(['A:0', 'B:1', 'C:2']), `end-of-queue adds are contiguous 0..n-1 (got ${(await waitingOrder(biz)).join(' ')})`);

    const d = await add(biz, 'D', { position: 'next' });
    ok((await waitingOrder(biz))[0] === 'D:0', `"Next up" lands at the head (got ${(await waitingOrder(biz)).join(' ')})`);

    const moved = await raised(() => rpc('queue_move', { p_business_id: biz, p_entry_id: c.id, p_to_index: 0 }));
    ok(moved === null, `a seatless entry can be reordered (queue_move raised ${moved})`);
    ok((await waitingOrder(biz))[0] === 'C:0', `…and it moved to the head (got ${(await waitingOrder(biz)).join(' ')})`);

    console.log('SEATLESS LANE: several people can be in service at once');
    const s1 = await raised(() => rpc('queue_start', { p_business_id: biz, p_entry_id: d.id }));
    const s2 = await raised(() => rpc('queue_start', { p_business_id: biz, p_entry_id: c.id }));
    ok(s1 === null && s2 === null, `two entries start with no SEAT_BUSY (got ${s1} / ${s2})`);
    const [{ n: serving }] = await q(`select count(*)::int as n from queue_entry where business_id = $1 and status = 'in_service'`, [biz]);
    ok(serving === 2, `both are in service (got ${serving})`);
    ok((await waitingOrder(biz)).join(' ') === 'A:0 B:1', `the waiters close ranks (got ${(await waitingOrder(biz)).join(' ')})`);

    console.log('CHECKOUT: an entry with NO service and no add-ons must be given an amount');
    const noAmt = await raised(() => rpc('queue_checkout', { p_business_id: biz, p_entry_id: d.id }));
    ok(noAmt === 'AMOUNT_REQUIRED', `no service + no amount → AMOUNT_REQUIRED (got ${noAmt}) — it used to bank a free visit`);
    const [{ n: stillServing }] = await q(`select count(*)::int as n from queue_entry where id = $1 and status = 'in_service'`, [d.id]);
    ok(stillServing === 1, 'the refused checkout changed nothing');
    const neg = await raised(() => rpc('queue_checkout', { p_business_id: biz, p_entry_id: d.id, p_amount_paise: -1 }));
    ok(neg === 'INVALID_STATE', `a negative amount is refused (got ${neg})`);

    const done = await rpc('queue_checkout', { p_business_id: biz, p_entry_id: d.id, p_amount_paise: 25000 });
    ok(Number(done.amount_paise) === 25000, `an explicit amount is banked (got ${done.amount_paise})`);
    ok(done.promoted === null, 'a seatless lane does NOT auto-promote (the owner starts the next entry)');
    const [{ amt }] = await q(`select amount_paise as amt from visit where id = $1`, [done.visit_id]);
    ok(Number(amt) === 25000, `the visit ledger carries it (got ${amt})`);
    ok((await waitingOrder(biz)).join(' ') === 'A:0 B:1', 'the waiters were left alone');

    console.log('CHECKOUT: priced services still derive; unpriced ones still demand an amount');
    const [{ id: fixedSvc }] = await q(
      `insert into service (business_id, name, duration_minutes, price_paise, price_type) values ($1, 'Cut', 30, 30000, 'fixed') returning id`, [biz]);
    const [{ id: unsetSvc }] = await q(
      `insert into service (business_id, name, duration_minutes, price_paise, price_type) values ($1, 'Consult', 30, 0, 'unset') returning id`, [biz]);
    const f = await add(biz, 'Fixed', { serviceId: fixedSvc });
    const u = await add(biz, 'Unset', { serviceId: unsetSvc });
    await rpc('queue_start', { p_business_id: biz, p_entry_id: f.id });
    await rpc('queue_start', { p_business_id: biz, p_entry_id: u.id });
    const fDone = await rpc('queue_checkout', { p_business_id: biz, p_entry_id: f.id });
    ok(Number(fDone.amount_paise) === 30000, `a fixed service derives its price with no amount (got ${fDone.amount_paise})`);
    const uNo = await raised(() => rpc('queue_checkout', { p_business_id: biz, p_entry_id: u.id }));
    ok(uNo === 'AMOUNT_REQUIRED', `an unpriced service still needs an amount (got ${uNo})`);
    const uYes = await rpc('queue_checkout', { p_business_id: biz, p_entry_id: u.id, p_amount_paise: 12000 });
    ok(Number(uYes.amount_paise) === 12000, `…and takes the typed one (got ${uYes.amount_paise})`);

    console.log('REAL SEAT: one person per chair is still enforced, and it still auto-promotes');
    const [{ id: chair }] = await q(`insert into staff (business_id, name) values ($1, 'Chair 1') returning id`, [biz]);
    const p1 = await add(biz, 'P1', { staffId: chair });
    const p2 = await add(biz, 'P2', { staffId: chair });
    await rpc('queue_start', { p_business_id: biz, p_entry_id: p1.id });
    const busy = await raised(() => rpc('queue_start', { p_business_id: biz, p_entry_id: p2.id }));
    ok(busy === 'SEAT_BUSY', `a second start on the same chair → SEAT_BUSY (got ${busy})`);
    const p1Done = await rpc('queue_checkout', { p_business_id: biz, p_entry_id: p1.id, p_amount_paise: 100 });
    ok(p1Done.promoted?.name === 'P2', `finishing P1 promotes P2 (got ${JSON.stringify(p1Done.promoted)})`);
  } finally {
    await client.query('rollback');
    await client.end();
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
