# Mobile app: no subscription or upgrade UI (App Store 2.1(b))

**Date:** 2026-09-17 · **Applies to:** `app/` (iOS and Android — one codebase)

## Why

App Review rejected **Tejotime 1.0 (2)** (submission `c776f307-9ae3-4ea9-bda4-862e6b7710d4`,
reviewed 2026-09-14 on an iPad Air 11-inch M3) twice under **guideline 2.1(b)**:

1. The app referenced a subscription, but no In-App Purchase product was submitted.
2. "Upgrade to Premium" did nothing. The Settings → Subscription screen's button only showed a
   "Welcome to Premium" toast, and its "Free trial · 8 days left" copy was hard-coded.

TejoTime has no StoreKit or Play Billing integration, and `PAYMENTS_ENABLED` is false. So the
mobile app now **sells nothing and says nothing about plans**.

## What was removed from `app/`

| Removed | Where |
|---|---|
| Settings → Subscription screen and route | `settings/subscription.tsx`, `navigation/routes.ts` |
| Subscription row (with "Trial" badge) in Settings → Account | `(tabs)/settings.tsx` |
| Locked-customer footer: blurred placeholders, upsell copy, Upgrade button | `(tabs)/customers.tsx` |
| "Free trial · latest N shown" subtitle and the "Premium" header badge | `(tabs)/customers.tsx` |
| `upgrade()` / `upgradeLoading` in the store, `api.upgrade` | `state/store.tsx`, `lib/api.ts` |
| "Subscription & billing" in the team permission grid | `settings/team.tsx` |
| `subscription.*`, `customers.upsell/upgrade/moreLocked/trialShown/premium`, `toast.welcomePremium/upgradeFailed`, `team.moduleBilling` strings | `i18n/en.json` |

## Rules going forward

- **Since 2026-10-28 no plan truncates the customer list**
  ([customer-list-no-limit.md](./customer-list-no-limit.md)). The only cut left is the API's page
  size (the newest 100). The app then shows "Latest N of M" and **nothing about why or how to see
  more.** Telling the owner to upgrade on the web is also rejectable (guideline 3.1.1 / 3.1.3), so
  do not add a "visit tejotime.com" hint either.
- `billing` stays in `GRANTABLE_MODULES`, so saving a staff login's permissions still sends the
  value already stored. Neither the app nor, since 2026-10-28, owner-web displays it.
- `store.plan` and the `subscription:updated` socket listener remain as internal state. Nothing
  renders them.
- The Appearance panel's "Premium" **shadow** style is a visual option, not a plan, and stays.
- Bringing any paid-plan UI back into the app requires real StoreKit/Play Billing products,
  submitted with review screenshots, and a signed Paid Apps Agreement.

## Deliberately not changed

- **`owner-web/`** kept its upgrade flow as a documented exception to CLAUDE.md §11.1, until
  **2026-10-28**. The Customers upgrade card and the Settings → Subscription page were then removed
  there too ([customer-list-no-limit.md](./customer-list-no-limit.md)), so no owner surface sells a
  plan now.
- **Backend** — `/subscription/*` endpoints are unchanged.
- **`expo-blur`** is no longer imported by `app/src`, but the dependency was left in place.
  Removing a native module means a pod install and a native rebuild; do it in a separate change.
