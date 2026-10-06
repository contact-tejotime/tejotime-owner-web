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

### "Amount to charge" is the whole bill

The box always holds the **whole bill**, and Complete & start next charges exactly what it holds.

| Booked service | The box starts at | When an add-on goes on or off |
|---|---|---|
| `fixed` price | the server's suggestion (service + add-ons) | moves by the add-on's price |
| `unset` (no price) or `range` | the add-ons' total (₹100 + ₹45 → ₹145); empty if there are none | moves by the add-on's price |
| no service at all | empty until it has an add-on, then the add-ons' total | moves by the add-on's price |

- **The owner adds the service's own price by hand.** For a Hair cut with no price, add ₹200 to
  ₹145 and type 345.
  - An add-on put on or taken off afterwards still moves the box by its price, so the typed figure
    is never thrown away.
  - Taking the last add-on off an unpriced visit empties the box rather than leaving ₹0 ready to
    bank.
- **Hints:** the old ones.
  - Unpriced: "This service has no price set. Enter what was actually charged."
  - Range: quotes the band.
  - Fixed: "Pre-filled from the booked service…".
- **The box:** no placeholder.
- **The breakdown:**
  - The booked service on its own line, by its own name (`serviceName`), showing its price, its
    band or "No price".
  - Then each add-on with its price.
  - Then "Suggested", for a fixed service only.
  - There is no separate total row; the box is the total.
- **An empty box at Complete** is refused with the old "Enter the final amount before completing."
  The API's `AMOUNT_REQUIRED` rule is unchanged underneath.

**Why it is not a separate "service price" box.** The first version on 2026-10-06 did that: a box
for the Hair cut's own price (placeholder "Hair cut price") plus a "Total to charge" row under it.
The client tried it on preprod the same day and asked for the old single box, holding the total,
with each add-on's price added into it. The trade-off is accepted: an owner who forgets to add the
haircut banks only the add-ons.

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
| Box arithmetic, both copies (the bug-1 regression — unpriced + ₹145 of add-ons starts at 145; neither owner surface has a UI runner) | `npm run test:checkout` (repo root) | nothing |
| Router boundary: price passthrough, legacy body, 400s, 409 mapping, `remove-extra` guards | `cd backend && npx vitest run tests/unit/queue-addons.test.ts` | nothing |
| End to end against real plpgsql | `node backend/scripts/smoke-checkout-addons.mjs` | running API + seeded **throwaway** DB (one login) |

The smoke script covers:
- A typed price is recorded and moves the bill.
- A repeat gives 409 and nothing is charged twice.
- An old body without a price gets the catalog price.
- Remove takes the row, its minutes and its name segment, never the booked service.
- An unknown label gives 404, and a waiting customer gives 422.
- A multi-service extra comes off.
- Unpriced and range visits bank the amount sent (service price + add-ons, as the box holds it).

## Not done

- Add-on prices are typed every time. The chips do not remember a store's own price for "Shave".
  Doing that would need a per-store add-on price list, which does not exist; `SERVICE_EXTRAS` is
  platform-wide.
- The chip list itself is still hard-coded per store type, in three copies:
  `backend/src/config/constants.ts`, and `lib/service-extras.ts` in owner-web and in the app.
