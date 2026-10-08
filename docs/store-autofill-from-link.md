# Autofill a store from a link

In the admin panel's **Create Store** and **Edit Store** form (one shared component,
`admin-panel/src/components/StoreForm.tsx`) an admin can paste a link — normally the business's own
website — and have the form pre-filled, like resume autofill. **Nothing is applied until the admin
reviews it**, and nothing is saved until they press Save as usual.

Scope: **admin panel only.** owner-web and the mobile app only have edit-only profile editors and
were deliberately left out of v1 (CLAUDE.md §11.1). If they get it later, the backend endpoint is
reusable as is (it is admin-JWT-gated today, so an owner-side route would be a new thin wrapper).

## Flow

```
StoreForm ──POST /api/store-import──► admin-panel route (attaches admin JWT)
          ──POST /admin/store-import─► backend
               1. safeFetchText(url)          lib/safe-fetch.ts       SSRF-guarded GET
               2. extractPage(html)           lib/html-extract.ts     JSON-LD, meta, socials, text
               3. storeExtractor.extract()    integrations/store-extract.ts   Groq, JSON mode
               4. sanitizeExtraction()        modules/admin/store-import.service.ts
          ◄── { source, fields, warnings }
StoreImportReview (checkbox per field) ──► applyImport() ──► form state ──► admin presses Save
```

- **Read-only.** The endpoint writes nothing. Values reach a store only through the normal
  create/update path, which re-validates against `storeFieldsSchema`.
- **Deterministic first.** If the site publishes schema.org `LocalBusiness` JSON-LD, its name, phone,
  address, opening hours, founding year and social profiles are taken as written and **win over the
  model's reading** of the same page. The model fills what a machine cannot read: tagline, about
  heading, description, services, staff, FAQs, amenities, payments.
- **Graceful degradation.** Model down/rate-limited but the site has structured data → the
  structured fields are still returned, with a warning. Model down and nothing structured → 502
  `EXTRACTION_FAILED`.

## What is filled — and what deliberately is not

Filled: name, category, tagline (the "Headline on your page"), hero subtitle, address, area (the
optional "Neighborhood shown on your page", since 2026-10-05), city, phone, about heading,
description, established year, the five social links, weekly hours, services (with fixed / range /
"no price" pricing), team members, FAQs, amenities, payment methods.

**Not filled in v1:**

| Left out | Why |
|---|---|
| Logo / hero / about / gallery images | Hot-linking a third party's pictures is fragile and inappropriate; doing it properly means copying into our bucket. Follow-up. |
| Theme / appearance | Not on a web page. |
| Rating, review count, review text | Would present someone else's reviews as this store's own. |
| Owner login | Not on a web page. |
| Phone on a **saved** store | The phone is locked once set (`PHONE_LOCKED` 409), so offering it would offer an error. |

Phone parsing is **India-first** (`+91` / `0` / bare 10-digit); a number in another format is
dropped rather than guessed (the admin types it).

## The first fetch skips the review

The **first** fetch into a still-empty **create** form applies everything at once, with no dialog
(`StoreForm.runImport`): every row is a gap-fill, so asking the admin to tick them was pure friction.
"Empty" is `isPristineCreate` (`lib/store-import.ts`): no typed name / category / tagline /
description / address / area / city and no real service or staff row (the blank placeholder rows and
the default hours do not count), **and** no earlier fetch was applied to this form (a `hasImported` ref).
Picking a category pre-fills the headline with the store type's first suggestion (2026-10-05), and
the About heading and text with the store type's starter (2026-10-08, client review row 36). That
self-filled text is never counted as typed data: `runImport` blanks each self-filled field
(`isAuto` in `StoreForm`) before `isPristineCreate` and the review items see the form, so the page's
own headline or About text shows as a ticked fill. A self-filled field the page gave nothing for
keeps following the category the import may have set. The picked category itself still counts as
typed data, as before.
The fill is **silent**: no "Filled in N items" banner and no warnings box, whether the page gave 2
fields or 15 — the admin just sees the form filled and presses Save when ready. (Only "nothing
found" is said, since a fetch that visibly does nothing reads as a broken button; a blank duration
is not announced either — Save names each service that still needs one.) Anything else — an edit, a form with typed data, a second fetch — still opens the review
dialog below, because its "Replaces" rows are the only protection against overwriting the admin's
own edits.

## JavaScript-rendered sites (single-page apps)

The importer reads the HTML the **server** sends; it does not run JavaScript. A React/Vite/Wix-style
site ships an empty `<div id="root">` and builds everything in the browser, so its visible text is
nothing and it has no JSON-LD — only `<title>` and `<meta name="description">`. (This, not a
login/sign-up wall, is why `https://www.aoneunisexsalon.in/` used to fail with `PAGE_UNREADABLE`.)

Such a page is now **read anyway** when its meta description is at least 30 characters
(`MIN_META_DESCRIPTION_CHARS`): the model is given the title and description and returns what they
state — typically the name, a tagline, the area/city and the category. The result carries a warning
first: "This page loads most of its content with JavaScript, so only a little could be read (its title
and description). Fill in the rest by hand." A title alone is still not enough (a login wall has one),
so a page with neither text, structured data nor a description is still `PAGE_UNREADABLE` and makes no
model call. The prompt also tells the model to ignore login / sign-up / account / cart / cookie /
navigation text.

**Not possible without a browser:** the services, phone, hours and social links of such a site live in
its JavaScript bundle and are never in the HTML. Reading them would need a headless browser (or
scraping string literals out of the bundle) — a separate, heavier feature with its own SSRF and
deployment questions; not built.

## Re-fetching the same link: only what the page changed

A second fetch of the **same link** is compared against the **previous fetch**, not just against the
form. Fetch once, change the address on the page, fetch again → only the address is up for review.
Without this, every re-fetch re-offered everything the admin had since edited by hand.

- `diffImportedFields(prev, next)` (`admin-panel/src/lib/import-diff.ts`, pure) keeps only what
  differs: changed scalars (case/space-insensitive), phone as one unit, only the **days** of hours that
  changed, only **new** services / staff / FAQs / amenities (by name / question), and payments if the
  set changed. A value the page **no longer states is never offered** — absence is not an instruction
  to blank a field. What is left then goes through `buildImportItems` as usual (so a value the form
  already holds is still dropped and a "Replaces" row is still unticked).
- The previous fetch is recorded **when a fetch is applied** (auto-apply or "Apply selected"), or when a
  re-fetch finds nothing to offer. A dialog the admin **cancelled** applied nothing, so the next fetch
  still offers those values.
- A different link is not diffed against the previous one — it behaves like a first fetch.
- If nothing changed, no dialog opens: the form shows "Nothing has changed on that page since your last
  fetch." The dialog's intro says "Only what changed on the page since your last fetch is listed." The
  "N services had no stated duration" warning is not repeated on a re-fetch (it would be about services
  already imported).
- Checked by `npm run test:import-diff` (12 checks, a framework-free `tsx` script like `test:theme` and
  `test:responsive`); the wiring in `StoreForm` is not covered — there is no browser runner.

**Unknown values are left unknown, not guessed.**
- A service whose page states **no duration** comes back `durationMinutes: null` (it used to be filled
  with 20 minutes, which then got saved as fact and sized every slot and wait estimate). The form shows
  a **blank** duration box (the backend still returns the warning "N services had no stated duration — enter it
  before saving", and the review dialog shows it; the silent first-fetch fill does not). Duration is still required by the API and DB, so **Save is blocked** with a message naming
  each such service ("Enter how long this service takes.") until it is filled in.
- A service with **no price** comes back as `priceType: 'unset'` — the **"No price"** mode — never a
  zero the microsite could print as free.

## The review step

`StoreImportReview` lists only values that would **change something** (a found value already in the
form is not shown). Each row is a checkbox:

- **Ticked by default:** rows that only fill an empty field, and lists that append.
- **Unticked by default, tagged "Replaces":** rows that would overwrite what the admin already has,
  with "Currently: …" shown underneath.
- Lists (services, team, FAQs, amenities) **append** and never duplicate (case-insensitive by
  name / question). A blank placeholder row on the create form is not treated as data.
- Hours overwrite only the days the page named; an unmentioned day is unknown, not closed.
- A create-form category pick also suggests the theme preset, exactly like the category `<select>`.

The pure merge rules live in `admin-panel/src/lib/store-import.ts` (`buildImportItems`,
`defaultSelection`, `applyImport`). Its `ImportedFields` type is **hand-mirrored** from
`ImportedFields` in the backend service — change both together.

## Security model

The URL is attacker-influenced input and the page text is attacker-controlled, so there are two
separate defences.

**SSRF (`lib/safe-fetch.ts`).** Nothing else in the backend fetches a caller-supplied URL.

- `http`/`https` only, ports 80/443 only, no `user:pass@`, no `localhost` / `*.local` / `*.internal`.
- Every resolved address is checked against private, loopback, link-local (incl. the
  `169.254.169.254` metadata endpoint), CGNAT, multicast, reserved, IPv6 ULA/link-local, and
  IPv4-mapped / NAT64 / 6to4 forms — **inside the socket's `lookup`**, so the address checked is the
  address connected to (defeats DNS rebinding; resolving first and then calling `fetch` would not).
- IP-literal hosts skip DNS, so they are checked up front; `new URL()` has already normalised
  `2130706433` / `0x7f.1` spellings.
- Redirects are followed by hand (max 3) and **every hop is re-validated**.
- 10 s total timeout, 1.5 MB cap, `text/html` / `xhtml` / `text/plain` / `ld+json` only,
  `accept-encoding: identity` (no compression bombs).

**Prompt injection.** The prompt tells the model the page is untrusted data and to ignore
instructions in it — but that is not relied on. Model output is reduced by `sanitizeExtraction` to a
fixed schema and clamped to the form's limits: markup and `<script>` blocks are stripped, category
must exactly match a `master_data` `business_category`, social links must be real profile URLs on
the matching network, list sizes are capped, unknown keys are dropped. And the admin sees every
value before it reaches the form.

**Abuse.** Behind the admin JWT (owner **and** employee admins — both can create stores);
`limiters.storeImport` allows **10 per hour per admin**, because each call is an outbound fetch plus
a metered LLM call.

## What can and cannot be read

Works: a business's own website, and directory pages that server-render their content (and ship
JSON-LD).

Poor: Instagram, Facebook, Google Maps and other login-walled or JavaScript-only pages return almost
no text (Instagram yields little more than the bio line, so expect a sparse, low-value result). The backend detects that (under ~200 characters of text and no structured
data) and answers **422 `PAGE_UNREADABLE`** with a message pointing at the business's own website,
rather than letting the model invent details. Social profile *links* are still picked up from a
business's own site.

## Configuration

| Var | Default | Notes |
|---|---|---|
| `AUTOFILL_ENABLED` | `false` | Off ⇒ the endpoint answers 503 `AUTOFILL_DISABLED` and never fetches |
| `AUTOFILL_API_KEY` | — | A **Groq** key. Server-side only, never `NEXT_PUBLIC_*`. Blank with the flag on ⇒ 503 |
| `AUTOFILL_MODEL` | `openai/gpt-oss-120b` | Any Groq chat model with JSON mode. Groq retires models (the first default, `llama-3.3-70b-versatile`, was already gone from the key's catalogue) — a 404 in the logs means change this, no deploy needed. `reasoning_effort: low` is sent only to `gpt-oss` models |
| `AUTOFILL_TIMEOUT_MS` | `20000` | Model call only |

Deliberately **not** `CHATBOT_*`: that would tie this admin tool to the public help chat's flag and
its 300-token output cap. The key goes in `backend/.env` locally and in the Coolify environment for
deployed backends — never in the repo (`.env*.example` carry it blank).

Error codes (standard envelope): `AUTOFILL_DISABLED` 503 · `LINK_BAD_URL` / `LINK_BLOCKED` /
`LINK_TIMEOUT` / `LINK_TOO_LARGE` / `LINK_BAD_TYPE` / `LINK_HTTP_ERROR` / `LINK_NETWORK` /
`LINK_TOO_MANY_REDIRECTS` 422 · `PAGE_UNREADABLE` 422 · `NOTHING_FOUND` 422 ·
`EXTRACTION_FAILED` 502 · `RATE_LIMITED` 429.

## Tests

- `backend/tests/unit/safe-fetch.test.ts` — IP classification, URL parsing, and the fetcher against a
  throwaway loopback server (reachable only through test-only overrides; a test proves the default
  guard refuses that same server), including redirect-to-metadata, DNS-rebinding-style resolution,
  size, type and timeout.
- `backend/tests/unit/html-extract.test.ts` — JSON-LD, hours, socials, text extraction.
- `backend/tests/unit/store-import.test.ts` — the real admin router with the DB, page fetch and Groq
  stubbed: auth, validation, flag gating, employee access, sanitisation of hostile model output,
  degradation paths, the real guard wired in front of the fetch, and the rate limit.
- `backend/scripts/smoke-store-import.mjs` — against a running API (negative cases need no
  credentials; the real import is opt-in via `SMOKE_IMPORT_URL`).
- **Not automated:** the admin-panel dialog itself — the repo has no browser test runner.
