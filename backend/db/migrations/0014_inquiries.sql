-- ---------- inquiry ----------
-- Platform-level "Request access" leads captured from the public marketing
-- site's modal. Not scoped to a business_id: these are pre-signup prospects,
-- not tenant data.
create table if not exists inquiry (
  id            uuid primary key default gen_random_uuid(),
  business_name text not null,
  address       text not null,
  phone         text not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_inquiry_created_at on inquiry(created_at desc);
