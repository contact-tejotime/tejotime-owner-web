/**
 * Self-check for lib/country-currency.ts (`npm run test:country-currency` from the repo root).
 *
 * The admin Create store form starts a new store in its phone country's currency (client review
 * row 29, 2026-10-05): a US store must not start in ₹. Plain TS, no runner, like draft-check.ts.
 */
import { currencyForCountry } from "../country-currency";
import { CURRENCY_BY_CODE } from "../currencies";
import { COUNTRIES } from "../countries";

let pass = 0;
let fail = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  ✗ ${msg}`);
  }
};

const cases: [string | null | undefined, string | null][] = [
  ["US", "USD"], // the form's default phone country
  ["us", "USD"],
  ["IN", "INR"],
  ["CA", "CAD"],
  ["GB", "GBP"],
  ["AE", "AED"],
  ["DE", "EUR"],
  ["FR", "EUR"],
  ["AU", "AUD"],
  ["PR", "USD"], // shares +1 with the US
  ["ZZ", null], // unknown → keep the form's currency
  ["", null],
  [null, null],
];
for (const [iso2, want] of cases) {
  const got = currencyForCountry(iso2);
  check(got === want, `${JSON.stringify(iso2)} → ${want} (got ${got})`);
}

// Every answer must be a currency the select can show.
for (const c of COUNTRIES) {
  const code = currencyForCountry(c.iso2);
  if (code !== null) check(!!CURRENCY_BY_CODE[code], `${c.iso2} maps to ${code}, which is in the currency list`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
