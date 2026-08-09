-- 0019: multi-user business logins and per-module permissions.
--
-- Until now `app_user` held exactly one row per business — the owner login the admin panel
-- creates at provisioning — and `role` was decorative because nothing else ever existed.
-- This migration makes the table what its name always implied: every human who can sign in to
-- business.tejotime.com for that shop.
--
-- Three additions, no destructive change. Existing owner logins keep working untouched.

alter table app_user
  add column if not exists is_super_owner     boolean not null default false,
  add column if not exists staff_id           uuid references staff(id) on delete set null,
  add column if not exists created_by_user_id uuid references app_user(id) on delete set null;

comment on column app_user.is_super_owner is
  'The one account per business that cannot be edited or removed from inside the portal.';
comment on column app_user.staff_id is
  'Links a staff login to the chair it works. Null for owners. Drives own-data-only scoping.';

-- Backfill: the oldest `owner` of each business becomes its super owner. Every business
-- provisioned so far has exactly one owner row, so in practice this just labels what is
-- already true — but `distinct on` keeps it correct if any business ever gained a second.
with first_owner as (
  select distinct on (business_id) id
    from app_user
   where role = 'owner'
   order by business_id, created_at, id
)
update app_user u
   set is_super_owner = true
  from first_owner f
 where u.id = f.id
   and u.is_super_owner = false;

-- Exactly one super owner per business — enforced here rather than hoped for in application
-- code, because "who owns this account" is the one thing that must never drift.
create unique index if not exists uq_app_user_super_owner
  on app_user(business_id) where is_super_owner;

-- A chair backs at most one login. Two people sharing one seat's queue would make
-- "only your own data" meaningless.
create unique index if not exists uq_app_user_staff
  on app_user(staff_id) where staff_id is not null;

create index if not exists idx_app_user_staff on app_user(staff_id);


-- ---------- user_permission ----------
--
-- SPARSE OVERRIDES, not a full grant table. A row exists only where an owner deliberately
-- changed something; the absence of a row means "whatever this role gets by default"
-- (src/domain/permissions.ts ROLE_DEFAULTS). That matters for upgrades: adding a new screen
-- ships as a code change with a sensible default for everyone, instead of a backfill that has
-- to guess what every business intended.
--
-- `module` is text rather than an enum for the same reason — a new screen must not require a
-- migration. The application validates it against the MODULES catalogue.
create table if not exists user_permission (
  user_id    uuid not null references app_user(id) on delete cascade,
  module     text not null,
  access     text not null check (access in ('none', 'view', 'manage')),
  updated_at timestamptz not null default now(),
  primary key (user_id, module)
);

create index if not exists idx_user_permission_user on user_permission(user_id);
