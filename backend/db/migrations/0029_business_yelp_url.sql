-- =====================================================================
-- TejoTime — 0029_business_yelp_url
--
-- Yelp profile for a store, alongside the four social columns added in 0021.
--
-- Same shape and same reasoning as 0021: a discrete, typed column rather than a row in a jsonb
-- bag, so a malformed URL fails at write time instead of becoming a dead link on a customer-facing
-- page. Yelp is not "social" in the posting sense, but for a US salon it is the review page an
-- owner most wants linked, and it shares the microsite's icon row — so it belongs with its
-- neighbours rather than in a category of one.
--
-- Nullable, like the rest: nothing existing has it.
--
-- Added because owners had nowhere to put it and were pasting Yelp URLs into the X (Twitter)
-- field, which rendered their review page under an X icon on the public site.
-- =====================================================================

alter table business
  add column if not exists yelp_url text;

comment on column business.yelp_url is 'Full Yelp business page URL. Rendered as an icon link on the microsite.';
