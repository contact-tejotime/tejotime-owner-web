// End-to-end smoke test for recurring appointments (docs/recurring-appointments.md), over real
// HTTP against a running server + seeded Sharp Cuts data: a customer books a repeating visit, the
// slot is held against another customer, the manage link works (and only with its token), and the
// owner sees the series, skips, pauses, resumes and cancels it. Also: the store switch, and
// check-in now putting a booked customer on the stylist they booked.
//
// The hourly job's behaviour over weeks of dates is NOT here — HTTP cannot move the clock. That is
// scripts/smoke-recurring-sweep.mts (same throwaway database, drives the job with an injected now).
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate && npm run seed && npm run dev
//   node scripts/smoke-recurring.mjs                   # SMOKE_BASE_URL / SMOKE_SLUG to override
//
// Its own script because of `limiters.publicWrite` (20 public writes per hour per IP): this one
// spends 8. Run it against a freshly started API if other smoke scripts ran first (the limiter is
// in-memory; a restart clears it). It books under its own unique phone numbers, so it needs no
// re-seed between runs — but it does check a customer in, which leaves a ticket in today's queue.
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
const phone = (n) => `+91933${stamp}${n}`; // unique per run and per case
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (iso, n) => new Date(new Date(iso).getTime() + n * 86_400_000).toISOString();

async function main() {
  const site = await call('GET', `/public/businesses/${SLUG}`);
  ok(site.status === 200, 'microsite loads');
  ok(site.json.recurringEnabled === true, 'the store offers repeating bookings (recurringEnabled on by default)');
  const haircut = site.json.services.find((s) => s.name === 'Haircut') ?? site.json.services[0];
  const stylist = site.json.staff[0];
  ok(!!haircut && !!stylist, `fixtures: ${haircut?.name} with ${stylist?.name}`);

  // A day 2–6 days out with a free time, so the weekly series' 2nd and 3rd dates (+7, +14) are
  // both inside the 20-day horizon — and the 2nd is inside the public window, where another
  // customer could try to take it.
  let day = null, slot = null;
  for (let i = 2; i <= 6 && !slot; i += 1) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
    const r = await call('GET', `/public/businesses/${SLUG}/slots?date=${ymd(d)}&serviceIds=${haircut.id}&staffId=${stylist.id}`);
    // A late time: earlier smoke runs book the first slots of the day.
    if (r.json.slots?.length) { day = ymd(d); slot = r.json.slots[Math.floor(r.json.slots.length * 0.7)]; }
  }
  ok(!!slot, `found a free time: ${day} ${slot?.label}`);
  const repeat = { everyDays: 7, end: { type: 'count', count: 3 } };

  console.log('PREVIEW');
  const preview = await call('POST', `/public/businesses/${SLUG}/series-preview`, {
    body: { serviceIds: [haircut.id], preferredStaffId: stylist.id, slotStart: slot.startAt, repeat },
  });
  ok(preview.status === 200 && preview.json.dates?.length === 3, `preview lists the 3 visits (got ${preview.json.dates?.length})`);
  ok(preview.json.dates?.[0]?.status === 'ok', 'the first date is bookable');
  ok(preview.json.totalVisits === 3, 'preview says 3 visits in total');

  console.log('BOOK A REPEATING APPOINTMENT');
  const bookBody = (ph, startAt, extra = {}) => ({
    name: 'Series Smoke', phone: ph, serviceIds: [haircut.id], preferredStaffId: stylist.id, slotStart: startAt,
    smsOptIn: false, reviewSmsOptIn: false, ...extra,
  });
  const booked = await call('POST', `/public/businesses/${SLUG}/appointments`, { body: bookBody(phone(1), slot.startAt, { repeat }) });
  ok(booked.status === 201, `weekly × 3 booked (${booked.status})`);
  const series = booked.json.series;
  ok(/^[A-Za-z0-9_-]{16}$/.test(series?.manageToken ?? ''), 'the response carries a manage token');
  ok((series?.visits?.length ?? 0) + (series?.skipped?.length ?? 0) === 3, `all 3 dates booked or reported (${series?.visits?.length} booked, ${series?.skipped?.length} skipped)`);
  const second = series?.visits?.find((v) => v.scheduledStartAt === plusDays(slot.startAt, 7));

  console.log('ONE OPEN SERIES PER PHONE');
  const again = await call('POST', `/public/businesses/${SLUG}/appointments`, { body: bookBody(phone(1), plusDays(slot.startAt, 1), { repeat }) });
  ok(again.status === 409 && again.json.error?.code === 'SERIES_EXISTS', `a second series for the same phone → 409 SERIES_EXISTS (got ${again.status})`);

  console.log('THE SLOT IS HELD');
  if (second) {
    const clash = await call('POST', `/public/businesses/${SLUG}/appointments`, { body: bookBody(phone(2), second.scheduledStartAt) });
    ok(clash.status === 409 && clash.json.error?.code === 'SLOT_UNAVAILABLE', `another customer cannot take the 2nd visit's time (got ${clash.status})`);
  } else {
    ok(true, 'the 2nd date was already taken before this run — reported as skipped, nothing to hold');
  }

  console.log('MANAGE LINK (TOKEN)');
  const tokenHeaders = { 'x-series-token': series.manageToken };
  const view = await call('GET', '/public/series', { headers: tokenHeaders });
  ok(view.status === 200 && view.json.everyDays === 7, 'the token opens the series');
  ok(view.json.visits?.length === series.visits.length, `it lists the upcoming visits (${view.json.visits?.length})`);
  const wrong = await call('GET', '/public/series', { headers: { 'x-series-token': 'X'.repeat(16) } });
  ok(wrong.status === 404, `a wrong token → 404 (got ${wrong.status})`);
  const none = await call('GET', '/public/series');
  ok(none.status === 404, `no token → 404 (got ${none.status})`);

  console.log('OWNER');
  const login = await call('POST', '/auth/login', { body: { phone: OWNER_PHONE, password: OWNER_PASSWORD } });
  ok(login.status === 200 && login.json.accessToken, 'owner login');
  const token = login.json.accessToken;
  const list = await call('GET', '/appointments/series', { token });
  const mine = list.json.data?.find((s) => s.id === series.seriesId);
  ok(list.status === 200 && !!mine, 'the series is in the Regulars list');
  ok(mine?.everyDays === 7 && mine?.status === 'active' && mine?.staffId === stylist.id, 'with its rhythm, status and stylist');
  const dayList = await call('GET', `/appointments?date=${day}`, { token });
  const firstRow = dayList.json.data?.find((a) => a.id === booked.json.appointmentId);
  ok(firstRow?.seriesId === series.seriesId, 'the first visit carries seriesId (the repeat icon)');
  const detail = await call('GET', `/appointments/series/${series.seriesId}`, { token });
  ok(detail.status === 200 && detail.json.visits?.length >= series.visits.length, 'series detail lists its visits');

  console.log('SKIP ONE VISIT');
  if (second) {
    const skip = await call('POST', `/public/series/visits/${second.appointmentId}/skip`, { headers: tokenHeaders });
    ok(skip.status === 200, `customer skips the 2nd visit with the token (${skip.status})`);
    const after = await call('GET', `/appointments/series/${series.seriesId}`, { token });
    const v = after.json.visits?.find((x) => x.id === second.appointmentId);
    ok(v?.status === 'cancelled' && v?.cancelReason === 'skipped', 'owner sees it as skipped');
    ok(after.json.series?.status === 'active', 'the rest of the series carries on');
    const again2 = await call('POST', `/public/series/visits/${second.appointmentId}/skip`, { headers: tokenHeaders });
    ok(again2.status === 422, `skipping it twice → 422 (got ${again2.status})`);
  }
  const notSeries = await call('POST', `/appointments/${booked.json.appointmentId}/skip`, { token });
  ok(notSeries.status === 200, `owner can skip a series visit too (${notSeries.status})`);

  console.log('PAUSE / RESUME / CANCEL');
  const paused = await call('POST', `/appointments/series/${series.seriesId}/pause`, { token });
  ok(paused.status === 200 && paused.json.series?.status === 'paused', 'owner pauses the series');
  const pausedTwice = await call('POST', `/appointments/series/${series.seriesId}/pause`, { token });
  ok(pausedTwice.status === 422, `pausing a paused series → 422 (got ${pausedTwice.status})`);
  const resumed = await call('POST', `/appointments/series/${series.seriesId}/resume`, { token, body: {} });
  ok(resumed.status === 200 && resumed.json.series?.status === 'active', 'owner resumes it');
  const cancelled = await call('POST', `/appointments/series/${series.seriesId}/cancel`, { token });
  ok(cancelled.status === 200 && cancelled.json.series?.status === 'cancelled', 'owner cancels the series');
  const stillUp = (cancelled.json.visits ?? []).filter((v) => ['pending', 'confirmed'].includes(v.status) && v.scheduledStartAt > new Date().toISOString());
  ok(stillUp.length === 0, 'no upcoming visit is left booked');
  const custView = await call('GET', '/public/series', { headers: tokenHeaders });
  ok(custView.json.status === 'cancelled', 'the customer’s link shows it cancelled');
  const custCancel = await call('POST', '/public/series/cancel', { headers: tokenHeaders });
  ok(custCancel.status === 422, `cancelling it again from the link → 422 (got ${custCancel.status})`);

  console.log('STORE SWITCH');
  const off = await call('PATCH', '/business', { token, body: { recurringEnabled: false } });
  ok(off.status === 200 && off.json.recurringEnabled === false, 'owner turns repeating bookings off');
  const siteOff = await call('GET', `/public/businesses/${SLUG}`);
  ok(siteOff.json.recurringEnabled === false, 'the store page payload says so');
  const refused = await call('POST', `/public/businesses/${SLUG}/appointments`, {
    body: bookBody(phone(3), plusDays(slot.startAt, 1), { repeat }),
  });
  ok(refused.status === 409 && refused.json.error?.code === 'RECURRING_DISABLED', `a repeating booking is refused (got ${refused.status})`);
  const on = await call('PATCH', '/business', { token, body: { recurringEnabled: true } });
  ok(on.status === 200 && on.json.recurringEnabled === true, 'and back on');

  console.log('CHECK-IN USES THE BOOKED STYLIST');
  // Book the busiest chair: the soonest-seat rule check-in used to apply would not pick it.
  const queue = await call('GET', '/queue', { token });
  const seats = (queue.json.seats ?? []).filter((s) => site.json.staff.some((st) => st.id === s.id));
  const busiest = [...seats].sort((a, b) => a.clearMinutes - b.clearMinutes).at(-1);
  if (!busiest || seats.length < 2) {
    ok(true, 'fewer than two chairs — nothing to tell apart');
  } else {
    let oneOff = null;
    for (let i = 1; i <= 6 && !oneOff; i += 1) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
      const r = await call('GET', `/public/businesses/${SLUG}/slots?date=${ymd(d)}&serviceIds=${haircut.id}&staffId=${busiest.id}`);
      if (r.json.slots?.length) oneOff = r.json.slots.at(-1);
    }
    const b2 = await call('POST', `/public/businesses/${SLUG}/appointments`, {
      body: { ...bookBody(phone(4), oneOff.startAt), preferredStaffId: busiest.id },
    });
    ok(b2.status === 201, `one-off booked with ${busiest.name}, the busiest chair`);
    const checkIn = await call('POST', `/appointments/${b2.json.appointmentId}/check-in`, { token });
    ok(checkIn.status === 201 && checkIn.json.entry?.seatId === busiest.id, `checked in on ${busiest.name}'s chair (got ${checkIn.json.entry?.seatName})`);
  }
}

main()
  .catch((e) => { fail++; console.error('  ✗ CRASH:', e); })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
