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
// The API's own list (import-free file), so a method added on one side alone fails here.
import * as backendEnums from '../../../../backend/src/domain/enums';

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
  // The amount cases below are about the amount: "Paid by" is answered (cash) so it never decides.
  const can = (text: string, billing: Billing, typed: Record<string, string>) =>
    lib.canComplete(text, billing, typed, 'cash');

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
  eq(can('300', unpriced, {}), false, at('Complete is disabled until the haircut is priced'));
  eq(lib.missingLabels(unpriced, {}), ['Hair cut'], at('the helper names the haircut'));
  let typed: Record<string, string> = { service: '200' };
  let box = lib.boxAfterPriceChange('300', unpriced, '', '200', typed);
  eq(box, '500', at('typing the haircut price adds it into the box'));
  eq(can(box, unpriced, typed), true, at('and Complete is enabled'));
  eq(lib.boxAfterPriceChange('500', unpriced, '200', '250', { service: '250' }), '550', at('changing it moves by the difference'));
  eq(lib.boxAfterPriceChange('500', unpriced, '200', '', {}), '300', at('clearing it takes it back out'));
  eq(can('300', unpriced, { service: '' }), false, at('and disables Complete again'));
  eq(can('300', unpriced, { service: '0' }), true, at('a free haircut (0) is a decision'));
  eq(can('300', unpriced, { service: 'abc' }), false, at('junk is not a price'));
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
  eq(can('100', washFirst, {}), false, at('picked second: Complete disabled'));
  eq(lib.boxAfterPriceChange('100', washFirst, '', '200', { c: '200' }), '300', at('picked second: typed price added'));
  // Its chip tapped off (a booked service whose label matches a chip): row and typed price go.
  const washOnly = bill({ name: 'Hair wash', type: 'fixed', paise: 10000 });
  eq(lib.boxAfterExtrasChange('300', washFirst, washOnly, {}, 20000), '100', at('a removed required row takes its typed price with it'));
  eq(can('100', washOnly, {}), true, at('and nothing is required any more'));

  // ---- two unpriced services -------------------------------------------------------------------
  const two = bill(HAIR_CUT, [x('p', 'Hair spa', 0, true)]);
  eq(lib.missingLabels(two, {}), ['Hair cut', 'Hair spa'], at('two no-price services: both named'));
  eq(lib.missingLabels(two, { service: '200' }), ['Hair spa'], at('one priced, one still missing'));
  eq(can('200', two, { service: '200', p: '300' }), true, at('both priced: Complete enabled'));
  eq(lib.initialBox(two), '', at('nothing known yet: the box starts empty'));

  // ---- range: no required row (the client's call) ----------------------------------------------
  const range = bill({ name: 'Hair Extensions', type: 'range', paise: 200000 }, [HAIR_WASH]);
  eq(lib.requiredItems(range), [], at('range: no required row'));
  eq(lib.initialBox(range), '100', at('range: starts at the add-ons (the floor is never pre-filled)'));
  eq(can('100', range, {}), true, at('range: the box decides'));

  // ---- a fixed service ---------------------------------------------------------------------------
  const fixed = bill({ name: 'Haircut', type: 'fixed', paise: 35000 });
  eq(lib.initialBox(fixed), '350', at('fixed: pre-filled with the suggestion'));
  eq(can('350', fixed, {}), true, at('fixed: Complete enabled'));
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
  eq(can('', bare, {}), false, at('bare: Complete disabled while the box is empty'));
  const bareShave = bill(null, [x('s', 'Shave', 5000)]);
  eq(lib.boxAfterExtrasChange('', bare, bareShave), '50', at('bare: a chip seeds the box'));
  eq(lib.boxAfterExtrasChange('100', bare, bareShave), '150', at('bare: typed + chip'));
  eq(lib.boxAfterExtrasChange('50', bareShave, bare), '', at('bare: last chip off leaves no ₹0 bill'));

  // ---- the box itself ----------------------------------------------------------------------------
  eq(can('', fixed, {}), false, at('a cleared box disables Complete'));
  eq(can('-1', fixed, {}), false, at('a negative box disables Complete'));
  eq(can('2000000', fixed, {}), false, at('an over-cap box disables Complete'));

  // ---- chip highlight ----------------------------------------------------------------------------
  eq(lib.isExtraOn([HAIR_WASH, BLOW_DRY], 'blow-DRY '), true, at('chip match is case- and space-insensitive'));
  eq(lib.isExtraOn([HAIR_WASH], 'Shave'), false, at('other chips stay off'));

  // ---- "Paid by" (0042, docs/card-payments-paypal.md): only while Card payments is on ------------
  // Only a US store (priced in dollars) can switch Card payments on, and only then is "Paid by"
  // asked (client 2026-10-16). Switched off, or on any other store, checkout is as it always was:
  // no question, and Complete is ready as soon as the bill is.
  const inUsd = (b: Billing): Billing => ({ ...b, serviceAmount: { ...b.serviceAmount, currency: 'USD' } });
  const inInr = (b: Billing): Billing => ({ ...b, serviceAmount: { ...b.serviceAmount, currency: 'INR' } });
  const cardsOn = (b: Billing): Billing => ({ ...inUsd(b), cardPaymentsEnabled: true });
  const cardsOff = (b: Billing): Billing => ({ ...inUsd(b), cardPaymentsEnabled: false });
  eq(lib.canComplete('350', cardsOn(fixed), {}, null), false, at('cards on, Paid by unanswered: Complete disabled'));
  eq(lib.canComplete('350', cardsOn(fixed), {}, 'card'), true, at('cards on, Paid by answered: Complete enabled'));
  eq(lib.canComplete('', cardsOn(fixed), {}, 'card'), false, at('a method does not excuse an empty box'));
  eq(lib.canComplete('300', cardsOn(unpriced), {}, 'cash'), false, at('nor an unpriced service'));
  eq(lib.canComplete('350', cardsOff(fixed), {}, null), true, at('US store, cards off: no Paid by, Complete as before'));
  eq(lib.canComplete('350', inUsd(fixed), {}, null), true, at('no card flag from the API reads as off'));
  eq(lib.canComplete('300', cardsOff(unpriced), {}, null), false, at('cards off: an unpriced service still blocks'));
  eq(lib.canComplete('350', inInr(fixed), {}, null), true, at('rupee store: no Paid by, Complete as before'));
  eq(lib.canComplete('350', { ...inInr(fixed), cardPaymentsEnabled: true }, {}, null), true,
    at('rupee store: never asked, even with a stray flag'));
  eq(lib.canComplete('350', fixed, {}, null), true, at('no currency known: no Paid by, Complete as before'));
  eq(lib.canComplete('300', inInr(unpriced), {}, null), false, at('rupee store: an unpriced service still blocks'));
  eq(lib.paidByChoices(cardsOn(fixed)), ['card', 'cash'], at('cards on: the sheet shows Card and Cash'));
  eq(lib.paidByChoices(cardsOff(fixed)), [], at('cards off: the sheet shows no Paid by'));
  eq(lib.paidByChoices(inUsd(fixed)), [], at('no card flag: no Paid by'));
  eq(lib.paidByChoices({ ...inInr(fixed), cardPaymentsEnabled: true }), [], at('rupee store: no Paid by'));
  eq(lib.paidByAsked('USD', true), true, at('asked on a US store with cards on'));
  eq(lib.paidByAsked('usd', true), true, at('currency code case does not matter'));
  eq(lib.paidByAsked('USD', false), false, at('not asked with cards off'));
  eq(lib.paidByAsked('USD', undefined), false, at('not asked when the API sends no flag'));
  eq(lib.paidByAsked('EUR', true), false, at('not asked anywhere else'));
  // What a US store MAY record — the API's list, which it checks whether or not the sheet asks.
  eq(lib.paymentMethodsFor('USD'), ['card', 'cash'], at('a US store: Card and Cash'));
  eq(lib.paymentMethodsFor('usd'), ['card', 'cash'], at('currency code case does not matter'));
  eq(lib.paymentMethodsFor('INR'), [], at('a rupee store: no Paid by'));
  eq(lib.paymentMethodsFor(null), [], at('no currency: no Paid by'));
  // The Card payments settings row is offered on a US store whether or not it is switched on yet.
  eq(lib.isUsStore('USD'), true, at('a dollar store is a US store'));
  eq(lib.isUsStore('INR'), false, at('a rupee store is not'));
  // ---- tips (0046, docs/checkout-tips.md) ---------------------------------------------------------
  // The tip is its own figure beside the bill; a % chip is only a shortcut that fills the field.
  eq([...lib.TIP_PERCENTS], [10, 15], at('quick picks are 10% and 15%'));
  eq(lib.tipFromPercent(35000, 10), 3500, at('10% of $350'));
  eq(lib.tipFromPercent(35000, 15), 5250, at('15% of $350'));
  eq(lib.tipFromPercent(1999, 15), 300, at('rounds to the nearest paisa (299.85 → 300)'));
  eq(lib.tipFromPercent(5, 10), 1, at('half a paisa rounds up'));
  eq(lib.tipFromPercent(-100, 10), 0, at('a negative bill tips nothing'));
  eq(lib.parseTip(''), 0, at('an empty tip field is no tip'));
  eq(lib.parseTip('  '), 0, at('blank is no tip'));
  eq(lib.parseTip('10'), 1000, at('a typed $10'));
  eq(lib.parseTip('2.5'), 250, at('a typed $2.50'));
  eq(lib.parseTip('abc'), null, at('junk is refused'));
  eq(lib.parseTip('-1'), null, at('a negative tip is refused'));
  eq(lib.parseTip('1000000.01'), null, at('over the API cap is refused'));
  eq(lib.tipTextFor('350', 10, ''), '35', at('10% chip fills 10% of the box'));
  eq(lib.tipTextFor('350', 15, ''), '52.5', at('15% chip fills 15% of the box'));
  eq(lib.tipTextFor('400', 15, ''), '60', at('the chip follows a hand-corrected bill'));
  eq(lib.tipTextFor('', 15, ''), '', at('no bill yet: nothing to take a percent of'));
  eq(lib.tipTextFor('0', 10, ''), '', at('a free visit tips nothing'));
  eq(lib.tipTextFor('350', 10, '99'), '35', at('an active chip wins over stale typed text'));
  eq(lib.tipTextFor('350', null, '10'), '10', at('no chip: exactly what was typed ($10)'));
  eq(lib.tipTextFor('999', null, '10'), '10', at('a typed amount ignores the bill'));
  eq(lib.tipTextFor('350', null, ''), '', at('no chip, nothing typed: no tip'));
  eq(lib.totalWithTip('350', '35'), 38500, at('total = bill + tip'));
  eq(lib.totalWithTip('350', ''), 35000, at('no tip: the total is the bill'));
  eq(lib.totalWithTip('', '35'), null, at('no bill: no total'));
  eq(lib.totalWithTip('350', 'x'), null, at('unreadable tip: no total'));
  eq(lib.totalWithTip('1000000', '1'), null, at('a sum above the API cap is not a charge'));
  eq(lib.totalWithTip('999999', '1'), 100_000_000, at('exactly the cap is a charge'));
  eq(lib.tipOk('350', ''), true, at('empty tip is fine'));
  eq(lib.tipOk('350', 'x'), false, at('junk tip is not'));
  eq(lib.tipOk('', '10'), true, at('an unreadable bill is the box’s problem, not the tip’s'));
  eq(lib.tipOk('1000000', '1'), false, at('bill + tip over the cap is refused'));
  // Complete: a tip never blocks it unless it cannot be sent, and it never excuses the rest.
  eq(lib.canComplete('350', fixed, {}, null, ''), true, at('no tip: Complete as before'));
  eq(lib.canComplete('350', fixed, {}, null, '35'), true, at('a tip does not block Complete'));
  eq(lib.canComplete('350', fixed, {}, null, 'x'), false, at('a junk tip blocks Complete'));
  eq(lib.canComplete('350', fixed, {}, null, '-5'), false, at('a negative tip blocks Complete'));
  eq(lib.canComplete('1000000', fixed, {}, null, '1'), false, at('bill + tip over the cap blocks Complete'));
  eq(lib.canComplete('', fixed, {}, null, '35'), false, at('a tip does not excuse an empty box'));
  eq(lib.canComplete('300', unpriced, {}, 'cash', '35'), false, at('nor an unpriced service'));
  eq(lib.canComplete('350', cardsOn(fixed), {}, null, '35'), false, at('nor an unanswered Paid by'));
  eq(lib.canComplete('350', fixed, {}, null), true, at('the old four-argument call still works'));

  for (const cur of ['USD', 'usd', 'INR', 'EUR', 'CAD', null]) {
    eq(lib.paymentMethodsFor(cur), [...backendEnums.paymentMethodsFor(cur)], at(`${cur} list matches the API's`));
    eq(lib.isUsStore(cur), backendEnums.isUsStore(cur), at(`${cur}: US store agrees with the API`));
  }
}

console.log(`checkout-amount: ${checks} checks passed (app + owner-web copies agree)`);
