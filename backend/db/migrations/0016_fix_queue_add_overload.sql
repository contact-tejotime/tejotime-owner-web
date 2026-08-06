-- =====================================================================
-- TejoTime — 0016_fix_queue_add_overload
-- 0015 added `p_visitor_type` to queue_add via `create or replace function`, but
-- adding a trailing parameter changes the function's argument-type signature —
-- Postgres treats that as a NEW overload rather than a replacement, leaving the
-- original 10-arg queue_add in place alongside the new 11-arg one. Any caller
-- invoking queue_add with the original 10 positional arguments (e.g.
-- appointment_check_in in 0002_functions.sql) then hits "function queue_add(...)
-- is not unique", since Postgres can't pick between the two overloads.
-- Drop the stale 10-arg version so only the 11-arg one (p_visitor_type
-- defaulting to null) remains.
-- =====================================================================

drop function if exists queue_add(uuid, text, text, uuid, uuid, text, queue_source, uuid, uuid, uuid);
