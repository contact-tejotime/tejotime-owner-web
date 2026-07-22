import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Outbound alert sender for ETA and "your turn" notifications.
 *
 * Temporary: when WHATSAPP_ENABLED=true and Twilio credentials are set, this
 * POSTs an SMS via Twilio's Messages API. `TWILIO_TEST_TO` can keep all sends
 * pinned to a single verified test number while queue entries still pass their
 * own customer phone through the same seam.
 *
 * WHATSAPP_ENABLED remains the master on/off switch (deferred no-op when false).
 */
export interface WhatsAppSender {
  send(to: string, body: string, template?: string): Promise<{ id: string | null }>;
}

function twilioBasicAuth(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

export const whatsappSender: WhatsAppSender = {
  async send(to, body, template) {
    if (!env.WHATSAPP_ENABLED) {
      logger.debug({ to, template }, `[whatsapp deferred] ${body}`);
      return { id: null };
    }

    const sid = env.TWILIO_ACCOUNT_SID;
    const token = env.TWILIO_AUTH_TOKEN;
    const from = env.TWILIO_FROM;
    if (!sid || !token || !from) {
      logger.warn(
        'WHATSAPP_ENABLED=true but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM are blank',
      );
      return { id: null };
    }

    const recipient = env.TWILIO_TEST_TO || to;
    if (!recipient) {
      logger.warn({ template }, 'WhatsApp/Twilio send skipped: no recipient');
      return { id: null };
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
    const form = new URLSearchParams({
      To: recipient,
      From: from,
      Body: body,
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
      const json = (await res.json().catch(() => null)) as { sid?: string; message?: string } | null;
      if (!res.ok) {
        logger.error(
          { status: res.status, error: json?.message ?? json, to: recipient, template },
          'Twilio SMS send failed',
        );
        return { id: null };
      }
      const messageSid = json?.sid ?? null;
      logger.info({ sid: messageSid, to: recipient, template }, 'Twilio SMS sent');
      return { id: messageSid };
    } catch (err) {
      logger.error({ err, to: recipient, template }, 'Twilio SMS request threw');
      return { id: null };
    }
  },
};
