-- =====================================================================
-- TejoTime — 0016_business_theme_color: per-store brand/accent hex color
-- for the customer microsite. Nullable so legacy stores keep default look.
-- =====================================================================

alter table business
  add column if not exists theme_color text;

-- Enforce #RRGGBB when set; NULL remains allowed for existing rows.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_theme_color_hex'
  ) then
    alter table business
      add constraint business_theme_color_hex
      check (theme_color is null or theme_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;
