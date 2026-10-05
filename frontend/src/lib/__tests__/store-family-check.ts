/**
 * Framework-free self-check for lib/store-family.ts (`npm run test:family` from the repo root).
 *
 * Pins the matcher's answers as they were when it moved out of components/microsite/domains.ts,
 * so the customer page's wording does not change, and the setup screens offer headings for the same
 * kind of store the page shows. Same pattern as the chat-flow and theme checks: plain TS, no runner.
 */
import { familyFor } from "../store-family";

let pass = 0;
let fail = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  ✗ ${msg}`);
  }
};

const cases: [string | null | undefined, string][] = [
  ["Salon & Barber", "beauty"],
  ["Barber", "beauty"],
  ["Beauty Parlour", "beauty"],
  ["Nail studio", "beauty"], // "nail" is checked before fitness's "studio"
  ["Tattoo", "beauty"],
  ["Hospital", "clinic"],
  ["Dental Clinic", "clinic"],
  ["Pet care", "clinic"],
  ["Restaurant", "food"],
  ["Coffee bar", "food"],
  ["Gym", "fitness"],
  ["Yoga studio", "fitness"],
  // Known quirk kept on purpose: substring matching reads "Coworking Space" as beauty ("spa").
  ["Coworking Space", "beauty"],
  ["Law office", "generic"],
  ["", "generic"],
  [null, "generic"],
  [undefined, "generic"],
];
for (const [category, want] of cases) {
  const got = familyFor(category);
  check(got === want, `${JSON.stringify(category)} → ${want} (got ${got})`);
}
check(familyFor("SALON") === "beauty", "case-insensitive");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
