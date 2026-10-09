/**
 * Store page link → pop-up — self-check for "Open a pop-up from a link" (2026-10-09,
 * docs/customer-booking-page-copy-2026-09-06.md): an Instagram ad's `?instagram`, and the general
 * `?open=checkin` / `?open=book`, open the matching pop-up; nothing else in the query string does.
 *
 * Framework-free, like status-copy-check.ts: it runs under the `tsx` backend/ already depends on,
 * so frontend/ gains no test runner (CLAUDE.md §12.6).
 *
 *   npm run test:open-intent
 *   # or: cd backend && npx tsx ../frontend/src/components/microsite/__tests__/open-intent-check.ts
 *
 * It checks how a link is read and cleaned. What it does NOT cover: MicrositeClient waiting for a
 * held ticket before opening, or the closed store turning Check in into Book — no browser runner
 * exists (the Tier-2 gap), so those are manual QA.
 *
 * Failures are counted and printed; a non-zero exit code is the signal.
 */

import { readOpenIntent, stripOpenIntent, type OpenIntent } from "../open-intent";

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
function reads(search: string, want: OpenIntent | null) {
  const got = readOpenIntent(search);
  check(got === want, `readOpenIntent(${JSON.stringify(search)}) → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
function strips(search: string, want: string) {
  const got = stripOpenIntent(search);
  check(got === want, `stripOpenIntent(${JSON.stringify(search)}) → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

section("?open= names the pop-up");
reads("?open=checkin", "checkin");
reads("?open=CheckIn", "checkin");
reads("?open=check-in", "checkin");
reads("?open=%20checkin%20", "checkin");
reads("?open=book", "book");
reads("?open=BOOK", "book");

section("a bare ?instagram is the client's ad link, and means Check in");
reads("?instagram", "checkin");
reads("?instagram=1", "checkin");
reads("?instagram=", "checkin");
reads("?instagram&fbclid=PAZXh0bgNhZW0", "checkin");
reads("?utm_source=ig&instagram&igsh=abc123", "checkin");

section("?open wins over ?instagram");
reads("?open=book&instagram", "book");
reads("?instagram&open=book", "book");

section("anything else opens nothing");
reads("", null);
reads("?", null);
reads("?open=", null);
reads("?open=foo", null);
reads("?open=queue", null);
reads("?utm_source=ig&utm_medium=social&igsh=abc123", null);
reads("?fbclid=PAZXh0bgNhZW0", null);
reads("?Instagram", null); // keys are case-sensitive; the ad link is lower-case
reads("?book", null);

section("the owner's Appearance preview never opens a pop-up");
reads("?preview=1", null);
reads("?preview=1&open=book", null);
reads("?instagram&preview=1", null);
reads("?preview=0&open=book", "book");

section("stripping drops only open and instagram");
strips("?instagram", "");
strips("?open=checkin", "");
strips("?open=book&instagram", "");
strips("", "");
strips("?instagram&fbclid=abc", "?fbclid=abc");
strips("?utm_source=ig&open=book&igsh=x", "?utm_source=ig&igsh=x");
strips("?preview=1&open=book", "?preview=1");
strips("?utm_source=ig", "?utm_source=ig");

section("a stripped link reads as nothing");
for (const s of ["?instagram", "?open=book", "?open=checkin&utm_source=ig", "?instagram&fbclid=abc"]) {
  reads(stripOpenIntent(s), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
