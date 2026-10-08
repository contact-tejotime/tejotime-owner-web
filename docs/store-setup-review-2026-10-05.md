# Store setup review — client points 14, 23, 26, 27, 29, 30, 34, 35, 36, 39

Shipped 2026-10-05 (rows 26, 27, 36 and 39 on 2026-10-08). After a system review the client sent a
spreadsheet ("TejoTime Store Setup Review and Product Recommendations"). This records the ten rows
built here, what was decided, and where each one lives. Row 12 (a "Read or leave a Google review"
button on the page) was looked at on 2026-10-08 and deliberately left for later.

Row 27 is the exception to the next paragraph: it changes only the customer page (`frontend/`).

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
| 26 | Gallery guidance for salons | A **photo tip per store type** above the gallery hint, e.g. for salons: finished cuts, color, styling, nail sets, before-and-after. **The gallery now holds 12 photos** (was 7), raised the same day at the user's request. |
| 27 | Closed state on the page | A closed store says **"Closed" once**, in the hero "Right now" card. The banner, the phone bar and the team note turn to booking; idle staff no longer read "Available". The team tile already said "3 Team members" (2026-09-29). |
| 29 | Currency default | **Create store defaults the currency from the phone's country** (US → USD, India → INR …) until the admin picks one ([store-currency.md](store-currency.md)). **/demo-store** became a full US store in the seed (USD, US address and phone, Eastern time, Card / Apple Pay / Cash), with its reviews labelled as samples. |
| 30 | Area | Renamed "Neighborhood shown on your page (optional)", e.g. "Downtown Naples". **Optional**; the page shows the city when it is blank. |
| 34 | Tagline | Renamed "Headline on your page". **Still required.** Ready-made lines per store type; admin Create store pre-fills one. |
| 35 | Highlight number and caption | **Removed.** They were saved but never shown on the page. |
| 36 | About heading and Description | **Optional**, labelled "About heading (optional)" / "About text (optional)". Starter text per store type: admin Create store pre-fills it, and every screen offers "Use suggested text" for a blank field. Blank is stored as NULL and the page leaves it out. |
| 39 | Established year | Renamed **"Year opened (optional)"**. Shown on the page only when entered. |

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

## 36 · About heading and text

- **Optional everywhere.**
  - The admin schema no longer requires them (`admin.routes.ts`), and admin Create/Edit no longer
    marks them required.
  - Owner web and the app never did.
  - Blank (spaces too) is stored as **NULL**, on the admin path (`businessColumns`, `|| null`) and
    on the owner `PATCH` (`business.service.ts`, which staff with `profile: manage` also reach,
    since the text is a base column).
  - The page already left out a blank heading or text, and drops the whole About section when
    nothing is left (no amenities or About photo either).
- **Starter text,** from `aboutStarters.{type}` in each app's `en.json`, where the type comes from
  `familyFor`.
  - It is **hand-copied byte-identical** into admin-panel, owner-web and app. No guard checks it.
  - The client's own lines replace these when they send them.

  | Type | Heading | Text |
  |---|---|---|
  | beauty | Look and feel your best | We're a friendly local team who take the time to listen and get every detail right. Book online in a few taps — we look forward to seeing you. |
  | clinic | Care that puts you first | Our team gives every patient unhurried, personal attention in a calm, welcoming setting. Book your visit online in a few taps. |
  | food | Fresh food, made with care | We cook fresh every day and keep things friendly and relaxed. Book ahead online and we'll be ready for you. |
  | fitness | Train at your own pace | Our coaches help you build strength and confidence, whatever your starting point. Book your session online in a few taps. |
  | generic | Friendly service, on your schedule | We're a local business that values your time. Book online in a few taps and we'll be ready when you arrive. |

  The text makes no walk-in or waitlist claims, because not every store takes walk-ins.
- **Pre-fill: admin Create store only.**
  - It works exactly like the headline (§34): `StoreForm`'s `AUTO_FIELDS` (headline, About heading,
    About text) each follow the category until the admin writes in that field.
  - Autofill treats self-filled text as empty ([store-autofill-from-link.md](store-autofill-from-link.md)).
  - A new store therefore launches with an About section the owner can rewrite.
- **Everywhere else, a button rather than a pre-fill.** On owner web, the app and admin Edit, a
  **"Use suggested text"** chip appears while either field is blank, and fills only the blank one(s).
  - Pre-filling a saved form would mark it changed on open.
  - The owner's next unrelated save would then publish text they never read.

## 39 · Year opened

- **Renamed** from "Established year" to **"Year opened (optional)"** on all three setup screens.
  The autofill review row reads "Year opened".
- **Shown only when entered.**
  - With a year, the page shows "Since {year}" in three places:
    - the line under the headline;
    - the scrolling ticker;
    - the "Since … / Serving {place}" card, which also needs a neighborhood or city.
  - With none, none of them appear (`MicrositeClient`, each gated on `establishedYear != null`).
  - A blank year is always stored as NULL: the admin form leaves it out of the payload, and the owner
    `PATCH` turns `''` / `null` into NULL.
- **Range 1900–2100 on every form.**
  - This is the API's range. Owner web and the app used to accept 1800, so 1850 passed the form and
    failed at the API with no field named.
  - The admin form has no client-side check; the API answers 400.

## 26 · Gallery photo tips

- **One line per store type,** from `galleryTips.{type}` (type from `familyFor`). It sits under
  "Photos for: {heading}", above the existing hint about the photo limit and reordering, on all
  three setup screens, and follows the category as typed.
- **Hand-copied byte-identical** into the `en.json` of admin-panel, owner-web and app, like
  `aboutStarters`. Nothing checks the copies.

  | Type | Tip |
  |---|---|
  | beauty | Show your best finished work: fresh cuts, color results, styling, nail sets, and before-and-after shots (with your client's okay). Real photos of your own work win more bookings than stock images. |
  | clinic | Show your space and your team: reception, treatment rooms, equipment, and staff at work. Real photos help patients feel at ease before they arrive. |
  | food | Show what you serve and where: signature dishes, drinks, and your dining room. Real photos of your own food work best. |
  | fitness | Show your space in action: equipment, classes, and coaches at work. Real photos of your own gym work best. |
  | generic | Show your real work and your space: finished jobs, your team, and the inside of your shop. Real photos work better than stock images. |

- **The gallery holds 12 photos** (was 7). The client's "consider raising the 7 photo limit later"
  was taken up on 2026-10-08.
  - **Backend:** one constant, `MAX_GALLERY_PHOTOS` in `backend/src/config/constants.ts`, used by
    the owner `PUT /business/gallery` schema and the admin store schema. A 13th photo is a 400 and
    nothing is written.
  - **Uploaders, the same number by hand:**
    - admin `ImageUpload.tsx` `GALLERY_MAX`;
    - owner-web `GalleryEditor.tsx` `max`;
    - app `OwnerStoreProfileForm.tsx` `GALLERY_MAX`.
  - **Hint strings that print it:**
    - admin `storeForm.galleryHint`, `imageUpload.chooseGallery`;
    - owner-web `profile.photosHint`;
    - app `profile.galleryHint`, `profile.galleryFull`.
  - **Change them together.**
  - **The page needed no change.** Its mosaic (`GalleryMosaic`, `.ttMosaic` in `salon.css`) is a
    flowing grid: the first photo spans 2×2 on wider screens and the rest fill in, for any count.
    The photo viewer steps through all of them.

## 27 · Closed state on the page

**The rule:** a closed store (`walkInsClosed = hasHours && !openStatus.isOpen` in `MicrositeClient`)
says "Closed" in exactly one place, the hero "Right now" card. Everything else turns to booking, the
one thing that still works.

- **One source:** every open / closed / wait string the page shows comes from
  `frontend/src/components/microsite/status-copy.ts` (`statusCopy`). It has no React and no `@/`
  imports, so `npm run test:status-copy` can check it with plain tsx.
- **Before and after** (closed; open stores are unchanged):

  | Place | Before | After |
  |---|---|---|
  | Hero card, nobody queued | "Closed" / "Opens tomorrow at 9:00 AM" | unchanged |
  | Hero card, no next opening | "Closed" / "Walk-in check-in is closed" | "Closed" / "Book ahead for your next visit" |
  | Hero card, people still queued | "3 waiting" / "Opens …", and green "Available" on idle staff | "3 waiting" / "Closed · Opens …"; staff rows hidden |
  | Bottom banner | "Closed right now — book your next visit" / "Walk-in check-in is closed. Opens …" | "Book your next visit" / "Pick a day and time that suits you." |
  | Phone bottom bar | "Walk-ins closed" / "Opens …" | one line: "Opens tomorrow at 9:00 AM" (none known: "Book ahead") |
  | Team section note | "…take the shortest line. Numbers update as the queue moves." | "Choose who you'd like to book with." |
  | Team stat tile | "3 Team members" (since 2026-09-29) | unchanged |

- **Still says "Closed", on purpose:** the hours table on closed weekdays and the booking calendar's
  closed-day chips. Those are facts about a weekday, not about right now.
- **Not changed (seen while auditing):**
  - the help chat still offers "Check in now" on a closed store; when tapped it answers "closed
    right now — it opens …";
  - the salon services note "Walk-in availability may vary";
  - the food family's "Live table availability" heading;
  - "Different number" / "Rejoin the Waitlist" in the already-queued views still open the check-in
    form on a closed store.
- **The page does not re-check opening hours** while a tab stays open: `openStatus` is computed
  once per page load.

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
  - the vCard uses the city;
  - blank About heading / text is stored as NULL, on the admin columns and the owner `PATCH`
    (including a staff login).
- **Unit** — `backend/tests/unit/optional-store-data.test.ts`:
  - admin create without a neighborhood;
  - the old highlight fields still accepted;
  - the gallery heading's 40-character limit;
  - the headline still required;
  - admin create with no About heading or text, blank ones accepted, over-long ones refused.
- **Store-type matcher:** `npm run test:family` and `npm run check:family`.
- **Closed state (row 27):** `npm run test:status-copy`
  (`frontend/src/components/microsite/__tests__/status-copy-check.ts`).
  - It covers a closed store with the next opening known or not, and the queue empty or not.
  - In each case, "closed" appears in exactly one slot on a computer and one on a phone, and
    nothing invites a walk-in. Open-store wording is unchanged.
  - Written first, it failed on the old wording: 3× on desktop, 4× on a phone, up to 6× with no
    next opening.
  - It checks the strings, not the rendering; there is no browser runner.
- **Gallery tips (row 26):** wording only. Type-checked; still to be checked by eye on each screen.
- **12-photo gallery (row 26):**
  - **Unit,** `optional-store-data.test.ts`: the owner saves 12 and a 13th is a 400 before anything
    is written; admin create takes 12 and refuses 13. Both failed against the old limit of 7.
  - **E2E,** `smoke-store-setup.mjs`: 12 save and reach the page payload, a 13th is a 400 that
    changes nothing, and Sharp Cuts' gallery is put back.
- **E2E:** `backend/scripts/smoke-store-setup.mjs` (see the script header).
