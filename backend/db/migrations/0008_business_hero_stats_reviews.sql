-- Admin-editable hero subtitle, a custom achievement stat (value + label),
-- and customer reviews (stored as jsonb, mirroring the faqs column).
alter table business add column if not exists hero_subtitle text;
alter table business add column if not exists stat_value    text;
alter table business add column if not exists stat_label    text;
alter table business add column if not exists reviews       jsonb not null default '[]'::jsonb;
