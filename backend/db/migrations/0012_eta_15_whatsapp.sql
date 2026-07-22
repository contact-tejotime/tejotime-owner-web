-- 15-minute ETA WhatsApp alert: idempotency stamp + whatsapp notification channel.
-- Alert is one-shot per ticket (notified_eta_15_at); walk-in bumps do not re-send.

alter table queue_entry
  add column if not exists notified_eta_15_at timestamptz;

do $$ begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'notification_channel' and e.enumlabel = 'whatsapp'
  ) then
    alter type notification_channel add value 'whatsapp';
  end if;
end $$;
