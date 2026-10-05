// End-to-end smoke test for "My appointments" by phone number (docs/customer-my-appointments.md),
// over real HTTP against a running server + seeded Sharp Cuts data.
//
// What it proves: a customer who books on "device A" can manage everything from "device B" holding
// NOTHING but their phone number. That covers moving and cancelling a one-off booking, and opening
// and skipping visits of their repeating booking. This is the client's decision of 2026-10-05,
// which reverses the old rule "a phone alone never cancels". The fences around it hold:
//  - another customer's number never returns my bookings, and an unknown number returns nothing;
//  - a number without its country code is refused, never guessed as +1;
//  - a move stays within today … today+20, and a wrong key opens nothing.
//
// RUNNING IT
//   cd backend && DATABASE_URL=<throwaway> npm run migrate && npm run seed && npm run dev
//   node scripts/smoke-my-appointments.mjs              # SMOKE_BASE_URL / SMOKE_SLUG to override
//
// Its own script because of `limiters.publicWrite` (20 public writes per hour per IP): this one
// spends 11. Run it against a FRESHLY STARTED API (the limiter is in-memory; a restart clears it) —
// a 429 here is the harness, not a regression. It books under its own unique phone numbers, so it
// needs no re-seed between runs.
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/api/v1';
const SLUG = process.env.SMOKE_SLUG ?? 'sharp-cuts';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

async function call(method, path, { body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// Unique per run so repeated runs never collide with each other's bookings.
const stamp = String(Date.now()).slice(-7);
const PHONE_ME = `+91944${stamp}`;
const PHONE_OTHER = `+91945${stamp}`;
const PHONE_NOBODY = `+91946${stamp}`;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (iso, n) => new Date(new Date(iso).getTime() + n * 86_400_000).toISOString();
const daysOut = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };

async function main() {
  const site = await call('GET', `/public/businesses/${SLUG}`);
  ok(site.status === 200, 'microsite loads');
  const haircut = site.json.services.find((s) => s.name === 'Haircut') ?? site.json.services[0];
  const stylist = site.json.staff[0];
  ok(!!haircut && !!stylist, `fixtures: ${haircut?.name} with ${stylist?.name}`);

  // Two free times on a day 2–6 days out: one for the one-off, a later one for the weekly series
  // (whose next dates, +7 and +14, are inside the 20-day horizon and so already booked).
  let offset = 0, oneOffSlot = null, seriesSlot = null, otherSlot = null;
  for (let i = 2; i <= 6 && !seriesSlot; i += 1) {
    const r = await call('GET', `/public/businesses/${SLUG}/slots?date=${ymd(daysOut(i))}&serviceIds=${haircut.id}&staffId=${stylist.id}`);
    const slots = r.json.slots ?? [];
    if (slots.length >= 4) {
      offset = i;
      otherSlot = slots[Math.floor(slots.length * 0.1)];
      oneOffSlot = slots[Math.floor(slots.length * 0.4)];
      seriesSlot = slots[Math.floor(slots.length * 0.8)];
    }
  }
  ok(!!oneOffSlot && !!seriesSlot, `found free times ${offset} days out: ${oneOffSlot?.label} and ${seriesSlot?.label}`);
  const book = (phone, slot, extra = {}) =>
    call('POST', `/public/businesses/${SLUG}/appointments`, {
      body: {
        name: 'My Appts Smoke', phone, serviceIds: [haircut.id], preferredStaffId: stylist.id, slotStart: slot.startAt,
        smsOptIn: false, reviewSmsOptIn: false, ...extra,
      },
    });

  console.log('DEVICE A — BOOK');
  const oneOff = await book(PHONE_ME, oneOffSlot);
  ok(oneOff.status === 201, `a one-off booking (${oneOff.status})`);
  const series = await book(PHONE_ME, seriesSlot, { repeat: { everyDays: 7, end: { type: 'count', count: 3 } } });
  ok(series.status === 201 && !!series.json.series?.manageToken, `a weekly repeating booking (${series.status})`);
  const other = await book(PHONE_OTHER, otherSlot);
  ok(other.status === 201, `another customer books too (${other.status})`);

  console.log('DEVICE B — NOTHING SAVED, ONLY THE PHONE NUMBER');
  const lookup = await call('POST', `/public/businesses/${SLUG}/appointments/lookup`, { body: { phone: PHONE_ME } });
  ok(lookup.status === 200, `lookup by phone (${lookup.status})`);
  const mine = lookup.json.appointments ?? [];
  const found = mine.find((a) => a.appointmentId === oneOff.json.appointmentId);
  ok(found?.appointmentKey === oneOff.json.appointmentKey && found?.canChange === true, 'it lists the one-off WITH its key');
  const seriesVisits = mine.filter((a) => a.seriesId === series.json.series.seriesId);
  ok(seriesVisits.length === series.json.series.visits.length, `it lists the series' booked visits (${seriesVisits.length})`);
  ok(lookup.json.series?.[0]?.manageToken === series.json.series.manageToken, 'it returns the series manage token');
  ok(!mine.some((a) => a.appointmentId === other.json.appointmentId), "another customer's booking is never in my list");
  const body = JSON.stringify(lookup.json);
  ok(!body.includes('My Appts Smoke') && !body.includes(PHONE_ME.slice(3)), 'nothing else about the customer comes back (no name, no phone)');

  console.log('DEVICE B — MOVE THE ONE-OFF');
  const keyHdr = { 'x-appointment-key': found.appointmentKey };
  const id = found.appointmentId;
  const target = ymd(daysOut(offset + 1));
  const slots = await call('GET', `/public/appointments/${id}/slots?date=${target}`, { headers: keyHdr });
  ok(slots.status === 200 && slots.json.lastDay === ymd(daysOut(20)), `slots offered up to today+20 (${slots.json.lastDay})`);
  const to = slots.json.slots?.[Math.floor((slots.json.slots?.length ?? 0) / 2)];
  ok(!!to, `a free time on ${target}: ${to?.label}`);
  const tooFar = await call('POST', `/public/appointments/${id}/reschedule`, {
    body: { key: found.appointmentKey, slotStart: plusDays(oneOffSlot.startAt, 21 - offset + 1) },
  });
  ok(tooFar.status === 409 && tooFar.json.error?.code === 'SLOT_UNAVAILABLE', `today+22 → 409 SLOT_UNAVAILABLE (got ${tooFar.status})`);
  const wrongKey = found.appointmentKey.slice(0, -1) + (found.appointmentKey.endsWith('0') ? '1' : '0');
  const stranger = await call('POST', `/public/appointments/${id}/reschedule`, { body: { key: wrongKey, slotStart: to.startAt } });
  ok(stranger.status === 404, `a wrong key cannot move it (got ${stranger.status})`);
  const moved = await call('POST', `/public/appointments/${id}/reschedule`, { body: { key: found.appointmentKey, slotStart: to.startAt } });
  ok(moved.status === 200 && moved.json.scheduledStartAt === to.startAt && !!moved.json.rescheduledAt, 'moved, and marked as moved');
  const freed = await call('GET', `/public/businesses/${SLUG}/slots?date=${ymd(daysOut(offset))}&serviceIds=${haircut.id}&staffId=${stylist.id}`);
  ok(freed.json.slots?.some((s) => s.startAt === oneOffSlot.startAt), 'the old time is offered again');

  console.log('DEVICE B — CANCEL THE ONE-OFF');
  const cancelled = await call('POST', `/public/appointments/${id}/cancel`, { body: { key: found.appointmentKey } });
  ok(cancelled.status === 200 && cancelled.json.status === 'cancelled' && cancelled.json.canChange === false, 'cancelled with the looked-up key');

  console.log('DEVICE B — MANAGE THE REPEATING BOOKING WITH THE LOOKED-UP TOKEN');
  const tokenHdr = { 'x-series-token': lookup.json.series[0].manageToken };
  const view = await call('GET', '/public/series', { headers: tokenHdr });
  ok(view.status === 200 && view.json.everyDays === 7, 'the token opens the series');
  const toSkip = view.json.visits?.[1] ?? view.json.visits?.[0];
  const skip = await call('POST', `/public/series/visits/${toSkip?.appointmentId}/skip`, { headers: tokenHdr });
  ok(skip.status === 200, `a visit is skipped with it (${skip.status})`);

  console.log('THE FENCES');
  const nobody = await call('POST', `/public/businesses/${SLUG}/appointments/lookup`, { body: { phone: PHONE_NOBODY } });
  ok(nobody.status === 200 && nobody.json.appointments?.length === 0 && nobody.json.series?.length === 0, 'an unknown number gets empty lists');
  const bare = await call('POST', `/public/businesses/${SLUG}/appointments/lookup`, { body: { phone: PHONE_ME.slice(3) } });
  ok(bare.status === 400, `a number without its country code → 400, never guessed as +1 (got ${bare.status})`);
  // The waitlist is unchanged: /track by phone still never returns a ticket key (smoke-selfservice.mjs).
}

main()
  .catch((e) => { fail++; console.error('  ✗ CRASH:', e); })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
