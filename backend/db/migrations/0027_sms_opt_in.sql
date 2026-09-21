-- =====================================================================
-- TejoTime — 0027_sms_opt_in
--
-- Twilio A2P 10DLC (errors 30923 / 30925) requires an affirmative, optional
-- SMS opt-in — not "we have a phone number so we may text it". Joins and
-- bookings still succeed with the box off; Twilio is only called when this
-- visit's flag is true and the customer has not opted out.
--
-- Do NOT add a parameter to queue_add. A trailing DEFAULT creates a second
-- overload (0016 / 0020). Consent is stamped with an UPDATE after the RPC.
--
-- Defaults are false so an omitted field from an old client can never become
-- "yes, text them".
-- =====================================================================

alter table customer
  add column if not exists sms_opt_in_at timestamptz,
  add column if not exists sms_opt_out_at timestamptz;

alter table queue_entry
  add column if not exists sms_opt_in boolean not null default false;

alter table appointment
  add column if not exists sms_opt_in boolean not null default false;
