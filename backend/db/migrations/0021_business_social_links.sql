-- =====================================================================
-- TejoTime — 0021_business_social_links
--
-- Social profiles for a store, shown on its public microsite.
--
-- Four discrete columns rather than a `social jsonb` blob. The set is small, closed and
-- unlikely to churn; each one gets its own icon, its own label and its own validation, and a
-- typed column means a malformed URL fails at write time instead of surfacing as a dead link on
-- a customer-facing page. A jsonb bag would have bought flexibility nobody asked for and cost
-- the ability to constrain what goes in.
--
-- All nullable: nothing existing has these, and most small shops will fill in one or two.
-- =====================================================================

alter table business
  add column if not exists instagram_url text,
  add column if not exists facebook_url  text,
  add column if not exists twitter_url   text,
  add column if not exists linkedin_url  text;

comment on column business.instagram_url is 'Full profile URL. Rendered as an icon link on the microsite.';
comment on column business.twitter_url   is 'X / Twitter profile URL. Column keeps the historic name.';
