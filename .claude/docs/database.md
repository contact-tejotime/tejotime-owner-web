# Database

PostgreSQL, **raw SQL, no ORM**. `backend/src/db/pool.ts` is the only runtime data-access entry
point (`many` / `one` / `exec` / `transaction`). Concurrency-sensitive queue work runs in
`plpgsql` functions called through `db/rpc.ts`.

Extensions: `pgcrypto` (for `gen_random_uuid()`), `pg_trgm` (customer search).
Conventions: UUID primary keys, `timestamptz` in UTC, money as **integer paise** (`*_paise`).

---

## 1. Migrations

Plain `.sql` files in `backend/db/migrations/`, applied in **filename order** by `db/migrate.ts`
(`npm run migrate`), each wrapped in its own transaction, recorded in `schema_migrations`, and
written to be **idempotent / re-runnable**.

| # | File | What it adds |
|---|---|---|
| 0001 | `init.sql` | All 20 core tables + 12 enum types |
| 0002 | `functions.sql` | The `queue_*` plpgsql primitives |
| 0003 | `business_phone.sql` | `country_code`, `phone_number`, generated `phone_full` |
| 0004 | `app_user_phone_login.sql` | phone-based login |
| 0005 | `admin_master_and_fields.sql` | `master_data` table, `about_heading`, `faqs` |
| 0006 | `business_about_image.sql` | `about_image_url` |
| 0007 | `admins.sql` | `admins` allow-list |
| 0008 | `business_hero_stats_reviews.sql` | `hero_subtitle`, `stat_value`, `stat_label` (**unused since 2026-10-05**: no longer written or returned; kept until old clients stop sending the fields, then drop), `reviews` |
| 0009 | `master_data_team_noun.sql` | `team_noun` |
| 0010 | `admin_analytics.sql` | admin analytics support |
| 0011 | `staff_avatar.sql` | `staff.avatar_url` |
| 0012 | `eta_15_whatsapp.sql` | `queue_entry.notified_eta_15_at`; also added `'whatsapp'` to `notification_channel` — dead now that the WhatsApp integration is removed (app code only ever writes `sms`/`in_app`), left in place because Postgres can't drop a single enum value without rebuilding the type |
| 0013 | `admin_password.sql` | `admins.password_hash` |
| 0014 | `inquiries.sql` | `inquiry` table |
| 0015 | `visitor_type.sql` | `visitor_type` on `queue_entry` + `appointment` |
| 0016 | `business_theme_color.sql` | `theme_color` |
| 0016 | `fix_queue_add_overload.sql` | drops a stale `queue_add` signature |
| 0017 | `business_theme.sql` | `theme` jsonb |
| 0018 | `user_role_co_owner.sql` | `co_owner` role |
| 0019 | `business_users_permissions.sql` | `user_permission`, `is_super_owner`, `staff_id`, `created_by_user_id` |
| 0020 | `queue_checkout_amount.sql` | checkout amount override (+ drops old signature) |
| 0021 | `business_social_links.sql` | instagram/facebook/twitter/linkedin URLs |
| 0022 | `admin_roles.sql` | `admins.role`/`name`/`is_active`, `business.created_by_admin_id` |
| 0024 | `service_price_range.sql` | `service.price_type`/`price_max_paise` + `ck_service_price_shape`; `queue_checkout` refuses a derived total for a range |
| 0025 | `multi_service_selection.sql` | `appointment_service` table; `queue_attach_services()`; `appointment_check_in` carries every booked service into the queue entry |
| 0026 | `consent_log.sql` | cookie-consent audit log |
| 0027 | `sms_opt_in.sql` | `customer.sms_opt_in_at` / `sms_opt_out_at`; `sms_opt_in` on `queue_entry` and `appointment` (default false) |
| 0030 | `optional_seats.sql` | `_queue_renumber`, `queue_start`, `queue_move` made NULL-seat safe (a store with no stylists = one shared lane); `queue_checkout` refuses to derive an amount for an entry with no service and no add-ons. No signature changes. |
| 0031 | `store_draft.sql` | `store_draft(id, admin_id → admins on delete cascade, name, data jsonb, created_at, updated_at)` + index `(admin_id, updated_at desc)`: the admin panel's parked Create store forms. Private per admin; owner password never stored. |
| 0032 | `review_sms_opt_in.sql` | separate consent for the post-visit review SMS (per-visit flag + first-consent stamp on `customer`), see [docs/sms-opt-in-a2p.md](../../docs/sms-opt-in-a2p.md) |
| 0033 | `business_timezone_from_phone.sql` | backfills `business.timezone` from the dial code for stores still on the IST default |
| 0034 | `staff_commission.sql` | `staff_commission_rate` (dated pay rates) + the **`visit_commission` view** — the schema's first view. See below and [docs/staff-commission.md](../../docs/staff-commission.md). |
| 0036 | `recurring_appointments.sql` | `appointment_series`, `appointment_series_service`, `appointment_series_issue`; `appointment.series_id / series_version / occurrence_date / cancel_reason`; `business.recurring_enabled` (default true). See below and [docs/recurring-appointments.md](../../docs/recurring-appointments.md). |
| 0037 | `recurring_edit.sql` | `appointment.rescheduled_at` (a visit moved by hand — kept through a "change all future visits"), `appointment_series.anchor_index` (rule dates before the re-anchored first date, so `end_count` keeps its original total), and `admin_appointment_stats` re-created to ignore superseded rows. |
| 0038 | `business_gallery_heading.sql` | `business.gallery_heading` — the owner's heading for the page's photo gallery; NULL = the default for the store type ([docs/store-setup-review-2026-10-05.md](../../docs/store-setup-review-2026-10-05.md)) |
| 0040 | `unpriced_extras.sql` | `queue_entry_extra.price_type` (the catalog service's type for attached rows; NULL for chip add-ons and pre-0040 rows). `queue_attach_services` stores it, by the `serviceId` each item carries. `appointment_check_in` passes `appointment_service.service_id`. `queue_checkout` raises `AMOUNT_REQUIRED` for an `unset` extra when no amount is given. Same signatures throughout ([docs/checkout-add-ons.md](../../docs/checkout-add-ons.md)) |
| 0039 | `checkout_addons.sql` | `queue_extend` (same signature) raises `TEJO:ALREADY_ADDED` for a label already on the visit — one add-on label per visit; new `queue_remove_extra(biz, entry, label)` deletes those rows, takes their minutes off `extra_minutes` and their ` + Label` off `service_name` (never the first segment) ([docs/checkout-add-ons.md](../../docs/checkout-add-ons.md)) |

> **`0016` is duplicated** across two independent files. Ordering relies on the filename sort, which
> is deterministic. **Use a strictly increasing prefix from 0025 onward.**
>
> Note `0023_eta_2_sms.sql` (adds `queue_entry.notified_eta_2_at` / `notified_two_away_at`): this
> used to warn that the file was missing from the repo. It is present now — on 2026-10-03 a fresh
> local database was built from `db/migrations/` alone (0001–0036) and passed `smoke-rest.mjs`.

Migrations are **manual in deploy** — nothing runs them automatically. See `deployment.md`.

Seeds: `db/seed.ts` (Sharp Cuts demo tenant) and `db/seed-demo.ts`.
**Never run `npm run seed` against a database with real data** — it deletes and recreates the
`sharp-cuts` tenant.

---

## 2. Enum types

Defined in `0001_init.sql` and mirrored **exactly** by `backend/src/domain/enums.ts`. Changing one
without the other is a silent runtime break.

| Type | Values |
|---|---|
| `plan_type` | `free`, `premium` |
| `subscription_status` | `trialing`, `active`, `past_due`, `canceled` |
| `user_role` | `owner`, `manager`, `staff` (+ `co_owner` added in 0018) |
| `queue_status` | `waiting`, `in_service`, `completed`, `no_show`, `cancelled` |
| `queue_source` | `walk_in`, `online` |
| `appointment_status` | `pending`, `confirmed`, `checked_in`, `completed`, `cancelled`, `no_show` |
| `appointment_source` | `online`, `owner` |
| `color_token` | `primary`, `secondary`, `amber500`, `green500` |
| `notification_channel` | `sms`, `email`, `push`, `in_app` |
| `notification_status` | `queued`, `sent`, `delivered`, `failed` |
| `otp_purpose` | `join_queue`, `booking`, `customer_login`, `owner_login`, `phone_verify` |
| `payment_status` | `created`, `authorized`, `captured`, `failed`, `refunded` |

---

## 3. Tables

### `business` — the tenant root

Everything cascades from here (`on delete cascade` throughout).

`id`, `slug` (unique), `name`, `category`, `area`, `address`, `city`, `description`, `tagline`,
`established_year`, `rating` `numeric(2,1)`, `review_count`, `logo_url`, `hero_image_url`,
`timezone` (default `Asia/Kolkata`), `currency` `char(3)` (default `INR`), `token_prefix`
(default `A`), `payments` `text[]`, `is_active`, `created_at`, `updated_at`.

Added later: `country_code`, `phone_number`, **`phone_full` (generated column,
`country_code || phone_number`, uniquely indexed)**, `about_heading`, `faqs` jsonb,
`about_image_url`, `hero_subtitle`, `stat_value`, `stat_label` (unused), `reviews` jsonb, `gallery_heading` (0038), `theme_color`,
`theme` jsonb, `instagram_url`, `facebook_url`, `twitter_url`, `linkedin_url`, `yelp_url`,
`created_by_admin_id`.

`phone_full` is the microsite's by-phone lookup key (`/{phone}` route → `GET
/public/businesses/by-phone/:phone`).

### `app_user` — owner and staff logins

`id`, `business_id`, `handle` (unique — **vestigial**, login is by phone), `email` (vestigial),
`phone`, `password_hash`, `role` `user_role`, `name`, `dark_mode`, `last_login_at`, `is_active`.
Added in 0019: `is_super_owner`, `staff_id` → `staff(id) on delete set null`, `created_by_user_id`.

Constraints: `uq_app_user_super_owner` (exactly one super owner per business),
`uq_app_user_staff` (a chair backs at most one login).

### `staff` — seats / providers

`id`, `business_id`, `user_id` → `app_user` (`on delete set null`), `name`, `role_label`,
`color_token`, `accepts_walk_ins`, `is_active`, `position`, `avatar_url`.

A seat is a queue lane. Deleting staff sets `queue_entry.staff_id` to null rather than deleting
the entry — see `buildSeatGroups` in `business-logic.md`.

### `service`

`id`, `business_id`, `name`, `duration_minutes`, `price_paise`, `price_type`,
`price_max_paise`, `currency`, `color_token`, `is_active`, `position`.

**Pricing modes** (migration 0024). `price_type` is `'fixed' | 'range' | 'unset'`, enforced by
`ck_service_price_shape`:

| `price_type` | `price_paise` | `price_max_paise` | Meaning |
|---|---|---|---|
| `fixed` | `> 0` | null | One amount. |
| `range` | `> 0` (the floor) | `>= price_paise` | A band. The customer sees it; whoever checks the customer out types the real figure. |
| `unset` | `0` | null | No price. The microsite shows none; the amount is typed at checkout. |

`unset` exists because "not priced yet" used to be encoded as `price_paise = 0`, and each
surface guessed what that zero meant (the microsite said "Price varies", the checkout sheet
banked ₹0). The 0024 backfill records those rows as what they are. It started as legacy-only (the
write schemas refused it), but **price is now optional**, so `unset` is a mode an owner or admin
can choose on purpose: the write APIs accept it, store `price_paise = 0`, and need no amount.

`queue_checkout` raises **`TEJO:AMOUNT_REQUIRED`** (→ 422) when `p_amount_paise` is null and the
booked service is `range` or `unset` — deriving would bank the band's minimum, which is the
same under-reporting 0020 was written to stop. Since 0030 the same applies to an entry with no
service and no add-ons, which would otherwise bank ₹0.

**NULL seats (0030).** `queue_entry.staff_id` is NULL for a business with no stylists, or after a
seat was deleted. `_queue_renumber` / `queue_move` match it with `is not distinct from`, and
`queue_start` skips `SEAT_BUSY` for it: the seatless lane is one shared queue where several can be
in service at once (`uq_one_in_service_per_seat` never blocked it — NULLs are distinct). Checkout
does not auto-promote from it.

### `appointment_service`

`id`, `appointment_id` (cascade), `service_id` (`on delete set null`), `name`, `minutes`,
`price_paise`, `position`.

One row per service on a booking, `position` 0 being the primary (the one mirrored onto
`appointment.service_id`). Name/minutes/price are **denormalised on purpose** — deleting a
service from the menu must not rewrite what a customer already agreed to.

Queue entries need no equivalent table: a multi-service visit is stored the way `queue_extend`
already stores add-ons — `service_id` is the first service, `service_name` the combined label,
`extra_minutes` the sum of the rest (read by `estMins`), and one `queue_entry_extra` row per
extra service (summed by `billingFor`). `appointment_service` exists only because a booking is
made now and checked in later, so check-in has to be able to rebuild those extras.

### `customer`

`id`, `business_id`, `name`, `phone`, `email`, `is_vip`, `visits_count`, `total_spend_paise`
`bigint`, `last_visit_at`, `notes`, `sms_opt_in_at`, `sms_opt_out_at` (0027). Unique on `(business_id, phone)`.

Indexes: `(business_id, created_at desc)`, plus **trigram GIN** on `name` and `phone` for search.

### `queue_entry` — the live queue and public tickets

`id`, `business_id`, `customer_id`, `customer_name`, `customer_phone`, `service_id`,
`service_name`, `staff_id`, `preferred_staff_id`, `token`, `token_day`, `status` `queue_status`,
`source` `queue_source`, `position`, `extra_minutes`, `base_wait_minutes`, `appointment_id`,
`joined_at`, `started_at`, `completed_at`, `notified_two_away_at`, `notified_turn_at`,
`notified_eta_15_at` (0012), `visitor_type` (0015, check `mr`|`patient`), `sms_opt_in` (0027, default false).

Indexes and constraints:
- `idx_queue_business_seat_status` on `(business_id, staff_id, status, position)`
- `uq_one_in_service_per_seat` — **partial unique** on `(business_id, staff_id) where status =
  'in_service'`. At most one person in the chair.
- `uq_token_per_day` — partial unique on `(business_id, token, token_day)`.

`service_name` is denormalised on purpose: it may carry add-ons (`"Haircut + Shave"`) and must
survive the service row being edited or deleted.

### `queue_entry_extra` — service add-ons

`id`, `queue_entry_id` (cascade), `label`, `minutes`, `price_paise`, `price_type` (0040: the
catalog service's type for a booked service attached as an extra; NULL for chip add-ons — an
`unset` row's `price_paise` is a placeholder 0 that checkout must not derive from). One row per label
(case-insensitive) per entry is the rule since 0039. `queue_extend` refuses a repeat, and
`queue_attach_services` already skipped a label present in `service_name`. No index enforces it,
because rows from before 0039 can hold duplicates; `queue_remove_extra` removes them all.

### `appointment`

`id`, `business_id`, `customer_id`, `customer_name`, `customer_phone`, `service_id`,
`service_name`, `staff_id`, `scheduled_start_at`, `scheduled_end_at`, `status`, `source`,
`queue_entry_id` (FK added after `queue_entry` exists), `notes`, `visitor_type`, `sms_opt_in` (0027, default false).
0036 adds `series_id` (→ `appointment_series`, on delete set null), `series_version`,
`occurrence_date` `date` (the rule date — it does not move when one visit is rescheduled) and
`cancel_reason` (`skipped` / `cancelled` / `superseded`, null on a one-off; `superseded` = replaced by
a "change all future visits" — nobody cancelled it, so every list and count hides it), and 0037's
`rescheduled_at`. Partial unique index
`uq_appointment_series_occurrence (series_id, series_version, occurrence_date) where series_id is
not null` — a skipped visit keeps its row, so the series job can never book that date again.

### `appointment_series` — recurring appointments (0036)

The repeat **rule**, not the visits: `customer_*`, `staff_id` + `staff_locked` (a stylist WAS
chosen — so a deleted stylist is flagged, not read as "any"), `visitor_type`, `start_time` `time`
(store-local), `anchor_date` `date`, `interval_days` (7–90), `end_type` `never|count|until` +
`end_count` (2–26) / `end_date`, `status` `active|paused|ended|cancelled` (text + check, not an
enum), `pause_reason` `owner|stylist_unavailable|no_shows`, `version`, `generated_through` `date`
(the job's cursor: the last rule date handled), `sms_opt_in`, `review_sms_opt_in` (copied onto every
visit), `source` (`appointment_source`), `manage_token` (unique, 16 url-safe chars — the
customer's link credential). Partial unique `uq_appointment_series_open_phone (business_id,
customer_phone) where status in ('active','paused')`: one open series per phone per store.
`appointment_series_service (series_id, service_id on delete set null, name, position)` holds only
the service ids; names/durations/prices are copied when each visit is booked.
`appointment_series_issue` is the owner's Needs attention list: dates the job could not book
(`reason` `outside_hours|stylist_unavailable|slot_taken|service_missing`), unique per
`(series_id, series_version, occurrence_date)`, closed by `resolved_at` / `resolution`.
Select the `date`/`time` columns as text (`series.service.ts` `SERIES_COLS`) for the same reason
as `visit_commission` below.

### `visit` — completed-service ledger

`id`, `business_id`, `customer_id`, `queue_entry_id`, `staff_id`, `service_name`,
`amount_paise` `bigint`, `completed_at`. Written by `queue_checkout`.

### `staff_commission_rate` — pay rates that start at an instant (0034, 0035)

`id`, `business_id`, `staff_id` (both `on delete cascade`), `rate_bp` `int` (basis points,
`check 0..10000`: 2000 = 20%), `effective_at` `timestamptz` (0035 replaced 0034's `effective_from
date`), `set_by_user_id`, `created_at`, `updated_at`. `uq_staff_commission_rate_at unique
(staff_id, effective_at)` — one rate per stylist per instant. Several rates on the same calendar
day are allowed. Writers: `modules/commission` (the owner rate API, including a future midnight)
and the admin store save (`syncStaff`), which only inserts `now()` and only when the percent
changed. `set_by_user_id` is null on an admin-written row. A rate with `effective_at <= now()` cannot
be edited or deleted, which is what keeps history frozen. Saving today inserts `now()`; a future
day is that day's midnight in `business.timezone`.

### `visit_commission` — view (0034, recreated by 0035)

Every `visit` plus `local_at` / `local_date` (in `business.timezone`), the `rate_bp` and
`rate_from` (`timestamptz`, the rate's `effective_at`) of the latest rate with
`effective_at <= completed_at` (a lateral lookup), and `commission_paise =
round(amount_paise × rate_bp / 10000)`, NULL when there is no rate or no stylist. The one place
commission is computed. Filter it on `business_id` + a `completed_at` range (reaches
`idx_visit_business_completed`), never on `local_date`. **First view in the schema:** `create or
replace view` may only append columns, and retyping or dropping a column it reads needs the view
dropped and recreated — 0035 drops it because `rate_from` changed from `date` to `timestamptz`.
Select its `date` columns as `::text` — `db/pool.ts` has no date parser, so node-pg turns a
`date` into a JS Date at the server's local midnight. `rate_from` is a `timestamptz`; leave it
as a Date and normalise in TS.

### Supporting tables

| Table | Purpose | State |
|---|---|---|
| `business_hour` | per-day open/close, unique `(business_id, day_of_week)` | live |
| `amenity`, `gallery_image` | microsite content, ordered by `position` | live |
| `subscription` | one row per business, `plan` + `status` | live |
| `auth_session` | refresh tokens as `sha256(jti)` | live (see below) |
| `user_permission` | **sparse** overrides: `(user_id, module)` → `none`/`view`/`manage` | live |
| `admins` | platform admin allow-list, keyed by mobile; + `password_hash`, `role`, `name`, `is_active` | live |
| `store_draft` | admin-panel Create store form, parked; `admin_id`-scoped jsonb snapshot (no password) | live |
| `master_data` | admin lookup values, `team_noun` | live |
| `inquiry` | marketing lead capture | live |
| `notification` | outbound message log | partial |
| `token_counter` | daily ticket numbering | live |
| `payment` | payments | **scaffolding only** |
| `otp_verification` | OTP | **scaffolding only** |
| `audit_log` | audit trail | **table exists, nothing writes to it** |
| `idempotency_key` | request de-dup | **table exists, no middleware uses it** |

`auth_session` has `user_agent` and `ip` columns that are **never written**, so there is no session
list and no targeted revoke.

---

## 4. Queue operations live in plpgsql

`0002_functions.sql` (amended by 0015, 0016, 0020) defines the atomic primitives:

`queue_add`, `queue_start`, `queue_checkout`, `queue_no_show`, `queue_reassign`, `queue_extend`,
`queue_move`, `queue_leave`, `appointment_check_in`, plus helpers `next_token` and
`_queue_renumber`.

Rules these functions enforce:

- **Every mutating function takes `pg_advisory_xact_lock(hashtext(business_id))`.** Concurrent
  queue changes within one business are serialised, so ordering cannot corrupt.
- **Positions are maintained only among a seat's `waiting` entries**, contiguous `0..n-1`.
  `_queue_renumber` restores that invariant after any removal.
- Errors are raised as `TEJO:<CODE>` and mapped to HTTP by `middleware/error-handler.ts`:
  `NOT_FOUND` → 404, `INVALID_STATE` → 422, `SEAT_BUSY` → 409, `ALREADY_CHECKED_IN` → 409.

### Calling them from TypeScript

`db/rpc.ts` `callRpc(fn, namedArgs)` uses **named argument notation** and `select * from fn(...)`.

> Never write `select fn(...)` — that stringifies a `returns table` result into a single column.

### The overload trap

Adding a trailing parameter with a `DEFAULT` creates a **second overload**, which makes every
existing call ambiguous and fails at runtime, not at migration time.
`0016_fix_queue_add_overload.sql` and the `drop function` at the end of
`0020_queue_checkout_amount.sql` exist for exactly this reason.

**If you add a parameter to a `queue_*` function, drop the old signature in the same migration.**

---

## 5. Tenant isolation

There is **no row-level security**. Isolation is enforced entirely in the service layer:

- `business_id` **always** comes from the JWT, never from client input
  (`middleware/authenticate.ts`).
- Therefore **every query must scope by `business_id` explicitly.** A missing `where business_id =
  $1` is a cross-tenant data leak that nothing else will catch.
- Staff logins are narrowed further by `scopeStaffId(principal)` — a staff login with no chair
  linked sees **nothing** rather than everything (fails safe).
