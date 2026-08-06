-- =====================================================================
-- TejoTime — 0017_business_theme: full per-store microsite theme config
-- (preset / mode / brand / radius / shadow / density / animation / hero).
-- Nullable and NOT backfilled: existing rows stay NULL and keep rendering
-- exactly as today (the frontend falls back to the legacy theme config,
-- with theme_color still overriding the brand hex when set).
-- =====================================================================

alter table business
  add column if not exists theme jsonb;

-- Enforce a JSON object when set; NULL remains allowed for existing rows.
-- Field-level validation lives in the admin zod schema, not in the database.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_theme_is_object'
  ) then
    alter table business
      add constraint business_theme_is_object
      check (theme is null or jsonb_typeof(theme) = 'object');
  end if;
end $$;
