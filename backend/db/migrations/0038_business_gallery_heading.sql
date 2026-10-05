-- 0038: the photo gallery's heading on the customer page, chosen by the owner (client review,
-- 2026-10-05; docs/store-setup-review-2026-10-05.md). NULL means "the default for this kind of
-- store" ("See our recent work", "Our facility", …), so every existing store renders exactly as
-- before. Short, like the other headings: the setup screens cap it at 40 characters.
alter table business add column if not exists gallery_heading text;
