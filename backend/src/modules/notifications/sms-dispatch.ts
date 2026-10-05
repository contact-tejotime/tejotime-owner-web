import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { exec, many, one } from '../../db/pool';
import { smsSender } from '../../integrations/sms';
import { shouldDispatchSms } from '../../lib/sms-opt-in';
import {
  REMINDER_LEAD_MINUTES,
  SMS_TEMPLATES,
  isReminderDue,
  smsBodyBookingConfirmed,
  smsBodyReminder,
  smsBodyReview,
  smsDateTime,
} from '../../lib/sms-copy';

/**
 * The three customer SMS (docs/sms-opt-in-a2p.md): booking confirmation, 15-minute reminder,
 * post-visit review request. Every send goes through `recordSmsNotification`, which is the one
 * place that decides whether Twilio is called at all.
 */

export interface SmsNotificationInput {
  businessId: string;
  phone: string | null | undefined;
  /** The visit-level consent flag for THIS kind of message (sms_opt_in or review_sms_opt_in). */
  optIn: boolean;
  queueEntryId?: string | null;
  appointmentId?: string | null;
  template: string;
  body: string;
}

/**
 * Persists an outbound message and dispatches via smsSender (Twilio when SMS_ENABLED).
 * Never throws: notification bookkeeping must not break the mutation that triggered it.
 */
export async function recordSmsNotification(input: SmsNotificationInput): Promise<void> {
  const phone = input.phone || null;
  let optedOutAt: string | null = null;
  let optOutUnknown = false;
  if (phone) {
    try {
      const customer = await one<{ sms_opt_out_at: string | null }>(
        'select sms_opt_out_at from customer where business_id = $1 and phone = $2',
        [input.businessId, phone],
      );
      optedOutAt = customer?.sms_opt_out_at ?? null;
    } catch {
      // Cannot prove they are still opted in — do not Twilio.
      optOutUnknown = true;
    }
  }
  const canSms =
    !optOutUnknown && shouldDispatchSms({ customerPhone: phone, smsOptIn: input.optIn, smsOptOutAt: optedOutAt });
  const channel = canSms ? 'sms' : 'in_app';

  let row: { id: string } | null = null;
  try {
    row = await one<{ id: string }>(
      `insert into notification
         (business_id, queue_entry_id, appointment_id, channel, template, to_address, body, status, sent_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        input.businessId,
        input.queueEntryId ?? null,
        input.appointmentId ?? null,
        channel,
        input.template,
        phone,
        input.body,
        canSms ? 'queued' : 'sent',
        canSms ? null : new Date().toISOString(),
      ],
    );
  } catch (err) {
    logger.warn({ err, template: input.template }, 'notification insert failed');
    return;
  }

  if (!row?.id || !canSms || !phone) return;

  try {
    const result = await smsSender.send(phone, input.body, input.template);
    await exec(
      `update notification
          set status = $1, provider_message_id = $2, sent_at = $3, error = $4
        where id = $5`,
      [
        result.id ? 'sent' : 'failed',
        result.id,
        result.id ? new Date().toISOString() : null,
        result.id ? null : 'SMS send failed or deferred',
        row.id,
      ],
    );
  } catch (err) {
    logger.warn({ err, template: input.template }, 'SMS dispatch bookkeeping failed');
  }
}

/** The store's public booking page — the "Manage your booking" link. */
function storeUrl(phoneFull: string | null | undefined): string {
  const base = env.PUBLIC_WEB_URL.replace(/\/+$/, '');
  return phoneFull ? `${base}/${phoneFull}` : base;
}

/**
 * "Manage your booking" for a visit of a recurring series: the store page's manage view, with the
 * series' token after `#` so the browser never sends it to a server (or a log). A one-off booking
 * keeps the plain store link. Same domain either way — the registered sample's link is a value.
 */
export function manageUrl(phoneFull: string | null | undefined, seriesToken: string | null | undefined): string {
  if (!phoneFull || !seriesToken) return storeUrl(phoneFull);
  return `${storeUrl(phoneFull)}/v#${seriesToken}`;
}

/**
 * Message 1 — sent right after a website booking, only if the appointment-texts box was ticked.
 * Also sent for each visit the recurring-series job books (docs/recurring-appointments.md §4): it
 * is the regular's advance notice of their next date, which a 15-minute reminder cannot be.
 */
export async function sendBookingConfirmation(businessId: string, appointmentId: string): Promise<void> {
  const a = await one<{
    customer_name: string;
    customer_phone: string | null;
    sms_opt_in: boolean;
    scheduled_start_at: string;
    name: string;
    timezone: string;
    phone_full: string | null;
    manage_token: string | null;
  }>(
    `select a.customer_name, a.customer_phone, a.sms_opt_in, a.scheduled_start_at,
            b.name, b.timezone, b.phone_full, s.manage_token
       from appointment a
       join business b on b.id = a.business_id
       left join appointment_series s on s.id = a.series_id
      where a.id = $1 and a.business_id = $2`,
    [appointmentId, businessId],
  );
  if (!a || a.sms_opt_in !== true) return;
  const { date, time } = smsDateTime(a.scheduled_start_at, a.timezone);
  await recordSmsNotification({
    businessId,
    phone: a.customer_phone,
    optIn: true,
    appointmentId,
    template: SMS_TEMPLATES.bookingConfirmed,
    body: smsBodyBookingConfirmed(a.customer_name, a.name, date, time, manageUrl(a.phone_full, a.manage_token)),
  });
}

/**
 * Message 2 — the every-minute sweep. The SQL window is a coarse pre-filter (the partial index
 * from 0032 serves it); `isReminderDue` is the rule, and the conditional claim on
 * reminder_sent_at is what stops two overlapping sweeps from both texting.
 */
export async function appointmentReminderSweep(now = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60_000).toISOString();
  const rows = await many<{
    id: string;
    business_id: string;
    customer_name: string;
    customer_phone: string | null;
    scheduled_start_at: string;
    created_at: string;
    name: string;
    address: string | null;
  }>(
    `select a.id, a.business_id, a.customer_name, a.customer_phone, a.scheduled_start_at, a.created_at,
            b.name, b.address
       from appointment a join business b on b.id = a.business_id
      where a.status = 'confirmed'
        and a.sms_opt_in
        and a.reminder_sent_at is null
        and a.customer_phone is not null
        and a.scheduled_start_at > $1
        and a.scheduled_start_at <= $2`,
    [now.toISOString(), horizon],
  );

  let sent = 0;
  for (const a of rows) {
    if (!isReminderDue({ startAt: a.scheduled_start_at, createdAt: a.created_at, now })) continue;
    const claimed = await exec(
      'update appointment set reminder_sent_at = now() where id = $1 and reminder_sent_at is null',
      [a.id],
    );
    if (!claimed) continue;
    await recordSmsNotification({
      businessId: a.business_id,
      phone: a.customer_phone,
      optIn: true,
      appointmentId: a.id,
      template: SMS_TEMPLATES.appointmentReminder,
      body: smsBodyReminder(a.customer_name, a.name, a.address),
    });
    sent++;
  }
  return sent;
}

/**
 * Message 3 — after checkout, only if the separate review box was ticked AND the store has set a
 * Google review link. One-shot via the thank_you_sent_at claim (0028).
 */
export async function sendReviewRequest(businessId: string, entryId: string): Promise<void> {
  const e = await one<{
    customer_name: string;
    customer_phone: string | null;
    review_sms_opt_in: boolean;
    thank_you_sent_at: string | null;
    name: string;
    google_review_url: string | null;
    phone_full: string | null;
  }>(
    `select q.customer_name, q.customer_phone, q.review_sms_opt_in, q.thank_you_sent_at,
            b.name, b.google_review_url, b.phone_full
       from queue_entry q join business b on b.id = q.business_id
      where q.id = $1 and q.business_id = $2`,
    [entryId, businessId],
  );
  const reviewUrl = e?.google_review_url?.trim();
  if (!e || e.review_sms_opt_in !== true || !e.customer_phone || !reviewUrl || e.thank_you_sent_at) return;
  const claimed = await exec(
    'update queue_entry set thank_you_sent_at = now() where id = $1 and thank_you_sent_at is null',
    [entryId],
  );
  if (!claimed) return;
  // Text our own short link (www.tejotime.com/<phone>/r → 302 to the Google form), not the raw
  // Google URL: carriers filter bit.ly-style shorteners, Google's write-review URLs are long, and
  // the redirect reads the link live so an owner's later edit still reaches texts already sent.
  // A store with no phone has no short link, so it falls back to the raw URL.
  const link = e.phone_full ? `${storeUrl(e.phone_full)}/r` : reviewUrl;
  await recordSmsNotification({
    businessId,
    phone: e.customer_phone,
    optIn: true,
    queueEntryId: entryId,
    template: SMS_TEMPLATES.reviewRequest,
    body: smsBodyReview(e.customer_name, e.name, link),
  });
}
