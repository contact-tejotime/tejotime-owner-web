import { env, smsAllowedCountryCodes } from '../config/env';
import { logger } from '../config/logger';
import { isSmsCountryAllowed } from '../lib/sms-country';

/**
 * SMS provider seam. When SMS_ENABLED=true and Twilio credentials are set, this
 * POSTs via Twilio's Messages API — through TWILIO_MESSAGING_SERVICE_SID when set, else from
 * TWILIO_FROM. TWILIO_TEST_TO can pin all sends to one number.
 *
 * Only countries in TWILIO_ALLOWED_COUNTRY_CODES (default US) are ever texted. The check lives
 * here, the one place Twilio is called, so no caller can skip it.
 *
 * Trial accounts (TWILIO_TRIAL_MODE=true) cannot send free-text Body — they must
 * use Twilio's predefined template names (error 572006 otherwise). Real copy is
 * still persisted on the notification row by callers.
 */
export interface SmsSender {
  /** `error` says why nothing was sent when the reason is ours, not Twilio's (e.g. 'country_not_allowed'). */
  send(to: string, body: string, template?: string): Promise<{ id: string | null; error?: string }>;
}

/** Twilio trial Body values — see https://www.twilio.com/docs/usage/trials/try-out-sms */
const TRIAL_BODY_BY_TEMPLATE: Record<string, string> = {
  booking_confirmed: 'sms_event_notifications',
  appointment_reminder: 'sms_appointment_reminders',
  review_request: 'sms_account_alerts',
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
    const service = env.TWILIO_MESSAGING_SERVICE_SID;
    const from = env.TWILIO_FROM;
    if (!sid || !token || (!service && !from)) {
      logger.warn(
        'SMS_ENABLED=true but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN, or both TWILIO_MESSAGING_SERVICE_SID and TWILIO_FROM, are blank',
      );
      return { id: null };
    }

    const recipient = env.TWILIO_TEST_TO || to;
    if (!recipient) {
      logger.warn({ template }, 'SMS send skipped: no recipient');
      return { id: null };
    }
    // The number that will actually receive it, so a TWILIO_TEST_TO abroad must be listed too.
    if (!isSmsCountryAllowed(recipient, smsAllowedCountryCodes)) {
      logger.warn(
        { to: recipient, template, allowed: smsAllowedCountryCodes },
        'SMS skipped: country not allowed (TWILIO_ALLOWED_COUNTRY_CODES)',
      );
      return { id: null, error: 'country_not_allowed' };
    }

    const twilioBody = resolveTwilioBody(body, template);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
    const form = new URLSearchParams({ To: recipient, Body: twilioBody });
    // The service, when configured, picks the sender from its Sender Pool (the A2P campaign's
    // number); sending From as well would only add a way for the two settings to disagree.
    if (service) form.set('MessagingServiceSid', service);
    else form.set('From', from);

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
