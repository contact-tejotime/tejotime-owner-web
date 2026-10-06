/**
 * Checkout amount arithmetic: the app's and owner-web's copies must agree, and must add up.
 *
 * Framework-free, like `commission-check.ts`: it runs under the `tsx` that backend/ already depends
 * on, so it adds no dependency and needs no test runner, simulator or bundler.
 *
 *   npm run test:checkout
 *   # or: cd backend && npx tsx ../app/src/lib/__tests__/checkout-amount-check.ts
 *
 * Why: the client's bug of 2026-10-06 (docs/checkout-add-ons.md) was pure client arithmetic — an
 * unpriced "Hair cut" with ₹100 + ₹80 of add-ons showed an empty "Amount to charge" and no total,
 * on the web and the phone alike. Neither owner surface has a UI test runner (CLAUDE.md §12.6), so
 * this case table is that bug's regression test. Every case runs through BOTH copies
 * (`app/src/lib/checkout-amount.ts`, `owner-web/src/lib/checkout-amount.ts`), so a drift in either
 * fails here too.
 *
 * Failures throw. A non-zero exit code is the signal; the log is for humans.
 */

import * as appLib from '../checkout-amount';
import * as webLib from '../../../../owner-web/src/lib/checkout-amount';

let checks = 0;

function eq(actual: unknown, expected: unknown, label: string): void {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

type Billing = appLib.CheckoutBilling;

/** A billing as `GET /queue/:id` reports it. Paise. */
const bill = (servicePriceType: Billing['servicePriceType'], extras: number, suggested: number | null): Billing => ({
  servicePriceType,
  extrasAmount: { amount: extras },
  suggestedAmount: suggested === null ? null : { amount: suggested },
});

for (const [name, lib] of [
  ['app', appLib],
  ['owner-web', webLib],
] as const) {
  const at = (label: string) => `${name} · ${label}`;

  // ---- parsing -------------------------------------------------------------------------------
  eq(lib.parseRupees(''), null, at('empty box is not an amount'));
  eq(lib.parseRupees('   '), null, at('blank box is not an amount'));
  eq(lib.parseRupees('abc'), null, at('junk is not an amount'));
  eq(lib.parseRupees('-5'), null, at('negative is refused'));
  eq(lib.parseRupees('0'), 0, at('zero is an amount (a free visit is a decision)'));
  eq(lib.parseRupees(' 350 '), 35000, at('rupees → paise, trimmed'));
  eq(lib.parseRupees('249.99'), 24999, at('no float drift'));
  eq(lib.rupeesText(35000), '350', at('whole rupees print bare'));
  eq(lib.rupeesText(39950), '399.5', at('paise survive'));

  // ---- the reported bug: an unpriced service with priced add-ons --------------------------------
  // "Hair cut" unset + Hair wash ₹100 + Blow-dry ₹80. The server suggests nothing (correctly).
  const unpriced = bill('unset', 18000, null);
  eq(lib.boxIsTotal(unpriced), false, at('unset: the box is the service price'));
  eq(lib.initialBox(unpriced), '', at('unset: nothing to pre-fill'));
  eq(lib.chargePaise('', unpriced), null, at('unset: nothing charged until the service is priced'));
  eq(lib.chargePaise('200', unpriced), 38000, at('unset: Hair cut 200 + add-ons 180 = 380'));
  eq(lib.chargePaise('0', unpriced), 18000, at('unset: a free haircut still charges the add-ons'));

  // Adding a ₹50 shave to it: the box (the haircut's price) stays, the total moves.
  const unpricedPlusShave = bill('unset', 23000, null);
  eq(lib.boxAfterExtrasChange('200', unpriced, unpricedPlusShave), '200', at('unset: add-on leaves the service price alone'));
  eq(lib.chargePaise('200', unpricedPlusShave), 43000, at('unset: total includes the new add-on'));
  eq(lib.boxAfterExtrasChange('', unpriced, unpricedPlusShave), '', at('unset: empty stays empty'));

  // A range ("Hair Extensions" ₹2,000–₹6,000) works the same way.
  const range = bill('range', 8000, null);
  eq(lib.initialBox(range), '', at('range: nothing to pre-fill'));
  eq(lib.chargePaise('4500', range), 458000, at('range: chosen price + add-ons'));

  // ---- a fixed service: the box is the whole bill, and moves with the add-ons -------------------
  const fixed = bill('fixed', 0, 35000);
  eq(lib.boxIsTotal(fixed), true, at('fixed: the box is the total'));
  eq(lib.initialBox(fixed), '350', at('fixed: pre-filled with the suggestion'));
  eq(lib.chargePaise('350', fixed), 35000, at('fixed: the box is what is charged'));

  const fixedPlus = bill('fixed', 12300, 47300);
  eq(lib.boxAfterExtrasChange('350', fixed, fixedPlus), '473', at('fixed: add-on adds its typed price'));
  eq(lib.boxAfterExtrasChange('400', fixed, fixedPlus), '523', at('fixed: a hand correction survives an add-on'));
  eq(lib.boxAfterExtrasChange('', fixed, fixedPlus), '473', at('fixed: an emptied box re-seeds'));
  eq(lib.boxAfterExtrasChange('523', fixedPlus, fixed), '400', at('fixed: removing takes its price back off'));
  eq(lib.boxAfterExtrasChange('50', fixedPlus, fixed), '0', at('fixed: never below zero'));
  eq(lib.boxAfterExtrasChange('350', fixed, bill('fixed', 4950, 39950)), '399.5', at('fixed: paise add-on'));

  // ---- no service at all: unset until it has an add-on, then fixed with service 0 --------------
  const bare = bill('unset', 0, null);
  const bareShave = bill('fixed', 5000, 5000);
  eq(lib.initialBox(bare), '', at('bare: type the amount'));
  eq(lib.boxAfterExtrasChange('', bare, bareShave), '50', at('bare → add-on: seeded with the add-on'));
  eq(lib.boxAfterExtrasChange('100', bare, bareShave), '150', at('bare → add-on: typed amount + add-on'));
  eq(lib.boxAfterExtrasChange('150', bareShave, bare), '100', at('add-on → bare: back to the typed amount'));
  eq(lib.chargePaise('100', bare), 10000, at('bare: the box is the bill'));

  // ---- chip highlight -------------------------------------------------------------------------
  const extras = [{ label: 'Hair wash' }, { label: 'Blow-dry' }];
  eq(lib.isExtraOn(extras, 'Hair wash'), true, at('chip on when its add-on is on the visit'));
  eq(lib.isExtraOn(extras, 'blow-DRY '), true, at('chip match is case- and space-insensitive'));
  eq(lib.isExtraOn(extras, 'Shave'), false, at('other chips stay off'));
  eq(lib.isExtraOn([], 'Shave'), false, at('no add-ons, no highlight'));
}

console.log(`checkout-amount: ${checks} checks passed (app + owner-web copies agree)`);
