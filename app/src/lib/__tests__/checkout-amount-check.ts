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
 * unpriced "Hair cut" with ₹100 + ₹45 of add-ons showed an empty "Amount to charge", on the web and
 * the phone alike. Neither owner surface has a UI test runner (CLAUDE.md §12.6), so this case table
 * is that bug's regression test. It also pins the client's follow-up the same day: the box is the
 * whole bill, never a separate "service price" box. Every case runs through BOTH copies
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

/** A billing as `GET /queue/:id` reports it. Paise; `suggested` is null for range/unset. */
const bill = (extras: number, suggested: number | null): appLib.CheckoutBilling => ({
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
  // "Hair cut" unset + Hair wash ₹100 + Beard trim ₹45. The server suggests nothing (correctly).
  const unpriced = bill(14500, null);
  eq(lib.initialBox(unpriced), '145', at('unset: the box starts at the add-ons total'));
  eq(lib.initialBox(bill(0, null)), '', at('unset, no add-ons: nothing to pre-fill'));

  // Blow-dry ₹80 typed into the chip popup goes into the total.
  const plusBlowDry = bill(22500, null);
  eq(lib.boxAfterExtrasChange('145', unpriced, plusBlowDry), '225', at('unset: an add-on adds its typed price'));
  eq(lib.boxAfterExtrasChange('345', unpriced, plusBlowDry), '425', at('unset: the haircut typed by hand survives'));
  eq(lib.boxAfterExtrasChange('', unpriced, plusBlowDry), '225', at('unset: an emptied box re-seeds with the add-ons'));
  eq(lib.boxAfterExtrasChange('425', plusBlowDry, unpriced), '345', at('unset: taking it off takes its price back off'));
  eq(lib.boxAfterExtrasChange('100', bill(10000, null), bill(0, null)), '', at('unset: last add-on off leaves no ₹0 bill'));
  eq(lib.boxAfterExtrasChange('', bill(0, null), bill(8000, null)), '80', at('unset: first add-on seeds the box'));

  // A range ("Hair Extensions" ₹2,000–₹6,000) works the same way.
  eq(lib.initialBox(bill(8000, null)), '80', at('range: starts at the add-ons total'));

  // ---- a fixed service: the box starts at the suggestion and moves with the add-ons ------------
  const fixed = bill(0, 35000);
  eq(lib.initialBox(fixed), '350', at('fixed: pre-filled with the suggestion'));
  const fixedPlus = bill(12300, 47300);
  eq(lib.boxAfterExtrasChange('350', fixed, fixedPlus), '473', at('fixed: add-on adds its typed price'));
  eq(lib.boxAfterExtrasChange('400', fixed, fixedPlus), '523', at('fixed: a hand correction survives an add-on'));
  eq(lib.boxAfterExtrasChange('', fixed, fixedPlus), '473', at('fixed: an emptied box re-seeds'));
  eq(lib.boxAfterExtrasChange('523', fixedPlus, fixed), '400', at('fixed: removing takes its price back off'));
  eq(lib.boxAfterExtrasChange('50', fixedPlus, fixed), '0', at('fixed: never below zero'));
  eq(lib.boxAfterExtrasChange('350', fixed, bill(4950, 39950)), '399.5', at('fixed: paise add-on'));

  // ---- no service at all: no suggestion until it has an add-on, then the add-ons total ---------
  const bare = bill(0, null);
  const bareShave = bill(5000, 5000);
  eq(lib.initialBox(bare), '', at('bare: type the amount'));
  eq(lib.boxAfterExtrasChange('', bare, bareShave), '50', at('bare → add-on: seeded with the add-on'));
  eq(lib.boxAfterExtrasChange('100', bare, bareShave), '150', at('bare → add-on: typed amount + add-on'));
  eq(lib.boxAfterExtrasChange('150', bareShave, bare), '100', at('add-on → bare: back to the typed amount'));

  // ---- chip highlight -------------------------------------------------------------------------
  const extras = [{ label: 'Hair wash' }, { label: 'Blow-dry' }];
  eq(lib.isExtraOn(extras, 'Hair wash'), true, at('chip on when its add-on is on the visit'));
  eq(lib.isExtraOn(extras, 'blow-DRY '), true, at('chip match is case- and space-insensitive'));
  eq(lib.isExtraOn(extras, 'Shave'), false, at('other chips stay off'));
  eq(lib.isExtraOn([], 'Shave'), false, at('no add-ons, no highlight'));
}

console.log(`checkout-amount: ${checks} checks passed (app + owner-web copies agree)`);
