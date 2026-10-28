# Customer list: no plan limit, no upgrade prompt

**Date:** 2026-10-28 · **Applies to:** `backend/`, `owner-web/`, `app/` (iOS and Android)

## Decision

Every store sees its whole customer book, on every plan. The owner asked for the "Upgrade to
Premium" prompt to go and for all customer details to show without a limit.

Before this, a **Free** store's `GET /customers` returned only its latest
`FREE_PLAN_CUSTOMER_LIMIT` (2) customers. The rest were counted in `meta.lockedCount`, and
owner-web ended the Customers grid with a "25 more clients locked · Upgrade to Premium" card that
linked to Settings → Subscription.

## What changed

| Where | Change |
|---|---|
| `backend/src/modules/customers/customers.routes.ts` | `GET /customers` no longer looks at the plan to decide how many rows to return. `meta.lockedCount` is always `0`. |
| `backend/src/modules/subscription/subscription.service.ts` | `GET /subscription` no longer returns `limits.customerListLimit`. |
| `backend/src/config/env.ts`, `backend/.env*.example` | `FREE_PLAN_CUSTOMER_LIMIT` removed. A value still set in a deployment is ignored, because zod strips unknown keys, so it cannot break boot. Delete it from Coolify at leisure. |
| `owner-web` Customers (`/customers`) | Upgrade card, its CSS and its strings removed. The subtitle says "Latest N of M" when the page size cut the list short, otherwise "N total". |
| `owner-web` Settings → Subscription | The page (`/settings/subscription`), its Settings row, its tile, its `PATH_MODULES` entry, the unused `/api/subscription/[action]` BFF route and `getSubscription` were all **deleted**. The URL now 404s. The help chat's "pricing" action opens the website's pricing section from every page. |
| `owner-web` Team logins | The "Subscription & billing" row is hidden from the permission grid and the card summary, as on the app. It only ever opened the deleted page. |
| `app` Customers tab | The subtitle uses the same `shown < total` rule. The app never showed an upgrade prompt ([mobile-no-in-app-purchases.md](./mobile-no-in-app-purchases.md)). |

## What deliberately did not change

- **The page size.** `GET /customers` still returns at most `limit` rows, newest first: default
  100, maximum 200. The owner chose to keep it. A store with more than 100 customers sees the
  newest 100 and the subtitle "Latest 100 of 312". Search runs on the server, so anyone past 100
  is still one search away. A customer's visit history (`GET /customers/:id/visits`) is likewise
  the latest 100.
- **The response shape.** `plan` and `meta.lockedCount` stay in the `GET /customers` payload,
  because app builds already installed on owners' phones read both
  (`app/src/state/store.tsx` → `customerMeta`, `plan`).
- **The plan itself.** `subscription.plan` (`free` / `premium`), the `/subscription`,
  `/subscription/upgrade` and `/subscription/cancel` endpoints, the `billing` permission module
  (still grantable, so saved values round-trip), and the admin panel's Billing / MRR figures are
  all untouched. Premium simply unlocks nothing today.
- **The marketing site's pricing section** (`frontend/`) still describes the plans. Changing what
  is sold is a separate decision.

## Tests

- `backend/scripts/smoke-rest.mjs`, section "CUSTOMERS (no plan gate)": a free store with 4 or
  more customers gets `shown === total`, every row, and `lockedCount === 0`.
  - It failed against the old code: 136 passed, 2 failed.
  - It passes now: 138 passed, 0 failed.
  - Both runs were on a migrated, freshly seeded throwaway local DB.
- `backend` `npm test`: 48 files, 598 tests passed.
