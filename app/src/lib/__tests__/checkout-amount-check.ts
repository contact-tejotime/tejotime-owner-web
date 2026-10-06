/**
 * Checkout amount arithmetic: the app's and owner-web's copies must agree, and must add up.
 *
 * Framework-free, like `commission-check.ts`: it runs under the `tsx` that backend/ already depends
 * on, so it adds no dependency and needs no test runner, simulator or bundler.
 *
 *   npm run test:checkout
 *   # or: cd backend && npx tsx ../app/src/lib/__tests__/checkout-amount-check.ts
 *
 * Why: every bug the client reported on the checkout sheet on 2026-10-06 (docs/checkout-add-ons.md)
 * was client arithmetic or a client gate — an unpriced "Hair cut" with ₹100 + ₹45 of add-ons
 * showed an empty box; then a box pre-filled with the add-ons let the haircut be completed without
 * ever being priced. Neither owner surface has a UI test runner (CLAUDE.md §12.6), so this case
 * table is those bugs' regression test. Every case runs through BOTH copies
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
type Extra = Billing['extras'][number] & { pricePaise: number };

/** A billing as `GET /queue/:id` reports it (paise), with the server's own derivations. */
function bill(
  service: { name: string; type: Billing['servicePriceType']; paise?: number } | null,
  extras: Extra[] = [],
): Billing {
  const extrasPaise = extras.reduce((s, x) => s + x.pricePaise, 0);
  const servicePaise = service?.paise ?? 0;
  const amountRequired =
    (service ? service.type !== 'fixed' : extras.length === 0) || extras.some((x) => x.priceRequired);
  return {
    serviceName: service?.name ?? null,
    servicePriceType: service ? service.type : extras.length ? 'fixed' : 'unset',
    serviceAmount: { amount: servicePaise },
    extrasAmount: { amount: extrasPaise },
    suggestedAmount: amountRequired ? null : { amount: servicePaise + extrasPaise },
    extras,
  };
}
const x = (id: string, label: string, pricePaise: number, priceRequired = false): Extra => ({
  id, label, pricePaise, priceRequired,
});

const HAIR_CUT = { name: 'Hair cut', type: 'unset' as const };
const HAIR_WASH = x('w', 'Hair wash', 10000);
const BLOW_DRY = x('b', 'Blow-dry', 20000);

for (const [name, lib] of [
  ['app', appLib],
  ['owner-web', webLib],
] as const) {
  const at = (label: string) => `${name} · ${label}`;

  // ---- parsing ---------------------------------------------------------------------------------
  eq(lib.parseRupees(''), null, at('empty box is not an amount'));
  eq(lib.parseRupees('abc'), null, at('junk is not an amount'));
  eq(lib.parseRupees('-5'), null, at('negative is refused'));
  eq(lib.parseRupees('0'), 0, at('zero is an amount (a free visit is a decision)'));
  eq(lib.parseRupees(' 350 '), 35000, at('rupees → paise, trimmed'));
  eq(lib.parseRupees('249.99'), 24999, at('no float drift'));
  eq(lib.parseRupees('1000000'), 100_000_000, at("the API's cap itself is an amount"));
  eq(lib.parseRupees('1000000.01'), null, at('over the cap is refused (the API would 400)'));
  eq(lib.rupeesText(39950), '399.5', at('paise survive'));

  // ---- the client's case: Hair cut (no price) + Hair wash ₹100 + Blow-dry ₹200 -------------------
  const unpriced = bill(HAIR_CUT, [HAIR_WASH, BLOW_DRY]);
  eq(lib.requiredItems(unpriced), [{ key: 'service', label: 'Hair cut' }], at('the haircut must be priced'));
  eq(lib.initialBox(unpriced), '300', at('the box starts at what is known (the add-ons)'));
  eq(lib.canComplete('300', unpriced, {}), false, at('Complete is disabled until the haircut is priced'));
  eq(lib.missingLabels(unpriced, {}), ['Hair cut'], at('the helper names the haircut'));
  let typed: Record<string, string> = { service: '200' };
  let box = lib.boxAfterPriceChange('300', unpriced, '', '200', typed);
  eq(box, '500', at('typing the haircut price adds it into the box'));
  eq(lib.canComplete(box, unpriced, typed), true, at('and Complete is enabled'));
  eq(lib.boxAfterPriceChange('500', unpriced, '200', '250', { service: '250' }), '550', at('changing it moves by the difference'));
  eq(lib.boxAfterPriceChange('500', unpriced, '200', '', {}), '300', at('clearing it takes it back out'));
  eq(lib.canComplete('300', unpriced, { service: '' }), false, at('and disables Complete again'));
  eq(lib.canComplete('300', unpriced, { service: '0' }), true, at('a free haircut (0) is a decision'));
  eq(lib.canComplete('300', unpriced, { service: 'abc' }), false, at('junk is not a price'));
  eq(lib.boxAfterPriceChange('300', unpriced, '', 'abc', { service: 'abc' }), '300', at('junk typed moves nothing'));

  // A hand correction (discount) survives later typing and later chips.
  eq(lib.boxAfterPriceChange('450', unpriced, '200', '220', { service: '220' }), '470', at('a hand-corrected box keeps its correction'));
  const plusShave = bill(HAIR_CUT, [HAIR_WASH, BLOW_DRY, x('s', 'Shave', 5000)]);
  eq(lib.boxAfterExtrasChange('470', unpriced, plusShave, { service: '220' }), '520', at('a chip adds its price on top'));
  eq(lib.boxAfterExtrasChange('', unpriced, plusShave, { service: '220' }), '570', at('an emptied box re-seeds with known + typed'));
  eq(lib.boxAfterPriceChange('', unpriced, '', '200', { service: '200' }), '500', at('an emptied box re-seeds when a price is typed'));

  // ---- a no-price service picked SECOND (an add-on row the server flags) -----------------------
  const washFirst = bill({ name: 'Hair wash', type: 'fixed', paise: 10000 }, [x('c', 'Hair cut', 0, true)]);
  eq(lib.requiredItems(washFirst), [{ key: 'c', label: 'Hair cut' }], at('picked second: still required'));
  eq(lib.initialBox(washFirst), '100', at('picked second: the box starts at the known ₹100'));
  eq(lib.canComplete('100', washFirst, {}), false, at('picked second: Complete disabled'));
  eq(lib.boxAfterPriceChange('100', washFirst, '', '200', { c: '200' }), '300', at('picked second: typed price added'));
  // Its chip tapped off (a booked service whose label matches a chip): row and typed price go.
  const washOnly = bill({ name: 'Hair wash', type: 'fixed', paise: 10000 });
  eq(lib.boxAfterExtrasChange('300', washFirst, washOnly, {}, 20000), '100', at('a removed required row takes its typed price with it'));
  eq(lib.canComplete('100', washOnly, {}), true, at('and nothing is required any more'));

  // ---- two unpriced services -------------------------------------------------------------------
  const two = bill(HAIR_CUT, [x('p', 'Hair spa', 0, true)]);
  eq(lib.missingLabels(two, {}), ['Hair cut', 'Hair spa'], at('two no-price services: both named'));
  eq(lib.missingLabels(two, { service: '200' }), ['Hair spa'], at('one priced, one still missing'));
  eq(lib.canComplete('200', two, { service: '200', p: '300' }), true, at('both priced: Complete enabled'));
  eq(lib.initialBox(two), '', at('nothing known yet: the box starts empty'));

  // ---- range: no required row (the client's call) ----------------------------------------------
  const range = bill({ name: 'Hair Extensions', type: 'range', paise: 200000 }, [HAIR_WASH]);
  eq(lib.requiredItems(range), [], at('range: no required row'));
  eq(lib.initialBox(range), '100', at('range: starts at the add-ons (the floor is never pre-filled)'));
  eq(lib.canComplete('100', range, {}), true, at('range: the box decides'));

  // ---- a fixed service ---------------------------------------------------------------------------
  const fixed = bill({ name: 'Haircut', type: 'fixed', paise: 35000 });
  eq(lib.initialBox(fixed), '350', at('fixed: pre-filled with the suggestion'));
  eq(lib.canComplete('350', fixed, {}), true, at('fixed: Complete enabled'));
  eq(lib.suggestionDiffers('350', fixed), false, at('fixed: "Suggested" hidden while the box matches'));
  eq(lib.suggestionDiffers('300', fixed), true, at('fixed: shown once the owner changes the box'));
  const fixedPlus = bill({ name: 'Haircut', type: 'fixed', paise: 35000 }, [x('t', 'Touch-up cut', 12300)]);
  eq(lib.boxAfterExtrasChange('350', fixed, fixedPlus), '473', at('fixed: a chip adds its typed price'));
  eq(lib.boxAfterExtrasChange('400', fixed, fixedPlus), '523', at('fixed: a hand correction survives a chip'));
  eq(lib.boxAfterExtrasChange('523', fixedPlus, fixed), '400', at('fixed: taking it off takes its price back off'));
  eq(lib.boxAfterExtrasChange('50', fixedPlus, fixed), '0', at('fixed: never below zero'));

  // ---- no service at all -------------------------------------------------------------------------
  const bare = bill(null);
  eq(lib.requiredItems(bare), [], at('bare: no row to price (the box is the bill)'));
  eq(lib.initialBox(bare), '', at('bare: type the amount'));
  eq(lib.canComplete('', bare, {}), false, at('bare: Complete disabled while the box is empty'));
  const bareShave = bill(null, [x('s', 'Shave', 5000)]);
  eq(lib.boxAfterExtrasChange('', bare, bareShave), '50', at('bare: a chip seeds the box'));
  eq(lib.boxAfterExtrasChange('100', bare, bareShave), '150', at('bare: typed + chip'));
  eq(lib.boxAfterExtrasChange('50', bareShave, bare), '', at('bare: last chip off leaves no ₹0 bill'));

  // ---- the box itself ----------------------------------------------------------------------------
  eq(lib.canComplete('', fixed, {}), false, at('a cleared box disables Complete'));
  eq(lib.canComplete('-1', fixed, {}), false, at('a negative box disables Complete'));
  eq(lib.canComplete('2000000', fixed, {}), false, at('an over-cap box disables Complete'));

  // ---- chip highlight ----------------------------------------------------------------------------
  eq(lib.isExtraOn([HAIR_WASH, BLOW_DRY], 'blow-DRY '), true, at('chip match is case- and space-insensitive'));
  eq(lib.isExtraOn([HAIR_WASH], 'Shave'), false, at('other chips stay off'));
}

console.log(`checkout-amount: ${checks} checks passed (app + owner-web copies agree)`);
