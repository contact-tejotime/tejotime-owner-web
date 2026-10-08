# Optional store data — pictures, stylists, prices, services

**Status:** implemented on branch `feat-jay` (2026-09-28). Migration `0030_optional_seats.sql` must
be applied **before** the new backend is promoted (see `DEPLOY.md`).

**Why.** Customers hesitate when a store asks for a lot of information, so a store now collects as
little as it can. Pictures, stylists, service prices and services are all optional, for **every**
category and every store — there is no flag and no per-category switch.

This replaces the old rule, where only Hospital and Restaurant (`OPTIONAL_SERVICES_STAFF_CATEGORIES`)
could have zero services and staff, and every other category (Salon & Barber included) was forced
to have at least one of each. That constant no longer exists.

## What is and is not required now

| | Required? | Behaviour when missing |
|---|---|---|
| **Pictures** (logo, hero, about, gallery, staff photo) | No — never was, in the schema | Microsite falls back per slot; see "Public page". |
| **Stylists** (`staff` rows) | No | The queue is one shared lane; see "No stylists". |
| **Services** | No | The booking modal skips the service step; a join or booking carries no service. |
| **Service price** | No — a service may be `unset` | The microsite shows **no price** for it; the owner types the amount at checkout. |

Still required, unchanged: a service that *is* priced needs a positive amount (`fixed`) or a floor
and ceiling (`range`); a service always needs a name and a duration; a store still needs its
identity fields (name, category, address, city, tagline, phone). The neighborhood ("area") became
optional on 2026-10-05: the page shows the city when it is blank. The About heading and text became
optional on 2026-10-08 (client review row 36): left blank, the page leaves them out
([store-setup-review-2026-10-05.md](store-setup-review-2026-10-05.md)).

## Public page — `/{phone}`

- **Hero without a photo.** The wait card ("Right now" + Check in / Book) moves into the right-hand
  column the photo would have filled, so the hero is two balanced halves on a computer and stacks
  on a phone. With a photo nothing changes. The old "Hero photo" placeholder text (shown to real
  customers) is gone. A hero URL that fails to load is treated as missing (`MicrositeClient`
  probes it, since a CSS background has no `onError`).
- **Logo** falls back to the brand tile on a null *or* broken URL. (The server-rendered `/{phone}/card`
  page has no client JS by design, so it only handles a null logo.)
- **Gallery** — section and nav link hide when empty; a single photo takes the full width
  (`.ttMosaicSolo`).
- **Price** — `priceLabelFor` returns `""` for an unpriced service; the service card, booking
  picker and confirm summary omit the price element. The visit total is empty if **any** chosen
  service is unpriced (a total that silently leaves one out would quote too little).
- **No stylists** — the Team section and the provider chip row are dropped, the confirm summary
  names no provider, and the stat cards (year, rating, wait) still render.
- **No services** — the Services section, nav link and picker step disappear; join and book work
  with no service (slot length falls back to `BOOKING_SLOT_MINUTES`).

## No stylists — the shared lane (migration 0030)

A business with no active staff has a single flat group (`__unassigned__`, named "Waiting"; "Any"
when staff exist but a ticket's seat was deleted). Its entries have `staff_id = NULL`. Until 0030
that broke three plpgsql functions, all because `staff_id = NULL` is never true:

- `_queue_renumber` never matched, so seatless positions stayed at the `1000000` / `-1` sentinels.
- `queue_start` never found a busy seat, so the `SEAT_BUSY` guard was a silent no-op.
- `queue_move` refused any seatless entry.

They now compare with `is not distinct from`. **Decision:** a seatless lane is one shared queue and
several people may be in service in it at once — there is no chair to be busy. So `SEAT_BUSY` is
skipped for a NULL seat, and checkout does **not** auto-promote from it (the owner starts the next
entry). Real seats behave exactly as before. Wait times for a seatless lane are cumulative, so they
overstate the wait when several are served in parallel — accepted.

Owner surfaces: owner-web's board keeps the quick **Start** button available in the seatless lane
(`QueueBoard.tsx`); the detail sheets already treat a card with no `seatId` as not-busy. The empty
board reads "Nobody is in the queue right now." rather than "add staff". A staff *login* still needs
a chair (`uq_app_user_staff`), so a store with no stylists only has owner / co-owner logins.

## No price / no service at checkout

`queue_checkout` refuses to derive an amount (`TEJO:AMOUNT_REQUIRED`, HTTP 422) when `p_amount_paise`
is null and either the service is `range`/`unset`, **or the entry has no service and no add-ons**.
The last case used to bank ₹0 as a free visit into `visit.amount_paise` and the customer's spend; with
services optional it would have been the common case. `GET /queue/:id` reports such an entry as
`servicePriceType: 'unset'`, `amountRequired: true`, `suggestedAmount: null`, so both owner
surfaces show the type-an-amount box and no ₹0.

## API

- `POST /services`, `PATCH /services/:id` — `priceType` is `fixed | range | unset`. `priceAmount`
  is optional and ignored for `unset` (stored as `0`, ceiling `null`, which is what
  `ck_service_price_shape` accepts). A priced mode still needs a positive `priceAmount`; a PATCH
  that changes to a priced mode must still send the amount with the mode.
- `POST /admin/businesses`, `PUT /admin/businesses/:id` — `services` and `staff` default to `[]`;
  a service's `priceRupees` is optional for `priceType: 'unset'`.
- `POST /queue` (walk-in) — no service required for any category. Hospital still requires
  `visitorType`.
- `GET /media/*` — the key pattern now includes `about/`. **Bug fixed:** `about` uploads were minted
  (`uploads.routes.ts`) but not matched, so every uploaded About image 404'd.

## Owner surfaces (owner-web · iOS · Android · admin panel)

All four gained a **"No price"** pricing mode next to Fixed and Range, dropped the
Hospital/Restaurant-only "optional" hints and the "Add a service" walk-in rule, and word an
unpriced service as "No price". Files: `owner-web/.../ServicesEditor.tsx`, `WalkInSheet.tsx`,
`QueueBoard.tsx`; `app/.../ServiceEditSheet.tsx`, `state/store.tsx`; `admin-panel/.../StoreForm.tsx`,
`lib/types.ts`. The app's `AppointmentListItem`, `QueueCard` and `DetailPanel` no longer print
`null` / a dangling `·` for a missing service.

## Admin "Autofill from a link"

The first fetch into an empty create form applies everything without the review dialog, and a
scraped service with no stated duration stays **blank** (Save is blocked until typed) instead of
being guessed as 20 minutes; no price becomes "No price". See
[store-autofill-from-link.md](store-autofill-from-link.md).

## Tests

- `backend/tests/unit/optional-store-data.test.ts` — the API boundary (owner service price rules,
  admin provisioning with no services/staff/images, unpriced chat facts). Database stubbed.
- `backend/scripts/smoke-rest.mjs`, section "OPTIONAL DATA: NO PRICE, NO SERVICE" — an unpriced
  service round trip, a service-less walk-in and checkout, and a service-less public join. Needs a
  running API and a seeded throwaway DB.
- `backend/scripts/smoke-seatless.mjs` — migration 0030 against a migrated Postgres, inside a
  transaction that is always rolled back (shared lane, reordering, parallel service, checkout rules,
  and that a real seat still refuses a second start and still auto-promotes).

There is no browser test runner, so the microsite layout is checked by hand: `/demo-store` and a
store with its images removed, at 360 / 768 / 1280 px, light and dark, a few theme presets, with a
hero photo / without / with a dead URL.
