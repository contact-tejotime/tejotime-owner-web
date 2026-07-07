-- =====================================================================
-- 0007: admins — allow-list of mobile numbers permitted to log into the
--   admin panel. Login is mobile + OTP (demo OTP for now; see
--   backend/src/modules/admin/admin.service.ts). Intentionally a single
--   column: the mobile number is the whole record.
-- =====================================================================
create table if not exists admins (
  mobile text primary key
);

-- Seed a demo admin so the panel can be logged into out of the box
-- (digits-only full number, incl. country code — same convention as app_user.phone).
insert into admins (mobile) values ('919399385943')
on conflict (mobile) do nothing;
