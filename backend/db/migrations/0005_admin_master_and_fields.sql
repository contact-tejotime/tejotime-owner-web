-- =====================================================================
-- 0005: admin master data + dynamic business fields.
--   * master_data — a generic (type, name, is_active) lookup table. Seeded
--     with business_category rows that drive the admin panel's category dropdown.
--   * business.about_heading — the microsite "About" section heading (was hardcoded).
--   * business.faqs — the microsite "Good to know" Q&A, stored as JSON (was hardcoded).
-- =====================================================================

-- ---------- master_data (generic lookup) ----------
create table if not exists master_data (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  name        text not null,
  is_active   boolean not null default true,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  unique (type, name)
);
create index if not exists idx_master_data_type on master_data(type, is_active, position);

insert into master_data (type, name, position) values
  ('business_category', 'Salon & Barber', 0),
  ('business_category', 'Hospital', 1),
  ('business_category', 'Restaurant', 2)
on conflict (type, name) do nothing;

-- ---------- business: About heading + FAQs ----------
alter table business add column if not exists about_heading text;
alter table business add column if not exists faqs jsonb not null default '[]'::jsonb;
