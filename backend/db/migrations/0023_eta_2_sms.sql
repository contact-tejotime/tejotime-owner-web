-- 2-minute ETA SMS: one-shot stamp per ticket (same policy as notified_eta_15_at).

alter table queue_entry
  add column if not exists notified_eta_2_at timestamptz;
