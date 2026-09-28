-- =====================================================================
-- TejoTime — 0032_review_sms_opt_in
--
-- Separate consent for the post-visit "leave us a Google review" SMS.
--
-- Carriers read a review request as MARKETING, while the booking
-- confirmation and 15-minute reminder are customer care, so the two consents
-- are stored separately. The booking page currently shows ONE box that names
-- all three texts and sets both flags; keeping them apart means a separate
-- review box can come back (if a carrier objects to the bundling) without a
-- schema change. See docs/sms-opt-in-a2p.md.
--
-- Same shape as 0027: a per-visit flag (what THIS visit agreed to) plus a
-- first-consent stamp on customer. Defaults are false so owner-created
-- visits and older clients can never become "yes, text them".
-- queue_add is NOT given a parameter (overload trap, 0016/0020); the flag
-- is an UPDATE after the RPC, and appointment check-in copies it across.
-- =====================================================================

alter table queue_entry
  add column if not exists review_sms_opt_in boolean not null default false;

alter table appointment
  add column if not exists review_sms_opt_in boolean not null default false;

alter table customer
  add column if not exists review_sms_opt_in_at timestamptz;

-- The reminder sweep scans upcoming, opted-in, not-yet-reminded bookings
-- every minute; keep that scan off the full appointment table.
create index if not exists idx_appt_reminder_due
  on appointment (scheduled_start_at)
  where status = 'confirmed' and sms_opt_in and reminder_sent_at is null;
