-- =====================================================================
-- 0013: admins.password_hash — admin-panel login password moves from the
--   ADMIN_LOGIN_PASSWORD_HASH env var into the DB, verified with
--   PASSWORD_PEPPER exactly like owner logins (app_user.password_hash).
--   Nullable for safe rollout; the demo admin's hash is set idempotently
--   by db/migrate.ts (pepper-dependent, so computed in JS, not SQL).
-- =====================================================================
alter table admins
  add column if not exists password_hash text;
