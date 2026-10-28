import { env, whatsappCountryCodes } from '../config/env';
import { logger } from '../config/logger';
import { isSmsCountryAllowed } from '../lib/sms-country';

/**
 * WhatsApp provider seam (Meta WhatsApp Cloud API, docs/whatsapp-india.md). When
 * WHATSAPP_ENABLED=true and the token + phone number id are set, this POSTs one approved template
 * message to the Graph API. Off, it logs and sends nothing — the same contract as smsSender.
 *
 * Only countries in WHATSAPP_COUNTRY_CODES (default India) are ever messaged, checked here against
 * the number that actually receives it, so WHATSAPP_TEST_TO counts.
 *
 * Meta only says "accepted" here. Whether it reached the phone arrives later on the webhook
 * (modules/webhooks/whatsapp.service.ts), which moves the notification row to delivered / failed.
 */
export interface WhatsAppSender {
  /** `template` is the SMS template id (lib/sms-copy.ts SMS_TEMPLATES); `params` fill {{1}}..{{n}}. */
  send(to: string, template: string, params: string[]): Promise<{ id: string | null; error?: string }>;
}

/** Our template ids → the names approved in WhatsApp Manager. */
function templateName(template: string): string | null {
  switch (template) {
    case 'booking_confirmed':
      return env.WHATSAPP_TEMPLATE_BOOKING_CONFIRMED;
    case 'appointment_reminder':
      return env.WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER;
    case 'review_request':
      return env.WHATSAPP_TEMPLATE_REVIEW_REQUEST;
    default:
      return null;
  }
}

export const whatsappSender: WhatsAppSender = {
  async send(to, template, params) {
    if (!env.WHATSAPP_ENABLED) {
      logger.debug({ to, template, params }, '[whatsapp deferred]');
      return { id: null };
    }

    const token = env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      logger.warn('WHATSAPP_ENABLED=true but WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is blank');
      return { id: null };
    }

    const name = templateName(template);
    if (!name) {
      logger.warn({ template }, 'WhatsApp send skipped: no approved template for this message');
      return { id: null, error: 'unknown_template' };
    }

    const recipient = env.WHATSAPP_TEST_TO || to;
    if (!recipient) {
      logger.warn({ template }, 'WhatsApp send skipped: no recipient');
      return { id: null };
    }
    if (!isSmsCountryAllowed(recipient, whatsappCountryCodes)) {
      logger.warn(
        { to: recipient, template, allowed: whatsappCountryCodes },
        'WhatsApp skipped: country not allowed (WHATSAPP_COUNTRY_CODES)',
      );
      return { id: null, error: 'country_not_allowed' };
    }

    const base = env.WHATSAPP_API_BASE_URL.replace(/\/+$/, '');
    const url = `${base}/${env.WHATSAPP_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      // Meta takes the number as digits only; the country check above already proved the "+".
      to: recipient.trim().replace(/^\+/, ''),
      type: 'template',
      template: {
        name,
        language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
      },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as {
        messages?: { id?: string }[];
        error?: { code?: number; message?: string; error_subcode?: number };
      } | null;
      const messageId = json?.messages?.[0]?.id ?? null;
      if (!res.ok || !messageId) {
        logger.error(
          { status: res.status, code: json?.error?.code, error: json?.error?.message ?? json, to: recipient, template: name },
          'WhatsApp send failed',
        );
        // Meta's code on the row (131030 recipient not allowed, 132001 template missing, …) says why.
        return { id: null, error: json?.error?.code ? `meta_${json.error.code}` : undefined };
      }
      logger.info({ id: messageId, to: recipient, template: name }, 'WhatsApp message sent');
      return { id: messageId };
    } catch (err) {
      logger.error({ err, to: recipient, template: name }, 'WhatsApp request threw');
      return { id: null };
    }
  },
};
