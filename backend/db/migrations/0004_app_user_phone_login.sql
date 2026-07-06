-- 0004: phone login. app_user.phone stores the owner's full number as digits-only
-- (country code + national, no '+'), matched against the stripped login input.
create unique index if not exists uq_app_user_phone
  on app_user(phone) where phone is not null;

-- Backfill the demo owner (safety net for envs not reseeded).
update app_user set phone = '919399385943' where handle = 'sharpcuts' and phone is null;
