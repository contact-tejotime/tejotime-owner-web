/**
 * Store page open/closed wording — self-check for the client review's row 27 (2026-10-08,
 * docs/store-setup-review-2026-10-05.md): a closed store says "Closed" ONCE, and nothing on the
 * page reads as an invitation to walk in.
 *
 * Framework-free, like chat/flow/__tests__/flow-check.ts: it runs under the `tsx` backend/ already
 * depends on, so frontend/ gains no test runner (CLAUDE.md §12.6).
 *
 *   npm run test:status-copy
 *   # or: cd backend && npx tsx ../frontend/src/components/microsite/__tests__/status-copy-check.ts
 *
 * It checks the strings status-copy.ts hands each slot. What it does NOT cover: whether
 * MicrositeClient renders them in those slots, and which slots a given screen width shows — no
 * browser runner exists (the Tier-2 gap), so those are manual QA.
 *
 * Failures are counted and printed; a non-zero exit code is the signal.
 */

import { statusCopy, type StatusCopy, type StatusInput } from "../status-copy";
import { t, format } from "../../../i18n";

let pass = 0;
let fail = 0;
function check(cond: unknown, msg: string) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log(`  ✗ ${msg}`);
  }
}
function section(name: string) {
  console.log(`· ${name}`);
}

const base: StatusInput = {
  closed: false,
  nextOpenLabel: null,
  liveCount: 0,
  waitMinutes: 0,
  ctaHeading: "Skip the wait — check in from your phone",
  queueWord: "queue",
};

/** Text a visitor reads on a computer: the hero card, the bottom banner, the team note. */
const desktopSlots = (c: StatusCopy) => [c.card.closedHeadline, c.card.detail, c.cta.heading, c.cta.sub, c.teamNote];
/** A phone also shows the bottom bar (CSS, ≤860px). */
const phoneSlots = (c: StatusCopy) => [...desktopSlots(c), c.bar.headline, c.bar.sub === "live" ? null : c.bar.sub];
const saysClosed = (slots: (string | null)[]) => slots.filter((s) => s && /closed/i.test(s));

section("closed: \"Closed\" once, nothing that invites a walk-in");
for (const nextOpenLabel of ["tomorrow at 9:00 AM", null]) {
  for (const liveCount of [0, 3]) {
    const label = `closed, next opening ${nextOpenLabel ? "known" : "unknown"}, ${liveCount ? "people still queued" : "nobody queued"}`;
    const c = statusCopy({ ...base, closed: true, nextOpenLabel, liveCount });
    const desk = saysClosed(desktopSlots(c));
    const phone = saysClosed(phoneSlots(c));
    check(desk.length === 1, `${label}: desktop says closed ${desk.length}× (${JSON.stringify(desk)})`);
    check(phone.length === 1, `${label}: phone says closed ${phone.length}× (${JSON.stringify(phone)})`);
    const invites = phoneSlots(c).filter((s) => s && /available|walk in|no wait|shortest line|check in/i.test(s));
    check(invites.length === 0, `${label}: nothing invites a walk-in (${JSON.stringify(invites)})`);
    if (nextOpenLabel) {
      const opens = format(t.microsite.wait.opensAt, { when: nextOpenLabel });
      check(phoneSlots(c).some((s) => s?.includes(opens)), `${label}: says when it opens`);
    }
  }
}

section("open: wording unchanged");
{
  const idle = statusCopy(base);
  check(idle.card.closedHeadline === null, "open: the card shows the queue count, not a closed headline");
  check(idle.waitHeadline === t.microsite.wait.walkInNow, "open, a chair free: \"No wait right now\"");
  check(idle.card.detail === t.microsite.wait.walkInNow, "open, a chair free: card detail");
  check(idle.cta.heading === base.ctaHeading, "open: the banner keeps the store type's heading");
  check(idle.cta.sub === t.microsite.cta.subEmpty, "open, nobody waiting: banner sub-line");
  check(idle.bar.headline === t.microsite.wait.walkInNow && idle.bar.sub === "live", "open: bar shows the wait and the live line");
  check(idle.teamNote === format(t.microsite.sections.liveNote, { queueWord: "queue" }), "open: team note");

  const busy = statusCopy({ ...base, liveCount: 4, waitMinutes: 25 });
  const wait = format(t.microsite.wait.minWait, { min: 25 });
  check(busy.waitHeadline === wait && busy.card.detail === wait && busy.bar.headline === wait, "open, a wait: \"About 25 min wait\"");
  check(busy.cta.sub === format(t.microsite.cta.subWaiting, { count: 4, wait }), "open, people waiting: banner sub-line");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
