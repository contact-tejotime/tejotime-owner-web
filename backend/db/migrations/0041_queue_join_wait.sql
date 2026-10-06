-- =====================================================================
-- TejoTime — 0041_queue_join_wait
--
-- Check in now sends the approved texts too (client request 2026-10-06, docs/sms-opt-in-a2p.md):
-- a confirmation when a customer who ticked the box joins the waitlist, and the "starts in 15
-- minutes" text when their estimated wait drops to 15 minutes or less.
--
-- The 15-minute text is only for someone who joined with MORE than 15 minutes to wait. Joining
-- with less ("Almost your turn", no wait) would send it at once, right after the confirmation,
-- saying nothing new. By the time the text is due, the wait at join is gone — the live wait has
-- moved on — so it is kept here.
--
--   * `queue_entry.join_wait_minutes` — the estimated wait, in minutes, when the customer checked
--     in from the website with the box ticked. NULL for owner walk-ins, appointment check-ins, an
--     unticked box and every row written before this migration (none of them get the text).
--
-- The text rides on the existing one-shot claim `notified_eta_15_at` (0012), so there is no new
-- claim column. Re-runnable.
-- =====================================================================

alter table queue_entry
  add column if not exists join_wait_minutes integer;
