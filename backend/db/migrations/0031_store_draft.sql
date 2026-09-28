-- =====================================================================
-- TejoTime — 0031_store_draft
--
-- Half-finished "Create store" forms in the PLATFORM admin panel.
--
-- Provisioning a store is a long form (hours, services, staff, photos, Q&A...) and an admin who
-- is pulled away mid-way used to come back to an empty page. A draft is that form, parked.
--
-- A draft is a snapshot of the form state, not a store: it lives in its own table precisely so
-- an incomplete one can never leak onto a customer microsite, show up in an owner's login lookup
-- or trip a `business` constraint (a draft may have no name, no phone, no category yet).
--
-- Scope is the admin who saved it, and only that admin: an owner does NOT see their employees'
-- drafts and vice versa. The service filters every query on `admin_id`, and answers a draft that
-- belongs to someone else with a 404, the same as one that never existed.
--
-- `data` is the raw form state (images are already uploaded and held as URLs). The owner's
-- password is deliberately never written here — the service strips it, so a plaintext secret
-- cannot end up in a jsonb column or a backup.
--
-- Deleted with the admin (on delete cascade): a draft has no meaning without its author.
-- =====================================================================

create table if not exists store_draft (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid not null references admins(id) on delete cascade,
  -- Denormalised from data->>'name' so the sidebar list does not have to ship every blob.
  name       text,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_draft_admin_updated_idx
  on store_draft (admin_id, updated_at desc);

comment on table store_draft is
  'Admin-panel Create store form, parked mid-way. Private to admin_id; never a business row.';
comment on column store_draft.data is
  'Raw StoreForm state from the admin panel. owner password is never stored.';
