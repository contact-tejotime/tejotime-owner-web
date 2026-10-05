# Store setup review — client points 14, 23, 29, 30, 34, 35

Shipped 2026-10-05. After a system review the client sent a spreadsheet ("TejoTime Store Setup Review
and Product Recommendations"). This records the six rows built here, what was decided, and where
each one lives.

The setup changes land on **all three setup screens** (CLAUDE.md §11.1):
- the admin panel's Create / Edit store (`admin-panel/src/components/StoreForm.tsx`);
- owner web's Store profile (`owner-web/src/components/StoreProfileEditor.tsx`);
- the app's Store profile (`app/src/components/settings/OwnerStoreProfileForm.tsx`), on iOS and
  Android.

The wording is the same in each app's `src/i18n/en.json`.

| Row | Item | Decision |
|---|---|---|
| 14 | About photo | Renamed "About section photo (optional)". Hint: "Shown next to your story in the About section. A photo of your shop inside, your team, or you at work works best." |
| 23 | Gallery label | **The owner chooses the gallery heading** from ready-made headings for the store's type, or types their own. Blank keeps today's heading. |
| 29 | Currency default | **Create store defaults the currency from the phone's country** (US → USD, India → INR …) until the admin picks one ([store-currency.md](store-currency.md)). **/demo-store** became a full US store in the seed (USD, US address and phone, Eastern time, Card / Apple Pay / Cash), with its reviews labelled as samples. |
| 30 | Area | Renamed "Neighborhood shown on your page (optional)", e.g. "Downtown Naples". **Optional**; the page shows the city when it is blank. |
| 34 | Tagline | Renamed "Headline on your page". **Still required.** Ready-made lines per store type; admin Create store pre-fills one. |
| 35 | Highlight number and caption | **Removed.** They were saved but never shown on the page. |

## The store type

The ready-made headings and headline lines depend on the kind of store. There is one matcher for
that, `familyFor(category)` in **`frontend/src/lib/store-family.ts`**:
- it reads the category text and answers `beauty`, `clinic`, `food`, `fitness` or `generic`;
- it is the same matcher the page uses for its wording (`components/microsite/domains.ts`), so setup
  offers headings for the same kind of store the page shows.

It is copied byte for byte into `admin-panel/src/lib`, `owner-web/src/lib` and `app/src/lib`:
- `npm run sync:family` writes the copies and `npm run check:family` verifies them;
- `npm run test:family` pins its answers;
- never edit a copy.

Known quirk, kept: matching is by substring, so "Coworking Space" contains "spa" and reads as
beauty.

## 23 · Gallery heading

- **Column:** `business.gallery_heading` (migration **0038**). NULL means the page's default for the
  store type, so existing stores look the same.
- **API:** the admin store API and the owner `PATCH /business` take `galleryHeading`, at most 40
  characters; `''` clears it.
  - **Admin:** written only when sent, so an older admin build cannot wipe an owner's choice.
  - **Owner:** an owner-only field, like the About heading; a staff login gets 403.
- **Page:** shown as `site.galleryHeading || domain.galleryHeading`.
- **Setup control:**
  - **Admin:** a select.
  - **Owner web and the app:** radio chips.
  - **Options:** "Default for your store type — {heading}", then the ready-made headings, then
    "Custom…" (40 characters). Once Custom is picked it stays picked while the owner types.
  - **Photo upload label:** "Photos for: {heading}".
- **Strings:** the lists are the top-level `galleryHeadings.{type}` / `headlineSuggestions.{type}` in each
  app's `en.json`.

| Type | Ready-made headings (the first is the page default) |
|---|---|
| beauty | See our recent work · Inside the shop · Our Work |
| clinic | Our facility · Inside the clinic |
| food | From our kitchen · Inside the restaurant |
| fitness | Inside the gym · Our classes |
| generic | Our Work · Inside the shop |

## 30 · Neighborhood

- **Admin:** no longer required. Owners could already leave it blank.
- **Public payload:** now also carries `city`.
- **Fallback to the city:** wherever the neighborhood used to show — the hero line, the scrolling
  strip, the "Serving {area}" card, the Visit section and map, the digital card, the chat bot's
  address and the owner screens' header line.
- **vCard:** its locality is now the city.

## 34 · Headline

- **Required:**
  - admin create still requires it;
  - on the owner `PATCH`, a **blank headline is ignored**, not saved — it used to leave the page
    with an empty heading, and older app builds send the field on every save, so refusing it would
    block their other changes;
  - owner web and the app stop a blank headline with "Add a headline — it's the biggest text on
    your page.";
  - the page also falls back to the store name if a stored headline is empty.
- **Suggestions:** shown as "Ideas:" chips under the field, from `headlineSuggestions.{type}` in each
  app's `en.json`. **The client's own lines are added to the same lists when they send them.**

  | Type | Our lines |
  |---|---|
  | beauty | Look sharp. Skip the wait. · Fresh cuts, no long wait |
  | clinic | Care without the long wait |
  | food | Fresh food, ready when you are |
  | fitness | Train hard. Skip the line. |
  | generic | Book ahead or join the line — your time matters |

- **Pre-fill:** admin Create store fills in the first line when the category is picked, or after an
  autofill brought none, while the headline is still empty or still the line the form filled in
  itself. Once the admin types or picks a chip, it is theirs. A self-filled line is never counted as
  typed data by autofill ([store-autofill-from-link.md](store-autofill-from-link.md)).
- **Error messages:** the admin form says "Headline" in its error summary and autofill review too.

## 35 · Highlight number and caption

The inputs, strings and types are gone from all three setup screens, and the page payload no longer
carries them.

**The API still accepts `statValue` / `statLabel` and ignores them.** The store schemas are strict,
and installed app builds send both on every save, so refusing them would fail those saves.

The `stat_value` / `stat_label` columns (0008) are kept for now. Drop them, and the two schema
entries, once no client sends the fields.

## 29 · /demo-store as a US store

**`backend/db/seed-demo.ts`** (`npm run seed:demo`) rebuilds the `demo-store` business.

| Setting | Now |
|---|---|
| Name | Sharp Cuts (Demo), in Old Naples, Naples, FL (a fictional address) |
| Phone | +1 239-555-0110: fictional 555-01xx, outside the nine homepage stores' 0101–0109 |
| Owner login | `12395550110` / `password123` |
| Time zone | America/New_York |
| Currency | USD, on the business and on each service |
| Prices | Haircut $35 · Haircut & Beard $45 · Hair Color $120 · Hair Spa $80 |
| Payments | Credit/Debit Card, Apple Pay, Cash; the FAQ and amenity wording match |
| Reviews | US names, labelled "Sample reviews" / "Sample" by the page (`isDemo`) |

It touches only that business; every child row goes with it through `on delete cascade`.

**Live sites:** run `npm run seed:demo` against each environment's database, **with approval**, and
only for this store. It changes the demo owner's login.

## Tests

- **Unit** — `backend/tests/unit/store-setup-review.test.ts`:
  - the gallery heading is written only when sent, `''` clears it, and it is owner-only;
  - a blank headline is ignored;
  - the highlight fields are never stored or returned;
  - the public payload carries `city` and `galleryHeading`;
  - the vCard uses the city.
- **Unit** — `backend/tests/unit/optional-store-data.test.ts`:
  - admin create without a neighborhood;
  - the old highlight fields still accepted;
  - the gallery heading's 40-character limit;
  - the headline still required.
- **Store-type matcher:** `npm run test:family` and `npm run check:family`.
- **E2E:** `backend/scripts/smoke-store-setup.mjs` (see the script header).
