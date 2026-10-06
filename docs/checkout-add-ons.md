# Checkout: the amount to charge and add-on chips

**Shipped:** 2026-10-06 · **Applies to:** backend, owner-web, app (iOS + Android) · **Migration:** 0039

The client reported two bugs on the in-service **Customer** sheet. This is the sheet behind a
serving queue card, with "Amount to charge", the add-on chips and "Complete & start next".

1. **No calculated total.** The example was "Hair cut" with no price, plus Hair wash ₹100 and
   Blow-dry ₹80. The amount box was empty and no total was shown anywhere. Both owner surfaces
   pre-filled only from the server's `suggestedAmount`. That figure is deliberately null when the
   main service is `unset` or `range` (CLAUDE.md §7, pricing modes). So the prices that *were*
   known were never added up.
2. **Add-on chips could not be priced or highlighted, and charged twice.**
   - A chip sent `{label, minutes}`, and the backend priced it from a platform-wide list
     (`SERVICE_EXTRAS`): a shave was ₹50 in every store.
   - No chip ever showed as on.
   - A second tap recorded and charged the add-on again.
   - Nothing could take an add-on back off.

## How the sheet works now

### The amount box means one of two things

| Booked service | The box holds | Starts at | When an add-on goes on or off | Complete charges |
|---|---|---|---|---|
| `fixed` price | the **whole bill** | the server's suggestion (service + add-ons) | moves by the add-on's price; a hand-typed correction survives | the box |
| `unset` (no price) or `range` | the **booked service's price only** | empty: someone has to decide | unchanged; the **Total to charge** row moves | box + add-ons |

- **Wording in the `unset`/`range` mode:**
  - The hint names the service: "Hair cut has no price set. Enter its price — add-ons are added
    for you."
  - The range variant quotes the band.
  - The empty box's placeholder reads "Hair cut price".
- **The breakdown:**
  - The booked service sits on its own line (by its own name, via the new `serviceName`).
  - Then each add-on, with its price.
  - Then **Total to charge**. It shows a dash until the service is priced, so the add-ons alone
    are never presented as the bill.
- **Complete with an empty box** is refused with "Enter the price for Hair cut before
  completing." The API's `AMOUNT_REQUIRED` rule is unchanged underneath.
- **An entry with no service at all:**
  - It reports `unset` until it has an add-on, then `fixed` with service = 0 (`billingFor`).
  - The box therefore flips meaning, and moves by the add-on's price on either side of the flip.
    That is right: with no add-ons, "the service's price" and "the whole bill" are the same number.

All of this arithmetic is in **`lib/checkout-amount.ts`**. owner-web and the app each keep a
copy, and the copies must stay identical. Keep the file import-free.

### The add-on chips are a toggle

- **Highlighted (filled with the brand colour, ✓ icon)** while that add-on is on the visit. The
  match is on label, case-insensitively.
  - This includes a service booked with the visit (multi-service, 0025), since those are rows of
    the same `queue_entry_extra` table. For example, a booked "Hair wash" lights the Hair wash
    chip.
- **Tap a plain chip:**
  - A popup asks for its price. The field is always empty: the client chose that over a
    pre-filled default.
  - 0 is allowed (a free add-on); empty or negative is not.
  - On **Add**, the add-on is recorded at exactly that price.
- **Tap a highlighted chip:** it comes off at once, with no popup. Its price leaves the bill, its
  minutes leave the ETA, and its ` + Label` leaves the queue card.

| | owner-web | app |
|---|---|---|
| Popup | `ConfirmDialog` over the sheet (`input.prefix`/`inputMode`/`validate`) | `ConfirmSheet presentation="overlay"`, drawn **inside** `DetailPanel`'s own Modal. iOS will not present a second Modal over an open one. |
| Escape / Android back | Escape closes only the popup (the sheet ignores it while the popup is up) | back closes the popup first, then the panel |
| Chip state | `.dp-chip.is-selected`, `aria-pressed` | `chipOn` style, `accessibilityState.selected` |

The app used to re-read the bill without waiting for the extend to finish, so the read often came
back with the old total. `store.extendService` and `store.removeExtra` now resolve when the API
has answered, and the sheet awaits them.

## API

- **`POST /queue/:id/extend`** takes `{ label, minutes, pricePaise? }`.
  - `pricePaise` is the owner's figure (an integer from 0 to 100,000,000) and wins over the
    catalog.
  - It is optional only for app builds already in the field. Those send no price and still get
    the `SERVICE_EXTRAS` default.
  - A label already on the visit (any case) gets **409 `ALREADY_ADDED`**.
- **`POST /queue/:id/remove-extra`** (new) takes `{ label }`. Guards: `queue:manage`, plus
  `ownRow`, so a staff login can only change its own chair. Results:
  - 200 with the grouped queue view.
  - 404 when no add-on has that label. The booked service is never an add-on.
  - 422 when the customer is not in service.
  - Emits `queue:entry.extra_removed` and a snapshot.
- **`GET /queue/:id`** also returns **`serviceName`**: the booked service on its own, or null.
  `service` on the card carries every add-on ("Hair cut + Hair wash + Blow-dry").
- owner-web BFF: `remove-extra` is on the `api/queue/[id]/[action]` allow-list.

## Database (0039)

- **`queue_extend`** keeps its exact signature, so there is no overload trap. It now raises
  `TEJO:ALREADY_ADDED` when a row with the same label (case-insensitive) exists.
  - **Rule: one row per add-on label per visit.**
  - That rule also stops app builds that still add on every tap from double-charging.
  - A restaurant cannot record two coffees as two chips. That is accepted for now, since the chips
    have no quantity.
- **`queue_remove_extra(p_business_id, p_entry_id, p_label)`**:
  - Takes the advisory lock and only acts on `in_service`.
  - Deletes every row with that label. Visits from before 0039 can hold duplicates.
  - Takes their minutes off `extra_minutes`, floored at 0.
  - Strips matching ` + ` segments from `service_name`, never the first one: that is the booked
    service.

`queue_checkout` is unchanged: an explicit `amountPaise` still wins, and the derived total is still
service + Σ add-ons.

## Tests

| What | Command | Needs |
|---|---|---|
| Box arithmetic, both copies (the bug-1 regression; neither owner surface has a UI runner) | `npm run test:checkout` (repo root) | nothing |
| Router boundary: price passthrough, legacy body, 400s, 409 mapping, `remove-extra` guards | `cd backend && npx vitest run tests/unit/queue-addons.test.ts` | nothing |
| End to end against real plpgsql | `node backend/scripts/smoke-checkout-addons.mjs` | running API + seeded **throwaway** DB (one login) |

The smoke script covers:
- A typed price is recorded and moves the bill.
- A repeat gives 409 and nothing is charged twice.
- An old body without a price gets the catalog price.
- Remove takes the row, its minutes and its name segment, never the booked service.
- An unknown label gives 404, and a waiting customer gives 422.
- A multi-service extra comes off.
- Unpriced and range visits bank service price + add-ons.

## Not done

- Add-on prices are typed every time. The chips do not remember a store's own price for "Shave".
  Doing that would need a per-store add-on price list, which does not exist; `SERVICE_EXTRAS` is
  platform-wide.
- The chip list itself is still hard-coded per store type, in three copies:
  `backend/src/config/constants.ts`, and `lib/service-extras.ts` in owner-web and in the app.
