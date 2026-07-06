-- 0003: business phone, split into country_code + phone_number (national number),
-- both digits-only, no '+'. phone_full is a derived lookup key (country_code || phone_number)
-- matched against the URL segment for the phone-keyed public route (www.tejotime.com/<phone>).
alter table business add column if not exists country_code text;
alter table business add column if not exists phone_number text;
alter table business add column if not exists phone_full text
  generated always as (country_code || phone_number) stored;

-- Partial unique on the derived full number: businesses without a phone are NULL and don't
-- collide; real numbers are unique and unambiguous (also guards concat collisions on write).
create unique index if not exists uq_business_phone_full
  on business(phone_full) where phone_full is not null;

-- Backfill the demo tenant so /919399385943 works on existing environments.
update business set country_code = '91', phone_number = '9399385943'
  where slug = 'sharp-cuts' and phone_number is null;
