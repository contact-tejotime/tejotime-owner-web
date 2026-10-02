# Store currency — one code per store, every surface prints its symbol

**Status:** shipped 2026-10-02 · branch `feat-jay`.

## The rule

A store prices in exactly one currency: **`business.currency`** (ISO 4217, `char(3)`, default
`INR`), set by the platform admin in the admin panel's store **Settings → Currency** picker. Owners
cannot change it (`owner-web` `StoreProfileEditor` leaves it out on purpose — changing it would
relabel every price already recorded without converting it).

Amounts are stored as integer minor units (`*_paise`, i.e. paise/cents) and cross the API as
`{ amount, currency }`. **A client never assumes ₹** — it reads the symbol off the code.

## Why this doc exists (the bug, 2026-10-02)

A store set to `$ — US Dollar (USD)` still showed **₹** in:

| Surface | Where | Cause |
|---|---|---|
| owner-web | checkout sheet amount box (`QueueDetailSheet`) | literal `₹` |
| owner-web | Settings → Services price boxes (`ServicesEditor`) | i18n `services.pricePrefix: "₹"` |
| owner-web | every formatted amount (`lib/format.ts`) | right symbol, but the hardcoded `en-IN` locale printed `$12,34,567` |
| app (iOS + Android) | checkout amount box, add-on rows, suggested total (`DetailPanel`) | literal `₹` |
| app | service editor price boxes (`ServiceEditSheet`) | i18n `serviceSheet.pricePrefix: "₹"` |
| app | `lib/mappers.ts` `formatMoney` | one decimal place: `$12.50` printed as `$12.5` |
| admin-panel | "Autofill from a link" preview (`lib/store-import.ts`) | literal `₹` |

And the root gap: **`/auth/me` and login did not carry the currency**, so a client had nothing to
read it from for a price *input* (as opposed to a returned amount). Staff cannot call
`GET /business` (it needs `profile`), and a store with no services has no `Money` to read a code
off.

## Where each surface gets the code

| Data | Carries currency from |
|---|---|
| `POST /auth/login`, `GET /auth/me` → `business.currency` | `business.currency` (`auth.service.ts` `businessSummary`) — **every role** |
| `GET /business` → `currency` | `business.currency` (owner/co-owner with `profile`) |
| Queue billing (`GET /queue/:id`) `serviceAmount` / `extrasAmount` / `suggestedAmount` | `business.currency` (`queue.service.ts` `billingFor`); `extras[].pricePaise` is bare — use `serviceAmount.currency` |
| Dashboard revenue, customers' `totalSpend`, admin analytics | `business.currency` |
| Service `price` / `priceMax` | `service.currency` — copied from the business on create, rewritten for every service by an admin store save (`admin.service.ts` `syncServices`) |
| Public microsite `currency` | `business.currency` |

## Formatting

Every surface formats through the **same static symbol map**, `lib/currencies.ts` →
`currencySymbol(code)`. It is a generated ISO 4217 list (static so Hermes never needs
`Intl.DisplayNames`), **mirrored by hand, byte-identical** in `admin-panel/`, `app/`, `frontend/`
and `owner-web/` (CLAUDE.md §11). A missing code falls back to `₹` (the column default); an
unknown code prints the code itself.

Display rule, identical in owner-web `lib/format.ts`, app `lib/mappers.ts` and admin-panel
`lib/format.ts`:

- symbol from `currencySymbol(money.currency)`, then the number;
- **lakh grouping (`en-IN`) for INR only**, `en-US` grouping for everything else
  (`₹12,34,567` vs `$1,234,567`);
- whole amounts print with no decimals, fractional ones with exactly two (`$12.50`);
- admin-panel compact figures use L/Cr for INR and k/M otherwise.

Price **inputs** take their prefix from the session's `business.currency`:
owner-web passes `me.business.currency` into `ServicesEditor`; the app reads
`useAppState().business?.currency` (kept on every `GET /business` refresh by `mapBusinessDetail`).
The checkout amount box uses the billing DTO's `serviceAmount.currency` (owner-web shows no
prefix until billing lands — the box is disabled then anyway; the app falls back to the session).

## Deliberately still INR

- **Platform plan pricing** in the admin panel (`dashboard` MRR, `billing`) — that is TejoTime's
  own price list (`PREMIUM_PLAN_PRICE_INR`), not store money.
- **The app's pre-login onboarding art** (`onboarding.spendValue: "₹4,850"`,
  `todayRevenue: "₹12,400"`) — illustration shown before any store is known.
- `DEFAULT_CURRENCY` / the column default stay `INR`; a new store gets USD only when the admin
  picks it.

## Tests

- `backend/tests/unit/auth-session-currency.test.ts` — `/auth/me` returns the store's currency for
  an owner and a staff login. Its pool stub answers with only the columns the SQL names, so it
  fails against a select list without `currency` (verified before the fix).
- `backend/scripts/smoke-rest.mjs` — login and `/auth/me` carry `INR` for the seeded tenant, and
  checkout billing is in that same currency. Needs a running API + seeded throwaway DB (§12.4).
- No UI test runner exists for owner-web / admin-panel / app (§12.6); those changes are covered by
  type-check + lint and a manual look on a USD store and an INR store, on iOS **and** Android.
