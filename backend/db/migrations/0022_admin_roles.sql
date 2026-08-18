-- =====================================================================
-- TejoTime — 0022_admin_roles
--
-- Multi-admin logins for the PLATFORM admin panel, with per-employee data scoping.
--
-- `admins` has been an allow-list since 0007: one column, the mobile, plus a password hash from
-- 0013. That is enough when every admin is the same person wearing the same hat. It stops being
-- enough the moment a second person logs in and should see only the stores they onboarded.
--
-- Two roles, deliberately no more:
--   owner    — the platform operator. Every store, every KPI, billing, inquiries, team.
--   employee — sees only the stores they personally created.
--
-- The scope lives on `business.created_by_admin_id` rather than a join table because an employee
-- owning a store is a fact about who provisioned it, not a membership that changes hands. It is
-- nullable and NOT backfilled on purpose: every store that exists today has no creator, which
-- makes it owner-only. An employee who joins tomorrow starts with an empty list and grows it by
-- creating stores, so no historic store can leak by default.
--
-- This is NOT owner-web's staff seats (`app_user`, 0018/0019) and not the salon queue's
-- per-module permissions. Those describe who works *inside* one business. This describes who
-- operates the platform above them. The two never mix.
--
-- Note on the primary key: `mobile` was the PK. It stays unique and is still the login
-- identifier, but `created_by_admin_id` needs a stable target that survives a number change, so
-- the PK moves to a generated uuid.
-- =====================================================================

-- ---- admins: identity, name, role -----------------------------------------------------------
alter table admins
  add column if not exists id         uuid not null default gen_random_uuid(),
  add column if not exists name       text,
  add column if not exists role       text,
  add column if not exists is_active  boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

-- Backfill before the NOT NULLs bite. Every admin that exists today predates roles and was a
-- full-access operator; anything other than 'owner' here would silently strip their access on
-- the next deploy.
update admins set role = 'owner'          where role is null;
update admins set name = 'Platform Owner' where name is null or btrim(name) = '';

alter table admins alter column name set not null;
alter table admins alter column role set not null;
alter table admins alter column mobile set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'admins_role_check') then
    alter table admins add constraint admins_role_check check (role in ('owner', 'employee'));
  end if;
end $$;

-- Move the primary key from mobile to id, keeping mobile unique. Guarded on the *current* PK
-- column so a re-run is a no-op rather than an error.
do $$
declare
  pk_name text;
  pk_col  text;
begin
  -- Read the constraint's real name rather than assuming 'admins_pkey': the table was created
  -- in 0007 with an inline `primary key`, and dropping a guessed name would fail the migration.
  select c.conname, a.attname into pk_name, pk_col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'admins'::regclass and c.contype = 'p'
   limit 1;

  if pk_name is null then
    alter table admins add constraint admins_pkey primary key (id);
  elsif pk_col = 'mobile' then
    execute format('alter table admins drop constraint %I', pk_name);
    alter table admins add constraint admins_pkey primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'admins'::regclass and contype = 'u' and conname = 'admins_mobile_key'
  ) then
    alter table admins add constraint admins_mobile_key unique (mobile);
  end if;
end $$;

comment on column admins.role is
  'owner = whole platform. employee = only the stores in business.created_by_admin_id.';
comment on column admins.is_active is
  'Soft delete. An employee who created stores is deactivated, never removed, so those stores keep a creator.';

-- ---- business: who provisioned this store ---------------------------------------------------
-- No backfill: existing rows stay null, which reads as owner-only.
alter table business
  add column if not exists created_by_admin_id uuid references admins(id) on delete set null;

create index if not exists business_created_by_admin_id_idx
  on business (created_by_admin_id);

comment on column business.created_by_admin_id is
  'Admin who created the store. NULL = owner-only (pre-dates roles). Drives employee scoping.';
