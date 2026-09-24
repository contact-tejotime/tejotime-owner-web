-- =====================================================================
-- TejoTime — 0028_appointment_sms_lifecycle
--
-- Backs the appointment-lifecycle SMS set (booking confirmation, 15-minute
-- reminder, post-visit thank-you/review) that replaces the old queue-wait
-- alert SMS sends. See backend/src/lib/sms-copy.ts and docs/sms-opt-in-a2p.md.
--
-- reminder_sent_at / thank_you_sent_at are one-shot claim columns, same
-- pattern as queue_entry.notified_eta_15_at etc. (0012 / 0023): an UPDATE
-- conditional on IS NULL is how a concurrent caller is refused the send.
-- =====================================================================

alter table business
  add column if not exists google_review_url text;

alter table appointment
  add column if not exists reminder_sent_at timestamptz;

alter table queue_entry
  add column if not exists thank_you_sent_at timestamptz;
