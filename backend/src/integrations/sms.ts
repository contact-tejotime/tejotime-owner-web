import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * SMS provider seam. When SMS_ENABLED=true and Twilio credentials are set, this
 * POSTs via Twilio's Messages API. TWILIO_TEST_TO can pin all sends to one number.
 *
 * Trial accounts (TWILIO_TRIAL_MODE=true) cannot send free-text Body — they must
 * use Twilio's predefined template names (error 572006 otherwise). Real copy is
 * still persisted on the notification row by callers.
 */
export interface SmsSender {
  send(to: string, body: string, template?: string): Promise<{ id: string | null }>;
}

/** Twilio trial Body values — see https://www.twilio.com/docs/usage/trials/try-out-sms */
const TRIAL_BODY_BY_TEMPLATE: Record<string, string> = {
  queue_joined: 'sms_event_notifications',
  eta_15: 'sms_appointment_reminders',
  eta_2: 'sms_appointment_reminders',
  your_turn: 'sms_account_alerts',
};

function twilioBasicAuth(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

function resolveTwilioBody(body: string, template?: string): string {
  if (!env.TWILIO_TRIAL_MODE) return body;
  return (template && TRIAL_BODY_BY_TEMPLATE[template]) || 'sms_event_notifications';
}

export const smsSender: SmsSender = {
  async send(to, body, template) {
    if (!env.SMS_ENABLED) {
      logger.debug({ to, template }, `[sms deferred] ${body}`);
      return { id: null };
    }

    const sid = env.TWILIO_ACCOUNT_SID;
    const token = env.TWILIO_AUTH_TOKEN;
    const from = env.TWILIO_FROM;
    if (!sid || !token || !from) {
      logger.warn('SMS_ENABLED=true but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM are blank');
      return { id: null };
    }

    const recipient = env.TWILIO_TEST_TO || to;
    if (!recipient) {
      logger.warn({ template }, 'SMS send skipped: no recipient');
      return { id: null };
    }

    const twilioBody = resolveTwilioBody(body, template);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
    const form = new URLSearchParams({
      To: recipient,
      From: from,
      Body: twilioBody,
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: twilioBasicAuth(sid, token),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      const json = (await res.json().catch(() => null)) as {
        sid?: string;
        message?: string;
        code?: number;
      } | null;
      if (!res.ok) {
        logger.error(
          {
            status: res.status,
            code: json?.code,
            error: json?.message ?? json,
            to: recipient,
            template,
            twilioBody,
          },
          'Twilio SMS send failed',
        );
        return { id: null };
      }
      const messageSid = json?.sid ?? null;
      logger.info({ sid: messageSid, to: recipient, template, twilioBody }, 'Twilio SMS sent');
      return { id: messageSid };
    } catch (err) {
      logger.error({ err, to: recipient, template }, 'Twilio SMS request threw');
      return { id: null };
    }
  },
};
