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
| 0008 | `business_hero_stats_reviews.sql` | `hero_subtitle`, `stat_value`, `stat_label`, `reviews` |
| 0009 | `master_data_team_noun.sql` | `team_noun` |
| 0010 | `admin_analytics.sql` | admin analytics support |
| 0011 | `staff_avatar.sql` | `staff.avatar_url` |
| 0012 | `eta_15_whatsapp.sql` | `queue_entry.notified_eta_15_at` |
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

> **`0016` is duplicated** across two independent files. Ordering relies on the filename sort, which
> is deterministic. **Use a strictly increasing prefix from 0023 onward.**

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
`about_image_url`, `hero_subtitle`, `stat_value`, `stat_label`, `reviews` jsonb, `theme_color`,
`theme` jsonb, `instagram_url`, `facebook_url`, `twitter_url`, `linkedin_url`,
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

`id`, `business_id`, `name`, `duration_minutes`, `price_paise`, `currency`, `color_token`,
`is_active`, `position`.

### `customer`

`id`, `business_id`, `name`, `phone`, `email`, `is_vip`, `visits_count`, `total_spend_paise`
`bigint`, `last_visit_at`, `notes`. Unique on `(business_id, phone)`.

Indexes: `(business_id, created_at desc)`, plus **trigram GIN** on `name` and `phone` for search.

### `queue_entry` — the live queue and public tickets

`id`, `business_id`, `customer_id`, `customer_name`, `customer_phone`, `service_id`,
`service_name`, `staff_id`, `preferred_staff_id`, `token`, `token_day`, `status` `queue_status`,
`source` `queue_source`, `position`, `extra_minutes`, `base_wait_minutes`, `appointment_id`,
`joined_at`, `started_at`, `completed_at`, `notified_two_away_at`, `notified_turn_at`,
`notified_eta_15_at` (0012), `visitor_type` (0015, check `mr`|`patient`).

Indexes and constraints:
- `idx_queue_business_seat_status` on `(business_id, staff_id, status, position)`
- `uq_one_in_service_per_seat` — **partial unique** on `(business_id, staff_id) where status =
  'in_service'`. At most one person in the chair.
- `uq_token_per_day` — partial unique on `(business_id, token, token_day)`.

`service_name` is denormalised on purpose: it may carry add-ons (`"Haircut + Shave"`) and must
survive the service row being edited or deleted.

### `queue_entry_extra` — service add-ons

`id`, `queue_entry_id` (cascade), `label`, `minutes`, `price_paise`.

### `appointment`

`id`, `business_id`, `customer_id`, `customer_name`, `customer_phone`, `service_id`,
`service_name`, `staff_id`, `scheduled_start_at`, `scheduled_end_at`, `status`, `source`,
`queue_entry_id` (FK added after `queue_entry` exists), `notes`, `visitor_type`.

### `visit` — completed-service ledger

`id`, `business_id`, `customer_id`, `queue_entry_id`, `staff_id`, `service_name`,
`amount_paise` `bigint`, `completed_at`. Written by `queue_checkout`.

### Supporting tables

| Table | Purpose | State |
|---|---|---|
| `business_hour` | per-day open/close, unique `(business_id, day_of_week)` | live |
| `amenity`, `gallery_image` | microsite content, ordered by `position` | live |
| `subscription` | one row per business, `plan` + `status` | live |
| `auth_session` | refresh tokens as `sha256(jti)` | live (see below) |
| `user_permission` | **sparse** overrides: `(user_id, module)` → `none`/`view`/`manage` | live |
| `admins` | platform admin allow-list, keyed by mobile; + `password_hash`, `role`, `name`, `is_active` | live |
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
