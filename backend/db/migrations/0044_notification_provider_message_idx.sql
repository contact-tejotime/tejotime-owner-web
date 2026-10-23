-- =====================================================================
-- TejoTime — 0044_notification_provider_message_idx
--
-- WhatsApp for Indian (+91) customers (docs/whatsapp-india.md). Meta's send response only says
-- "accepted"; whether the message reached the phone arrives later on the webhook, up to three
-- times per message (sent, delivered, read — or failed), each naming the message by the id Meta
-- returned. That id is stored in `notification.provider_message_id`, which had no index: every
-- webhook call would scan the whole table.
--
--   * partial index on `notification.provider_message_id` — only rows a provider accepted have
--     one (in-app rows and refused sends stay null), so the index stays small.
--
-- No enum change: `notification_channel` already has 'whatsapp' (0012).
-- Numbered 0044 because 0042/0043 are taken by the PayPal POS work already applied on preprod.
-- Re-runnable.
-- =====================================================================

create index if not exists ix_notification_provider_message
  on notification (provider_message_id)
  where provider_message_id is not null;
