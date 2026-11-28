# Autofill a store from a business name

In the admin panel's **Create Store** form (`admin-panel/src/components/StoreForm.tsx`) an admin can
type a business **name + area** (e.g. "Om Beauty Parlour Mota Varachha Surat") and have the whole form
pre-filled — text, hours, contact, photos — from **Google Places API (New)**. Like the sibling
["autofill from a link"](store-autofill-from-link.md), **nothing is applied until the admin reviews it**
and nothing is saved until they press Save. It is **purely additive**: the link flow is untouched, and
the two share the review dialog, the `ImportedFields` shape, the Groq seam and the env flags.

Scope: **admin panel only** (owner-web and the app have edit-only profile editors, deliberately left out).

## Flow

```
StoreForm "Autofill from business name" card
  ─ query ─► POST /api/store-name-search  (admin-panel route, attaches admin JWT)
            ─► POST /admin/store-name-search ─► googlePlaces.searchText()            → candidates[]
  1 candidate  → fill straight away
  more         → StoreNameCandidates picker (name, address, type, "Permanently closed" badge)
  ─ placeId ─► POST /api/store-name-fill   (admin JWT; maxDuration 60)
            ─► POST /admin/store-name-fill  ─► fillStoreFromPlace(placeId):
                 1. daily cost guard  → googlePlaces.placeDetails(placeId)
                 2. presetFor(types, name, country)              lib/category-content.ts
                 3. mapPlaceToFields()   (pure, unit-tested)     store-autofill.service.ts
                 4. readWebsite()        REUSES the link stack    safe-fetch → html-extract → storeExtractor
                 5. storeCopyWriter.write() ?? templateCopy()     integrations/store-copy.ts
                 6. copyPhotos()  photoMediaUri → safeFetchBuffer → uploadBuffer  → /media/... URLs
            ◄── { source, fields: ImportedFields, warnings[] }    (SAME shape as /store-import)
StoreImportReview (reused) ──► applyImport() ──► form ──► admin presses Save
```

Two steps on purpose: **search** is one cheap Text Search; **fill** is the expensive, billed step (a
Place Details call, photo downloads, a website fetch, an LLM call), so it only runs for the place the
admin actually picks, and the daily cost guard sits in front of it.

## "Content preset" vs the real Category

The admin Category dropdown has only **three** seeded values (`Salon & Barber`, `Hospital`,
`Restaurant`; `master_data`, migration 0005). The copy, though, needs to read like the specific trade.
So `lib/category-content.ts` defines **twelve content presets** that drive the generated copy and starter
services, each mapping to one real category (or to '' when none fits — the admin is told to pick):

| Preset | Real category | | Preset | Real category |
|---|---|---|---|---|
| hair_salon | Salon & Barber | | massage | Salon & Barber |
| barbershop | Salon & Barber | | tattoo | Salon & Barber |
| nail | Salon & Barber | | beauty_parlour | Salon & Barber |
| spa | Salon & Barber | | medspa | **Hospital** |
| clinic | **Hospital** | | physio | **Hospital** |
| hospital | **Hospital** | | **pet** | **'' → "pick a category"** |

`presetFor(types, name, country)` checks the presets in order, each by a Google Places type or a name
keyword, and the first match wins. Region matters for one case: a `beauty_salon` is a **beauty parlour
in India** but reads as a **hair salon in the US/Canada**. India vs US wording (queue/line,
parlour/salon, physiotherapist/physical therapist, INR/USD) switches on the store's country.

**Clinics and hospitals** (added 2026-11-28). Before then they matched no preset, so a fill for one
came back with "We couldn't match this to one of your store categories". It also had no headline,
hero subtitle, About text, FAQs or starter services. The order is:
1. **medspa** and **physio** first, so "Glow Aesthetic Clinic" and "Active Physio Clinic" keep their own copy.
2. **hospital**: "hospital(s)" or "nursing home" in the name, or the `hospital` / `general_hospital` type.
3. **clinic**: "clinic(s)", "polyclinic", "dental" or "dentist" in the name, or the `doctor`,
   `medical_clinic`, `medical_center`, `dental_clinic` or `dentist` type.
4. The salon, spa, massage and beauty presets.
5. Last, **clinic** again for "Ayurveda/Ayurvedic", "Panchakarma" or "Homeopathy/Homoeopathy" in the
   name. These words are weak signals, because Kerala-style spas and massage centres use them too, so a
   spa or massage match wins over them.

The bare words "doctor" or "Dr" in a name are deliberately **not** a signal: "Mobile Doctor" and
"Dent Doctor" are repair shops. A real doctor's practice carries Google's `doctor` type. Both presets
name staff "Doctor" and start with two unpriced services (Consultation 15 min, Follow-up visit 10 min).
The hospital FAQ says to call the hospital directly in an emergency, matching the microsite's own
clinic banner. Places with no match still warn the admin to pick a category, and they get no copy;
diagnostic labs and restaurants are among them.

## What is filled — and from where

| From Google Places | From the business website (reused link stack) | Generated (LLM, template fallback) |
|---|---|---|
| name, address, city, neighborhood | services (name, duration, price) | headline (tagline) |
| phone (split via `splitInternationalPhone`) | team members + roles | hero subtitle |
| rating, review count, Google review link | FAQs, payment methods | About heading + text |
| weekly hours | established year, social links | category Q&A |
| photos (copied into our bucket) | amenities it lists (see below) | |
| amenities (see below) | | |
| customer reviews (text, **off by default**) | | |

- **Services:** the website's if it lists them (with real prices); otherwise the preset's starter list
  with real durations and **no price** (`priceType: 'unset'`) and a warning to check them. Durations are
  never guessed away — the form requires one before Save.
- **Phone:** `splitInternationalPhone` parses Google's `internationalPhoneNumber` across markets. (The
  link importer's `parsePhone` is India-first and rejects +1, so it is NOT reused here.)
- **Hours:** day 0 = Sunday; an omitted `minute` is `:00`; a day with no period is Closed; a split shift
  collapses to earliest-open/latest-close with a warning; 24-hour opening shows as 00:00–23:59 with a
  warning.

## Amenities — three sources, one vocabulary

Amenities are free text everywhere else in the product (admin-panel, owner-web and the app all use
plain "+ Add amenity" rows; the microsite shows each with the same ✓ icon), so there was no existing
list to match. `backend/src/lib/amenities.ts` now holds the **canonical names** — and the matching
rules — and every source is mapped onto them; text that matches nothing is **dropped**, never pasted.

| Source | Confirmed? | Goes where |
|---|---|---|
| **A. Google** — `parkingOptions`, `accessibilityOptions`, `restroom`, `goodForChildren`, `allowsDogs` (only flags Google reports **true**) | Yes | the Amenities review row (ticked) |
| **B. The business website** — what the page itself lists, via the reused Groq extractor, mapped by `canonicalAmenity` ("AC" → Air conditioned, "Free WiFi" → Free Wi-Fi) | Yes | the Amenities review row (ticked) |
| **C. The category** — `amenitySuggestions` per preset in `lib/category-content.ts`, minus anything A or B confirmed | **No** | yellow **"Suggested — please check"** chips under Amenities; saved only if tapped |

- Google mapping: free lot/garage → *Free parking*; free street → *Free street parking*; any paid
  lot/garage/street → *Paid parking*; valet → *Valet parking*; the three wheelchair flags → *Wheelchair
  accessible entrance / parking / restroom*; restroom → *Restroom*; goodForChildren → *Kid friendly*;
  allowsDogs → *Pet friendly*.
- **No payment amenities.** How a store takes money (tap to pay, cards, UPI) is not an amenity: Google's
  `paymentOptions` is not requested, and payment text on the website matches nothing and is dropped.
- A then B, **de-duplicated, at most 8**.
- Honest by construction: an unqualified "Parking available" says neither free nor paid, so it is
  skipped; "Lash lift" is a service, not a lift.
- The chips are UI state only — never part of the form, so an untapped one is not saved and not written
  to a draft. A chip disappears once that amenity is in the list (tapped, typed, or confirmed). "Clear
  form" clears them.
- The five amenity fields sit in the same Places billing tier as `reviews`/`editorialSummary`, which the
  details call already requests.

## Compliance — copy only mentions features that exist

The templates **and** the LLM prompt may reference only real features: the live queue / walk-in list,
booking ahead, choosing a specific staff member, live wait times, combining services, repeat visits,
tips, and the live "it's your turn" update on the customer's phone. They must **never** claim features
this product lacks: **deposits, pet notes, service packages/bundles, or a per-turn SMS** ("we'll text
you when it's your turn" — only an opt-in ~15-minute ETA text exists). For medical stores (clinic,
hospital, med spa, physio) they also make **no medical claims, no promised results and no cures**, and
never present the online queue as a way into emergency care. `containsForbiddenClaim()` is the
backstop: model copy that trips it is discarded and the compliant template is used instead. Since
2026-11-28 it also rejects "cure / cures / cured / curing", because clinic websites, which the model
reads, often claim cures. It is word-bounded, so "manicure" and "pedicure" still pass.

> The spec's Pet-grooming "add notes about your pet" was rewritten, because that feature does not exist:
> **Q:** "How do I book my pet's grooming?" **A:** "Book a time online or join the walk-in list — choose
> a groomer, see the live wait, and we'll show when it's your turn."

## Photos and Google reviews (ToS)

- **Photos** are **downloaded server-side and copied into our own bucket** (`uploadBuffer` → stable
  `/media/...` URLs), never hot-linked from Google. The first is the banner, the second the About photo,
  the rest the gallery (bounded). The byte download goes through the SSRF guard (`safeFetchBuffer`), so
  the redirect from Google's photo endpoint to `googleusercontent` is re-validated per hop.
- **Photo attribution:** Google's terms ask that each photo's `authorAttributions` be shown. There is no
  dedicated attribution surface yet, so the credit rides in the gallery `alt` text and the review dialog
  warns. Revisit with product/legal before relying on it widely.
- **Rating, review count and the Google review link** are filled and ticked by default.
- **Individual review TEXT** is plumbed through but **unticked by default** in the review dialog with a
  caution — showing someone else's Google reviews as this store's own is a ToS/accuracy concern (the link
  importer skipped reviews entirely for this reason).

## No-Google-key fallback (designed, not built)

When `GOOGLE_MAPS_API_KEY` is blank the name endpoints answer **503 `AUTOFILL_DISABLED`**. The intended
follow-up is a Groq `groq/compound` (web-search) fallback that finds the business and returns facts, each
of which **must carry a source URL or be dropped**, with **no photos** and a prominent "found by AI search
— double-check" warning. `AUTOFILL_FALLBACK_MODEL` is wired now so enabling it later needs no new env.

## Configuration

| Var | Default | Notes |
|---|---|---|
| `AUTOFILL_ENABLED` | `false` | Shared with link autofill. Off ⇒ the card is hidden and both features' endpoints answer 503. |
| `GOOGLE_MAPS_API_KEY` | — | Google Places (New) key. **Server-side only** (header, never the URL → never logged). Blank ⇒ the name endpoints answer 503. |
| `AUTOFILL_API_KEY` / `AUTOFILL_MODEL` / `AUTOFILL_TIMEOUT_MS` | (link doc) | Reused by the category-copy writer. |
| `AUTOFILL_DAILY_LIMIT` | `30` | Soft, in-process cap on billable lookups per day (one per fill). Resets on deploy; set a HARD quota in Google Cloud too. |
| `AUTOFILL_FALLBACK_MODEL` | `groq/compound` | Reserved for the not-yet-built web-search fallback. |

Rate limits (`middleware/rate-limit.ts`, keyed by admin id, in memory — a backend restart resets
them): `storeAutofillNameSearch` **100/hour** and `storeAutofillNameFill` **100/hour** (raised from
30 and 10 on 2026-11-25 — a "Find & fill" with one match spends a search and a fill). Hitting one
answers 429 `RATE_LIMITED` ("Too many requests"). Billed Google usage is capped separately by
`AUTOFILL_DAILY_LIMIT`.

Error codes (standard envelope): `AUTOFILL_DISABLED` 503 · `AUTOFILL_DAILY_LIMIT_REACHED` 503 ·
`PLACE_NOT_FOUND` 422 · `VALIDATION_ERROR` 400 · `RATE_LIMITED` 429. (A website read during a fill is
best-effort — any failure is a warning, not an error.)

### Getting a Google key

1. Create a Google Cloud project and **enable Places API (New)**.
2. Create an API key; restrict it to the **Places API** (server-side use, so restrict by API, not by
   HTTP referrer).
3. **Enable billing**, and set a **daily quota** in the console as a hard backstop behind the soft
   `AUTOFILL_DAILY_LIMIT`. The billed SKUs are Text Search, Place Details and Place Photo.
4. Put the key in `backend/.env` locally and in the Coolify environment for deployed backends — never in
   the repo (`.env*.example` carry it blank).

## Tests

- `backend/tests/unit/category-content.test.ts` — every preset's distinct copy and price-free starter
  services; the forbidden-phrase guard (both markets, including "cure"); six canonical amenity
  suggestions per preset; the clinic/hospital matching order (by type and by name, specific presets
  first, "Ayurvedic" losing to a spa or massage match).
- `backend/tests/unit/amenities.test.ts` — the canonical vocabulary: every Google flag, website
  phrasings that map ("AC", "Free WiFi", "Bridal suite"…) and ones that must not ("Parking available",
  "Lash lift"), the A-then-B order, the cap of 8, and suggestions minus confirmed.
- `backend/tests/unit/store-autofill-map.test.ts` — the pure `mapPlaceToFields` against realistic Google
  JSON: an Indian beauty parlour (omitted minutes, Sunday closed, Instagram website) and a US barbershop
  (split shift, +1 phone).
- `backend/tests/unit/store-autofill-name.test.ts` — the real admin router with the DB, Google and Groq
  stubbed: auth, validation, 503 gating, employee access, search 1-vs-many, the fill mapping, photos
  copied to `/media`, template fallback when the copy model is down, `PLACE_NOT_FOUND`, the daily limit,
  and the per-admin hourly limits. It also has the 2026-11-28 regression: an Indian clinic whose only
  Google types are generic fills **Hospital** with clinic copy and no "couldn't match" warning, while a
  hardware store still gets the warning and no copy.
- `backend/scripts/smoke-store-autofill-name.mjs` — against a running API; negatives need no credentials,
  the real search+fill is opt-in via `SMOKE_PLACES_QUERY`.
- **Not automated:** the admin-panel dialog itself — the repo has no browser test runner.
