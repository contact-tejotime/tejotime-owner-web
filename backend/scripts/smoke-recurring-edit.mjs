// End-to-end smoke test for recurring appointments PHASE 2 (docs/recurring-appointments.md):
// moving one visit and changing all future visits, over real HTTP against a running server +
// seeded Sharp Cuts data. The customer side uses the series' manage token, the owner side a login.
//
// What HTTP cannot reach is in scripts/smoke-recurring-sweep.ts (the job across weeks of dates,
// Book another time, and the race checks) — run that too.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate && npm run seed && npm run dev
//   node scripts/smoke-recurring-edit.mjs              # SMOKE_BASE_URL / SMOKE_SLUG to override
//
// Its own script because of `limiters.publicWrite` (20 public writes per hour per IP):
// smoke-recurring.mjs spends 8, this one about 11 — run it against a freshly started API.
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
const SLUG = process.env.SMOKE_SLUG ?? 'sharp-cuts';
const OWNER_PHONE = '919399385943';
const OWNER_PASSWORD = 'password123';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const stamp = String(Date.now()).slice(-6);
const phone = (n) => `+91922${stamp}${n}`;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (isoStr, n) => new Date(new Date(isoStr).getTime() + n * 86_400_000).toISOString();
const addYmd = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function main() {
  const site = await call('GET', `/public/businesses/${SLUG}`);
  ok(site.status === 200, 'microsite loads');
  const haircut = site.json.services.find((s) => s.name === 'Haircut') ?? site.json.services[0];
  const [lisa, john] = site.json.staff;
  ok(!!haircut && !!lisa && !!john, `fixtures: ${haircut?.name}, ${lisa?.name}, ${john?.name}`);

  // A day 2–5 out with a free time for Lisa, so +7 and +14 are inside the 20-day horizon.
  let day = null, slot = null;
  for (let i = 2; i <= 5 && !slot; i += 1) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
    const r = await call('GET', `/public/businesses/${SLUG}/slots?date=${ymd(d)}&serviceIds=${haircut.id}&staffId=${lisa.id}`);
    if (r.json.slots?.length >= 6) { day = ymd(d); slot = r.json.slots[Math.floor(r.json.slots.length * 0.4)]; }
  }
  ok(!!slot, `found a free time: ${day} ${slot?.label}`);
  const book = (ph, startAt, repeat, staffId = lisa.id) =>
    call('POST', `/public/businesses/${SLUG}/appointments`, {
      body: { name: 'Edit Smoke', phone: ph, serviceIds: [haircut.id], preferredStaffId: staffId, slotStart: startAt, smsOptIn: false, reviewSmsOptIn: false, repeat },
    });

  // A free time with John between `from` and `to` days after `day`, looked up rather than assumed:
  // the throwaway database keeps every earlier run's bookings, so a fixed "slot + n days" is
  // eventually taken (409) or lands on the closed Sunday, and the case under test never runs.
  const freeWithJohn = async (from, to) => {
    for (let i = from; i <= to; i += 1) {
      const r = await call('GET', `/public/businesses/${SLUG}/slots?date=${addYmd(day, i)}&serviceIds=${haircut.id}&staffId=${john.id}`);
      const free = r.json.slots?.[Math.floor((r.json.slots?.length ?? 0) / 2)];
      if (free) return free.startAt;
    }
    return undefined;
  };

  console.log('SETUP');
  const weekly = await book(phone(1), slot.startAt, { everyDays: 7, end: { type: 'count', count: 3 } });
  ok(weekly.status === 201 && weekly.json.series?.visits?.length === 3, `weekly × 3 booked (${weekly.status}, ${weekly.json.series?.visits?.length} visits)`);
  const T = { 'x-series-token': weekly.json.series.manageToken };
  const [v1, v2, v3] = weekly.json.series.visits;
  const other = await book(phone(2), await freeWithJohn(1, 4), { everyDays: 14, end: { type: 'never' } }, john.id);
  ok(other.status === 201, 'another customer’s series booked');

  console.log('CUSTOMER — MOVE ONE VISIT');
  const none = await call('GET', `/public/series/slots?date=${day}`);
  ok(none.status === 404, `no token → 404 (got ${none.status})`);
  const s1 = await call('GET', `/public/series/slots?date=${addYmd(day, 1)}&appointmentId=${v1.appointmentId}`, { headers: T });
  ok(s1.status === 200 && s1.json.slots?.length > 0, 'the token lists times to move the first visit to');
  ok(s1.json.lastDay === addYmd(s1.json.today, 20), `the range ends at today+20 (${s1.json.today} → ${s1.json.lastDay})`);
  const target = s1.json.slots[1];
  const moved = await call('POST', `/public/series/visits/${v1.appointmentId}/reschedule`, { headers: T, body: { slotStart: target.startAt } });
  ok(moved.status === 200, `moved to ${target.label} the next day (${moved.status})`);
  const mv = moved.json.visits?.find((v) => v.appointmentId === v1.appointmentId);
  ok(mv?.moved === true && mv?.scheduledStartAt === target.startAt, 'it shows as moved, at the new time');
  const far = await call('POST', `/public/series/visits/${v2.appointmentId}/reschedule`, {
    headers: T, body: { slotStart: `${addYmd(s1.json.today, 21)}T06:30:00.000Z` },
  });
  ok(far.status === 409, `today+21 → 409 (got ${far.status})`);
  const foreign = await call('POST', `/public/series/visits/${other.json.series.visits[0].appointmentId}/reschedule`, {
    headers: T, body: { slotStart: target.startAt },
  });
  ok(foreign.status === 404, `another customer’s visit → 404 (got ${foreign.status})`);

  console.log('OWNER');
  const login = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  ok(login.status === 200, 'owner login');
  const tok = login.json.accessToken;
  // Block Lisa at the series' new time on the 3rd date, by moving a one-off there (owners reach 60 days).
  const fromDate = addYmd(day, 7);
  const thirdDate = addYmd(day, 14);
  const newTimes = await call('GET', `/public/series/slots?date=${fromDate}&fromDate=${fromDate}`, { headers: T });
  ok(newTimes.status === 200 && newTimes.json.slots?.length > 2, 'times for the change on the from-date');
  const newTime = newTimes.json.slots.find((s) => s.startAt !== v2.scheduledStartAt) ?? newTimes.json.slots[0];
  const newTimeOnThird = plusDays(newTime.startAt, 7);
  const oneOff = await book(phone(3), plusDays(slot.startAt, 2), undefined, lisa.id);
  ok(oneOff.status === 201, 'a one-off booking to move');
  const ownerSlots = await call('GET', `/appointments/${oneOff.json.appointmentId}/slots?date=${thirdDate}&staffId=${lisa.id}`, { token: tok });
  ok(ownerSlots.status === 200 && ownerSlots.json.lastDay === addYmd(ownerSlots.json.today, 60), 'owner range ends at today+60');
  const block = await call('POST', `/appointments/${oneOff.json.appointmentId}/reschedule`, {
    token: tok, body: { slotStart: newTimeOnThird, staffId: lisa.id },
  });
  ok(block.status === 200 && block.json.rescheduledAt, `owner moves the one-off onto ${thirdDate} (${block.status})`);

  console.log('CUSTOMER — CHANGE ALL FUTURE VISITS');
  const change = { fromDate, slotStart: newTime.startAt };
  const preview = await call('POST', '/public/series/preview-change', { headers: T, body: change });
  ok(preview.status === 200 && preview.json.conflicts?.includes(thirdDate), `preview flags ${thirdDate} as taken (${preview.json.conflicts})`);
  const refused = await call('POST', '/public/series/change', { headers: T, body: change });
  ok(refused.status === 409 && refused.json.error?.code === 'CHANGE_CONFLICTS', `change without a choice → 409 CHANGE_CONFLICTS (got ${refused.status})`);
  ok((refused.json.error?.details ?? []).some((d) => d.rule === thirdDate), 'it names the date');
  const before = await call('GET', '/public/series', { headers: T });
  ok(before.json.visits?.find((v) => v.appointmentId === v2.appointmentId)?.status === 'confirmed', 'nothing was changed by the refusal');
  const applied = await call('POST', '/public/series/change', {
    headers: T, body: { ...change, resolutions: [{ date: thirdDate, skip: true }] },
  });
  ok(applied.status === 200, `change with "skip ${thirdDate}" → 200 (${applied.status})`);
  const after = applied.json.visits ?? [];
  ok(after.some((v) => v.scheduledStartAt === newTime.startAt && v.status === 'confirmed'), `${fromDate} is now at ${newTime.label}`);
  ok(after.some((v) => v.cancelReason === 'skipped' && new Date(v.scheduledStartAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === thirdDate), `${thirdDate} is skipped`);
  ok(!after.some((v) => v.cancelReason === 'superseded'), 'replaced visits are not shown to the customer');
  ok(after.find((v) => v.appointmentId === v1.appointmentId)?.moved === true, 'the visit moved by hand earlier is untouched');

  const detail = await call('GET', `/appointments/series/${weekly.json.series.seriesId}`, { token: tok });
  ok(detail.status === 200 && !detail.json.visits.some((v) => v.cancelReason === 'superseded'), 'owner series detail hides replaced visits');
  const dayList = await call('GET', `/appointments?date=${fromDate}`, { token: tok });
  ok(!dayList.json.data?.some((v) => v.cancelReason === 'superseded'), 'owner day list hides replaced visits');

  console.log('OWNER — NEVER ONTO A REGULAR’S NOT-YET-BOOKED DATE');
  const fortnightly = await book(phone(4), await freeWithJohn(3, 6), { everyDays: 14, end: { type: 'never' } }, john.id);
  ok(fortnightly.status === 201, 'a fortnightly regular with John');
  const regularThird = plusDays(fortnightly.json.series.visits[0].scheduledStartAt, 28); // not booked yet
  const oneOff2 = await book(phone(5), await freeWithJohn(4, 9), undefined, john.id);
  ok(oneOff2.status === 201, `a one-off with John to move (${oneOff2.status})`);
  const onRegular = await call('POST', `/appointments/${oneOff2.json.appointmentId}/reschedule`, {
    token: tok, body: { slotStart: regularThird, staffId: john.id },
  });
  ok(onRegular.status === 409, `moving onto the regular’s 3rd date (not booked yet) → 409 (got ${onRegular.status})`);
  const lostIssue = await call('POST', '/appointments/series/issues/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f/book', {
    token: tok, body: { slotStart: regularThird },
  });
  ok(lostIssue.status === 404, `Book another time on an unknown item → 404 (got ${lostIssue.status})`);
}

main()
  .catch((e) => { fail++; console.error('  ✗ CRASH:', e); })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
