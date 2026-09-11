# Cookie consent (GDPR / CCPA) — v1

**Status:** shipped 2026-09-11. **Scope:** `frontend/` and `backend/` only.
Not touched: `owner-web/`, `admin-panel/`, `app/`.

A consent banner, a preferences dialog, a `/cookies` policy page, and a server-side audit log.
No new npm dependencies, and **no analytics or advertising tag was added** — see §6.

---

## 1. The consent record

One cookie, `cookie_consent`, holding JSON:

```jsonc
{
  "visitorId": "6d344ace-b109-4527-bcf2-4f7ffb59cb42",
  "necessary": true,
  "analytics": false,
  "marketing": false,
  "preferences": false,
  "timestamp": "2026-09-11T06:13:19.626Z",
  "version": "2026-09-11"
}
```

Constants live in `frontend/src/lib/consent.ts`: `COOKIE_NAME`, `CONSENT_VERSION`,
`CONSENT_MAX_AGE_DAYS` (182) / `CONSENT_MAX_AGE_SECONDS`, `Z_INDEX`, `DEFAULT_CATEGORIES`.

### Cookie attributes, and the reasoning

| Attribute | Value | Why |
|---|---|---|
| `Path` | `/` | Every page on the origin reads the same answer. |
| `Max-Age` | 182 days (~6 months) | Long enough not to nag, short enough that consent stays current. |
| `SameSite` | `Lax` | Only this site's own pages read it; Lax still survives a top-level navigation in. |
| `Secure` | https only | Keyed off `location.protocol`, **not** a build flag. Setting `Secure` on plain http makes the browser silently DROP the cookie, which would read as "consent mysteriously fails" on a local production build. |
| `HttpOnly` | **not set** | The client provider must read it to decide whether to show the banner. Nothing secret is in it. |
| `Domain` | **deliberately absent** | See below. |

**Omitting `Domain` is the important one.** A cookie set with no `Domain` attribute is
*host-only*: the browser sends it back only to the exact host that set it. Had it been set as
`Domain=.tejotime.com`, this cookie — and the `visitorId` inside it — would be attached to every
single request to `business.tejotime.com` and `admin.tejotime.com`, shipping a marketing-site
consent record to the owner portal and the admin panel on every API call. That is a privacy leak
and a pointless per-request cost.

Verified in a real browser: Chrome reports `domain: "localhost"` with no leading dot, i.e.
host-only.

### visitorId

Generated with `crypto.randomUUID()` **at the moment the visitor clicks** Accept All, Reject All
or Save Preferences — never before, and never anywhere but inside the cookie JSON. There is no
pre-consent identifier, no localStorage key, and no fingerprinting. Under GDPR the identifier is
itself the personal data, so minting one in order to record that somebody has *not* consented
would defeat the point.

Verified: on a first visit, before any click, `document.cookie` is empty and `localStorage` has
zero keys.

### Version bumps

If the stored `version` differs from `CONSENT_VERSION`, the banner returns — but the modal
pre-loads the visitor's **previous** answers rather than resetting everything to off, and the old
cookie is left alone until they choose again. Bump the version when the categories or their
meaning change, not for copy tweaks.

### Revocation

Turning analytics off after previously accepting does two things: pushes a Consent Mode update
with `analytics_storage: denied`, and calls `clearAnalyticsCookies()` to delete any `_ga`, `_gid`
or `_gat*` cookies present. Without the second step the `_ga` identifier would survive the very
consent that was just withdrawn. Because a cookie can only be deleted with the attributes it was
set with, the sweep fires an expiry across host and registrable-domain variants.

---

## 2. UI

Built from existing `globals.css` tokens only — `--brand-ink`, `--brand-accent`,
`--surface-card`, `--border-subtle`, `--text-body`/`-strong`/`-muted`, `--radius-*`,
`--shadow-*`, `--control-h-md`, `--ring`, `--dur-*`, `--ease-standard`. No new colours.

**`globals.css` defines no dark-mode tokens, so there is deliberately no dark variant.** Inventing
one would make this the only component in the app with a second, unmatched colour scheme.

### Banner

A rounded card at both sizes — inset 12px on a phone, an 880px centred card 24px off the bottom
from 768px. Backdrop blur so it reads as an overlay rather than another page section. A cookie
glyph in a brand-tinted circle anchors the copy; without it the banner opened as a wall of small
grey type.

Flush square corners on mobile were the first version, and they read as a system slab bolted to
the page — the wrong register for a salon's own booking page.

**Accept All and Reject All are the same height and font weight** — 44px tall, 600 weight, 15px.
This is a legal requirement under the EDPB's dark-pattern guidance, not a style preference:
refusing must be as easy as accepting. Only *Customize* is allowed to be quieter.

On phones the two share a **2-column grid**, so their widths are identical by construction rather
than by coincidence, and the banner loses a whole button's worth of height. Customize sits
underneath rather than stranded below two full-width blocks. Measured: 127×44 each at 320px,
162×44 each at 390px; at 1366px both are 44 tall at weight 600 (widths differ only by label
length).

**The banner publishes its height as `--tt-consent-h` on `<html>`.** The chat launcher adds that
variable to its own bottom offset, so it steps over the banner instead of sitting on top of it —
verified as non-overlapping at 320, 390 and 1366px. The variable is absent (and so resolves to
`0px`) whenever the banner is not on screen.

Entrance is slide-up + fade over 240ms; under `prefers-reduced-motion` it fades with no
transform, including at the desktop breakpoint where the element is also `translateX(-50%)`.

**No layout shift.** The banner only animates `opacity` and `transform`, both composited. It
reserves space by setting `document.body` bottom padding to its measured height while visible,
which extends scroll height below the fold rather than moving anything on screen — that is what
keeps it off the hero CTA on a phone.

**Tab order.** The banner renders *before* `{children}` in the provider. It is `position: fixed`
so DOM order does not move it visually, but it decides where it lands in the tab sequence.
Rendered last it took **60+ tab stops** to reach; rendered first it takes **1**, which is what
makes focus order match visual order (WCAG 2.4.3).

### Microsite timing

On `/{phone}` booking pages the entrance is held back 1500ms so somebody who just scanned a QR
code on a salon door reaches the check-in button first. Same component, same consent state, only
the entrance deferred. Measured: microsite first visible at 1818ms, landing page at 151ms.

### Modal

Centred 560px card on desktop, bottom sheet on mobile, `rgba(0,0,0,0.5)` scrim. Click-outside and
Escape both cancel and save nothing — a dismissal is not a choice.

`role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`, focus trap, body
scroll lock, and focus returned to whatever opened it. Necessary shows an "Always active" pill
rather than a switch nobody can move. Optional categories are never pre-checked.

Each category is its own bordered card that tints when switched on, so state is legible without
reading the knob; plain divider rules made the label, the description and the switch read as
three loose columns. The footer is side by side from 768px — two stacked full-width buttons on a
560px card read as a phone sheet that wandered onto a desktop.

**Focus lands on the dialog container, not on its first control.** There is a visible close
button, and focusing it first meant the Enter keystroke that opened the dialog finished landing
on it: keydown activated Customize, the dialog mounted and took focus, and the trailing
char/keyup of that same press activated Close — the dialog opened and vanished in one keystroke.
Focusing the container (`tabIndex={-1}`) is the WAI-ARIA Authoring Practices alternative and has
no such adjacency. Caught by the keyboard test, which is the only reason it did not ship.

`ConsentToggle` is a real `<button role="switch" aria-checked>` — hand-built, no library — so
Space and Enter work without re-implementing keyboard behaviour.

Verified keyboard-only: 1 tab to the banner, Enter on Customize opens the dialog, focus moves
inside, Space toggles all three switches, Tab wraps within the dialog, Enter on Save Preferences
writes the cookie and closes.

---

## 3. Backend

**Migration** `backend/db/migrations/0026_consent_log.sql` (idempotent; applied twice to confirm).

```
consent_log(id uuid pk, visitor_id uuid, necessary bool, analytics bool, marketing bool,
            preferences bool, policy_version text, country_code char(2) null, created_at timestamptz)
index idx_consent_log_visitor_created on (visitor_id, created_at desc)
```

Append-only: a change of mind adds a row, so the history of what was agreed when survives.

**`POST /api/v1/public/consent`** — `limiters.consent` → `validate(zod .strict())` →
`asyncHandler` → `consent.service.ts`. Returns **204** with no body.

Two privacy rules enforced server-side rather than trusted to the client:

- **`countryCode` is never taken from the body.** The schema is `.strict()`, so sending one is a
  400. It is derived from `CF-IPCountry` / `x-vercel-ip-country` / `x-country-code`, upper-cased,
  and Cloudflare's non-answers (`XX`, `T1`) become null rather than being stored as places.
- **No IP address and no user agent is stored or logged.** Country is the coarsest signal that
  still answers the only question we have of it — was this visitor somewhere GDPR applies. A full
  IP would make the audit row more sensitive than the consent it documents.

Its own rate-limit bucket at 60/hour rather than `publicWrite`'s 20/hour: one visitor
legitimately writes several rows (accept, then reopen settings and change their mind), and being
throttled *while withdrawing consent* would be the worst possible failure.

**The client never awaits this call and never surfaces its errors.** The visitor's own cookie is
what governs behaviour; this is the audit copy. A backend outage must not block a click or keep
the banner on screen.

---

## 4. The `/cookies` page

`frontend/src/app/cookies/page.tsx` renders `t.cookies` through the existing `LegalPage` shell,
so it matches `/privacy`, `/terms` and `/accessibility` exactly. Added to `t.legal.docNav` and to
the Legal column of `landingData.footerCols`.

It documents **only cookies that actually exist**: `cookie_consent`, the owner-portal session
cookies, the admin session cookie, and the booking-page localStorage keys — each with purpose,
category, duration and party, and a note for the ones this site does not itself set. It states
plainly that TejoTime sets no analytics and no marketing cookies.

Listing Google Analytics or a Meta Pixel "for completeness" would be a false statement about what
the product does, which is worse for compliance than having no policy. `/privacy` gained one
cross-link paragraph in "2. Information we collect"; the rest of that document is untouched.

---

## 5. Where Cookie Settings appears

`CookieSettingsButton` reopens the modal from the Legal column of the homepage footer
(`app/page.tsx`), the shared marketing footer (`MarketingChrome.tsx`), and the microsite's bottom
links (`MicrositeClient.tsx`). Withdrawing has to be as reachable as consenting, which a
once-only banner cannot provide.

---

## 6. Consent Mode, and the fact that no tag exists

There is no Google Analytics, GTM, Meta Pixel, Hotjar, Clarity, Segment, PostHog, Sentry,
Intercom or Vercel Analytics anywhere in this repo, and **this change did not add one**.

`lib/consentMode.ts` pushes **denied** defaults for `analytics_storage`, `ad_storage`,
`ad_user_data`, `ad_personalization`, `functionality_storage` and `personalization_storage` on
every page load, before anything else could queue a tag. That ordering is the whole mechanism:
once a Google tag has loaded without the defaults, the window is gone. The guarded failure is a
tag being pasted into the layout months from now and collecting from EU visitors who never agreed.

`loadAnalyticsIfAllowed()` reads `NEXT_PUBLIC_GA_MEASUREMENT_ID`. **Unset today, so it is a
no-op** — no network request, no cookie. The file carries the full enable checklist.

Verified in the browser: on first load `dataLayer` contains exactly one `consent default` entry
with everything denied; after Accept All, a `consent update` with everything granted; after
withdrawing analytics, `analytics_storage: denied`.

---

## 7. Verification

Everything below was executed, not assumed.

| Check | Result |
|---|---|
| `npm test` (backend) | 12 files, **131 tests** passing (7 new in `public-consent.test.ts`) |
| `npx tsc --noEmit`, both apps | clean |
| `npm run lint` (frontend), `npx eslint .` (backend) | clean |
| `npx next build` | succeeded; `/cookies` prerendered as static |
| Migration applied twice | second run skips — idempotent |
| Live `POST /public/consent` | 204; row stored with `country_code = IE` from `CF-IPCountry` |
| Forged `countryCode` in body | 400 `VALIDATION_ERROR` |
| Storage before any choice | cookies empty, localStorage empty |
| Banner absent from server HTML | 0 occurrences of the markup or copy |
| Cookie attributes | host-only, Path=/, SameSite=Lax, not HttpOnly, ~182 days |
| Reject/Accept parity | both 44px tall, weight 600, equal width at 320px |
| Keyboard-only path | 1 tab to banner; Enter opens; Space toggles all 3; trap wraps; Enter saves |
| 320px | no horizontal overflow |
| Console | no hydration warnings, no exceptions |
| Microsite delay | banner at 1818ms vs 151ms on the landing page |

**Not verified:** behaviour against a real CDN edge (the country header was simulated with curl
and CDP), and `clearAnalyticsCookies()` against genuine `_ga` cookies, since no analytics tag
exists to create them. Both are exercised by unit-level and header-level tests but not end to end.
