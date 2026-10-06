# Checkout: the amount to charge and add-on chips

**Shipped:** 2026-10-06 · **Applies to:** backend, owner-web, app (iOS + Android) · **Migrations:** 0039, 0040

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

Three more rounds of preprod feedback the same day shaped what follows:
- **Round 2:** the box is the total again.
- **Round 3:**
  - A no-price service is **compulsory** to price.
  - Complete stays disabled until it is.
  - A total line ends the bill.
  - The whole sheet scrolls.

## How the sheet works now

### "Amount to charge" is the whole bill

The box always holds the **whole bill**, and Complete & start next charges exactly what it holds.
It starts at **everything that already has a price**, and from then on **moves by each change**:
an add-on going on or off, or a no-price service's price being typed or cleared. A figure the
owner corrected by hand (a discount, a round number) therefore survives every later change.

| Visit | The box starts at | Complete |
|---|---|---|
| `fixed` main service | the server's suggestion (service + add-ons) | enabled |
| a service with no price (`unset`), picked first **or later** | the priced parts (Hair wash ₹100 + Blow-dry ₹200 → ₹300) | **disabled** until that service's price is typed in its row |
| `range` main service | the add-ons' total | enabled once the box has a value (no required row: the client's call) |
| no service at all | empty; a chip seeds it | disabled while the box is empty |

### A service with no price must be priced (round 3)

- **Its bill row becomes a required field:** `Hair cut * [₹ ___]`. Whatever is typed there is
  added into the box, so ₹300 becomes ₹500 with a ₹200 haircut. Clearing it takes it back out.
  - 0 is accepted (a free haircut is a decision).
  - Empty, junk, negative or above the API's cap (₹10,00,000) is not.
  - The field turns red only after the owner has left it empty, never on first open.
- **Complete & start next stays disabled** until every required price is typed and the box holds a
  readable amount. Above the button, a line says why: "Enter the price for Hair cut to complete."
  Tapping it scrolls to the field and focuses it.
- **Every** service with no price counts, not only the first-picked one.
  - A customer who picks "Hair wash, then Hair cut" gets Hair wash as the main service, and Hair
    cut as an add-on row stored at ₹0.
  - That row is flagged `priceRequired` by the server (migration 0040, below) and gets the same
    field.
  - Two no-price services get two fields, and the line names both.
- **Range-priced services are excluded** (the client's call). A range service picked later keeps
  its stored floor price.
- **A booked no-price service whose chip is tapped off** (its label matches a chip) takes its row
  and its typed price out of the box together.

### The bill

1. The booked service, by its own name (`serviceName`): its price, its band, or the required
   field.
2. Each add-on with its price. A booked no-price one has the required field instead.
3. "Suggested" (the server's figure), **only when the box no longer matches it**: the owner changed
   a fixed price. Otherwise it would repeat the total.
4. **Total to charge**: the box, live. A dash when the box is empty or unreadable.

The hints are the old ones:
- Unpriced: "This service has no price set. Enter what was actually charged."
- Range: quotes the band.
- Fixed: "Pre-filled from the booked service…".

The box has no placeholder.

### Layout: one scroll, pinned actions (both surfaces)

- **What scrolls:** everything but the actions, as one region (`.dp-scroll` on the web, the
  `ScrollView` on the app):
  - the customer (avatar, name, status);
  - the in-service line;
  - the amount box, the chips, the bill and the total.
- **What is pinned:** the footer holds only the "why disabled" line, Complete and Mark no-show.
- **What it replaced:** the checkout used to live in the pinned footer. On a laptop that squeezed
  the customer into a ~60px strip with its own scrollbar.
- **The footer's soft top edge** appears only while content is under it. The web uses an
  `IntersectionObserver` sentinel; the app compares scroll offset and content size.
- **App keyboard:** the `ScrollView` has `automaticallyAdjustKeyboardInsets` (iOS) and
  `keyboardDismissMode="on-drag"`. The footer stays above the keyboard via `TKeyboardScreen`, as
  before.
- **Web top bar:** it showed both the back chevron and the × at every width, because `Icon`'s
  inline `display: block` beat the class meant to hide one. The classes now sit on wrapper spans.

**Why not a separate "service price" box.** The first version on 2026-10-06 had one: a box for the
Hair cut's own price, placeholder "Hair cut price", with a "Total to charge" row under it. The client
asked for the single box holding the total instead. Round 3 then put the compulsory price **in the
service's row**, so the box stays the total and nothing can be completed unpriced.

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
- **`extras[].priceRequired`** (0040): the row is a booked service with no price. Its `pricePaise`
  is a placeholder 0. Any such row also makes `amountRequired` true and `suggestedAmount` null.
- **`AMOUNT_REQUIRED`** now reads "Enter the final amount for this visit". It was a range-only
  message, but it is raised for unpriced, no-service and unpriced-extra visits too.
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

## Database (0040): no-price services picked later

- **New column:** `queue_entry_extra.price_type`.
  - It holds the catalog service's price type, for rows attached from a booking, a multi-service
    walk-in or a waitlist join.
  - It is NULL for chip add-ons, whose price the owner typed.
  - It is NULL for every row from before 0040. There is no backfill, so a visit already in the
    queue keeps the behaviour it started with.
- **`queue_attach_services`** resolves it from the `serviceId` each item now carries. The lookup is
  inside the business and by id: service names are not unique.
  - Its callers send that id: `addWalkIn`, `public.service.ts` `extraServicesPayload`, and
    `appointment_check_in` (from `appointment_service.service_id`).
- **`queue_checkout`** refuses to *derive* a total (`TEJO:AMOUNT_REQUIRED`) when any extra is
  `unset`, as it already did for an unpriced main service. An explicit `amountPaise` still wins.
  - Before this, "Hair wash, then Hair cut" checked out on an empty body at ₹100.
  - The smoke run against the pre-0040 backend reproduces it: 200 instead of 422.
- **All three functions keep their signatures** (no overload trap). The bodies are copies of 0025's
  and 0030's, with only the marked changes.

## Tests

| What | Command | Needs |
|---|---|---|
| Box, required prices, completion gate, both copies (114 checks: every edge case below; neither owner surface has a UI runner) | `npm run test:checkout` (repo root) | nothing |
| Router boundary: price passthrough, legacy body, 400s, 409 mapping, `remove-extra` guards | `cd backend && npx vitest run tests/unit/queue-addons.test.ts` | nothing |
| End to end against real plpgsql (84 checks) | `node backend/scripts/smoke-checkout-addons.mjs` | running API + seeded **throwaway** DB (one login, two public writes) |

The smoke script covers:
- A typed price is recorded and moves the bill.
- A repeat gives 409 and nothing is charged twice.
- An old body without a price gets the catalog price.
- Remove takes the row, its minutes and its name segment, never the booked service.
- An unknown label gives 404, and a waiting customer gives 422.
- A multi-service extra comes off.
- Unpriced and range visits bank the amount sent (service price + add-ons, as the box holds it).
- **0040:** a no-price service picked second is flagged and blocks an empty checkout. This is
  checked on the owner walk-in, the waitlist join and the appointment check-in.
  - Picked first, its priced extra is not flagged.
  - A ₹0 chip add-on is never flagged.
  - Against the pre-0040 backend these cases fail: 66/84 pass, and the empty checkout banks ₹100.

**Edge cases the case table pins:**
- an unpriced service picked first or second, and two of them;
- typing, changing and clearing a required price;
- a hand-edited box surviving later typing and chips;
- a removed required row taking its typed price with it;
- an emptied box re-seeding;
- the ₹10,00,000 cap;
- range (nothing required);
- fixed ("Suggested" only when it differs);
- a bare walk-in (disabled while empty; the last chip off leaves no ₹0 bill).

## Not done

- The app's layout has not been looked at on a device or simulator. There is none on the Windows
  machine that built it. It type-checks and lints, and its logic is the shared, tested
  `checkout-amount.ts`. Check iOS and Android, especially the keyboard over the required field and
  the footer's raised edge (iOS shadow vs Android elevation).
- Range-priced services picked later keep their floor price with no prompt (the client's call).

- Add-on prices are typed every time. The chips do not remember a store's own price for "Shave".
  Doing that would need a per-store add-on price list, which does not exist; `SERVICE_EXTRAS` is
  platform-wide.
- The chip list itself is still hard-coded per store type, in three copies:
  `backend/src/config/constants.ts`, and `lib/service-extras.ts` in owner-web and in the app.
