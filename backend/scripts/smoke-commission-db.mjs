// Migration 0034 (staff commission), exercised against a REAL migrated Postgres.
//
// WHY THIS IS NOT PART OF smoke-commission.mjs
//   The rule under test is about instants — "20% from 02/10 00:00, 30% from 16/10 00:00, and a
//   rate saved at 13:00 does not pay 11:00" — and the API deliberately refuses to create a rate dated in the
//   past or to move the clock. So this inserts dated rates and visits directly and reads them
//   back through the `visit_commission` view, which is the one place commission is computed.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate
//   DATABASE_URL=<throwaway> node scripts/smoke-commission-db.mjs
//
//   It needs a MIGRATED database, not a seeded one, and does not touch the seed tenant.
//   DATABASE_URL must be exported explicitly — this file deliberately does NOT load backend/.env,
//   so it can never fall through to whatever database that file happens to point at.
//
// SAFETY
//   Everything happens inside ONE transaction that is always rolled back, so nothing persists and
//   runs are independent. Statements that are EXPECTED to fail (a duplicate day, an out-of-range
//   rate) run inside savepoints so they do not abort the transaction.
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

let sp = 0;
/** Run something that is EXPECTED to fail; returns the SQLSTATE it raised, or null. */
async function sqlState(fn) {
  const name = `s${++sp}`;
  await client.query(`savepoint ${name}`);
  try {
    await fn();
    await client.query(`release savepoint ${name}`);
    return null;
  } catch (e) {
    await client.query(`rollback to savepoint ${name}`);
    return e.code ?? `OTHER(${e.message})`;
  }
}

// October 2026 in the store's zone (Asia/Kolkata, UTC+5:30), as a half-open UTC window.
const OCT_START = '2026-09-30T18:30:00Z'; // 01/10 00:00 IST
const OCT_END = '2026-10-31T18:30:00Z'; //   01/11 00:00 IST (exclusive)

async function main() {
  await client.connect();
  await client.query('begin');
  try {
    const slug = `smoke-commission-${Date.now()}`;
    const [{ id: biz }] = await q(
      `insert into business (slug, name, category, timezone) values ($1, 'Commission Smoke', 'Salon & Barber', 'Asia/Kolkata') returning id`,
      [slug],
    );
    const [{ id: john }] = await q(`insert into staff (business_id, name) values ($1, 'John') returning id`, [biz]);
    const [{ id: lisa }] = await q(`insert into staff (business_id, name) values ($1, 'Lisa') returning id`, [biz]);

    const rate = (staff, bp, from) =>
      q(`insert into staff_commission_rate (business_id, staff_id, rate_bp, effective_at) values ($1, $2, $3, $4::timestamptz)`,
        [biz, staff, bp, from]);
    const visit = async (staff, paise, at, label) => {
      const [{ id }] = await q(
        `insert into visit (business_id, staff_id, service_name, amount_paise, completed_at)
         values ($1, $2, $3, $4, $5) returning id`,
        [biz, staff, label, paise, at],
      );
      return id;
    };
    /** One visit read back through the view. Dates come back as text: see the migration header. */
    const read = async (id) => {
      const [r] = await q(
        `select rate_bp, commission_paise, local_date::text as local_date,
                to_char(rate_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as rate_from
           from visit_commission where business_id = $1 and visit_id = $2`,
        [biz, id],
      );
      return {
        rate: r.rate_bp,
        commission: r.commission_paise == null ? null : Number(r.commission_paise),
        day: r.local_date,
        from: r.rate_from,
      };
    };

    console.log("20% from 02/10 00:00 IST, 30% from 16/10 00:00 IST");
    await rate(john, 2000, '2026-10-01T18:30:00Z');
    await rate(john, 3000, '2026-10-15T18:30:00Z');

    const v1 = await visit(john, 50000, '2026-10-01T06:30:00Z', 'before any rate'); //    01/10 12:00 IST
    const v2 = await visit(john, 50000, '2026-10-01T18:35:00Z', 'first minutes of 02/10'); // 02/10 00:05 IST
    const v3 = await visit(john, 100000, '2026-10-15T18:00:00Z', 'last half-hour of 15/10'); // 15/10 23:30 IST
    const v4 = await visit(john, 100000, '2026-10-15T19:00:00Z', 'first half-hour of 16/10'); // 16/10 00:30 IST
    const v5 = await visit(john, 1005, '2026-10-20T06:00:00Z', 'rounding'); //                20/10 11:30 IST
    const v6 = await visit(null, 70000, '2026-10-10T06:00:00Z', 'no stylist');
    const v7 = await visit(lisa, 40000, '2026-10-10T06:00:00Z', 'stylist with no rate');

    let r = await read(v1);
    ok(r.rate === null && r.commission === null, `01/10 — before the first rate: no rate, no commission (got ${r.rate}/${r.commission})`);
    r = await read(v2);
    ok(r.day === '2026-10-02', `02/10 00:05 IST is store day 02/10 although its UTC date is 01/10 (got ${r.day})`);
    ok(r.rate === 2000 && r.commission === 10000, `02/10 ₹500 → 20% = ₹100 (got ${r.rate} bp, ${r.commission} paise)`);
    r = await read(v3);
    ok(r.rate === 2000 && r.commission === 20000, `15/10 23:30 IST ₹1,000 → still 20% = ₹200 (got ${r.rate}, ${r.commission})`);
    r = await read(v4);
    ok(r.day === '2026-10-16', `16/10 00:30 IST is store day 16/10 although its UTC date is 15/10 (got ${r.day})`);
    ok(r.rate === 3000 && r.commission === 30000, `16/10 ₹1,000 → 30% = ₹300 (got ${r.rate}, ${r.commission})`);
    ok(r.from === '2026-10-15T18:30:00Z', `…and reports the rate's start instant (got ${r.from})`);
    r = await read(v5);
    ok(r.commission === 302, `₹10.05 × 30% = 301.5 paise rounds half away from zero to 302 (got ${r.commission})`);
    r = await read(v6);
    ok(r.rate === null && r.commission === null, `a visit with no stylist earns no commission (got ${r.rate}/${r.commission})`);
    r = await read(v7);
    ok(r.rate === null && r.commission === null, `a stylist with no rate earns no commission (got ${r.rate}/${r.commission})`);

    console.log('PERIOD TOTALS: the sum of the per-visit lines, never revenue × today\'s rate');
    const [john1031] = await q(
      `select count(*)::int as visits, sum(amount_paise)::bigint as revenue, sum(commission_paise)::bigint as commission
         from visit_commission
        where business_id = $1 and staff_id = $2 and completed_at >= $3 and completed_at < $4`,
      [biz, john, OCT_START, OCT_END],
    );
    ok(Number(john1031.commission) === 10000 + 20000 + 30000 + 302,
      `John's October = 100 + 200 + 300 + 3.02 = ₹603.02 (got ${john1031.commission} paise)`);
    ok(Number(john1031.commission) !== Math.round(Number(john1031.revenue) * 0.3),
      'it is NOT his October revenue × his current 30%');
    const [store] = await q(
      `select sum(amount_paise)::bigint as revenue, coalesce(sum(commission_paise), 0)::bigint as commission
         from visit_commission where business_id = $1 and completed_at >= $2 and completed_at < $3`,
      [biz, OCT_START, OCT_END],
    );
    ok(Number(store.revenue) === 411005, `store revenue counts every visit, rated or not (got ${store.revenue})`);
    ok(Number(store.revenue) - Number(store.commission) === 411005 - 60302,
      `salon keeps = revenue − commission = ${411005 - 60302} (got ${Number(store.revenue) - Number(store.commission)})`);

    console.log('HISTORY STAYS PUT: a later rate never reaches back');
    await rate(john, 4000, '2026-10-24T18:30:00Z');
    const after = await Promise.all([v2, v3, v4, v5].map(read));
    ok(after.map((x) => x.commission).join(',') === '10000,20000,30000,302',
      `adding 40% from 25/10 leaves 02/10–20/10 untouched (got ${after.map((x) => x.commission).join(',')})`);

    console.log('EDITING A STORED INSTANT REPRICES ONLY VISITS AFTER IT');
    await q(`update staff_commission_rate set rate_bp = 2500 where staff_id = $1 and effective_at = '2026-10-15T18:30:00Z'`, [john]);
    ok((await read(v4)).commission === 25000, `changing the 16/10 00:00 row to 25% re-prices that instant onward (got ${(await read(v4)).commission})`);
    ok((await read(v3)).commission === 20000, '…and not a visit from before it');
    await q(`delete from staff_commission_rate where staff_id = $1 and effective_at = '2026-10-15T18:30:00Z'`, [john]);
    r = await read(v4);
    ok(r.rate === 2000 && r.commission === 20000, `deleting that row falls back to the 20% before it (got ${r.rate}, ${r.commission})`);

    console.log('A RATE SAVED AT 13:00 DOES NOT PAY 11:00, AND A 16:00 CHANGE DOES NOT REPRICE 14:00');
    const [{ id: lalu }] = await q(`insert into staff (business_id, name) values ($1, 'Lalu') returning id`, [biz]);
    await rate(lalu, 2000, '2026-10-02T07:30:00Z'); // 13:00 IST
    await rate(lalu, 3000, '2026-10-02T10:30:00Z'); // 16:00 IST
    const morning = await visit(lalu, 100000, '2026-10-02T05:30:00Z', '11:00 IST, before the rate');
    const afternoon = await visit(lalu, 100000, '2026-10-02T08:30:00Z', '14:00 IST, under 20%');
    const evening = await visit(lalu, 100000, '2026-10-02T11:30:00Z', '17:00 IST, under 30%');
    ok((await read(morning)).commission === null, '11:00 has no commission');
    ok((await read(afternoon)).rate === 2000 && (await read(afternoon)).commission === 20000, '14:00 stays at 20% after the 16:00 change');
    ok((await read(evening)).rate === 3000 && (await read(evening)).commission === 30000, '17:00 is 30%');

    console.log('CONSTRAINTS');
    const dup = await sqlState(() => rate(john, 3300, '2026-10-01T18:30:00Z'));
    ok(dup === '23505', `one rate per stylist per instant — the same timestamp is refused (got ${dup})`);
    const second = await sqlState(() => rate(john, 2200, '2026-10-02T07:30:00Z'));
    ok(second === null, 'a second rate later the same day is allowed');
    const big = await sqlState(() => rate(john, 10001, '2026-10-31T18:30:00Z'));
    ok(big === '23514', `a rate above 100% is refused (got ${big})`);
    const neg = await sqlState(() => rate(john, -1, '2026-10-31T18:30:00Z'));
    ok(neg === '23514', `a negative rate is refused (got ${neg})`);
    const zero = await sqlState(() => rate(lisa, 0, '2026-09-30T18:30:00Z'));
    ok(zero === null, '0% is a valid explicit rate (e.g. a stylist moved to salary)');
    ok((await read(v7)).commission === 0, `…and earns 0, not "no rate" (got ${(await read(v7)).commission})`);

    console.log('THE VIEW IS INDEX-FRIENDLY');
    await client.query('set local enable_seqscan = off');
    const plan = (await q(
      `explain select * from visit_commission
        where business_id = '${biz}' and completed_at >= '${OCT_START}' and completed_at < '${OCT_END}'`,
    )).map((row) => row['QUERY PLAN']).join('\n');
    ok(/idx_visit_business_completed/.test(plan), 'filtering on business_id + completed_at reaches idx_visit_business_completed');
    await client.query('set local enable_seqscan = on');

    console.log('DOCUMENTED BEHAVIOUR: a timezone correction re-buckets days, like every other report');
    await q(`update business set timezone = 'UTC' where id = $1`, [biz]);
    r = await read(v2);
    ok(r.day === '2026-10-01' && r.rate === 2000, `the local day moves to 01/10, but the rate is an absolute instant so it stays 20% (got ${r.day}, ${r.rate})`);
    await q(`update business set timezone = 'Asia/Kolkata' where id = $1`, [biz]);

    console.log('CASCADES');
    await q('delete from staff where id = $1', [john]);
    const [{ n: left }] = await q('select count(*)::int as n from staff_commission_rate where staff_id = $1', [john]);
    ok(left === 0, `hard-deleting a stylist removes their rates (got ${left})`);
    r = await read(v4);
    ok(r.rate === null && r.commission === null, 'their visits keep their revenue but carry no commission once the stylist is gone');
  } finally {
    await client.query('rollback');
    await client.end();
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
