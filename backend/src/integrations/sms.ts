import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * SMS provider seam. Real dispatch (MSG91/Twilio) is DEFERRED until credentials
 * are provided (SMS_ENABLED=false). Until then this is a no-op logger so no
 * external calls are made. Wire a provider here and flip SMS_ENABLED.
 */
export interface SmsSender {
  send(to: string, body: string, template?: string): Promise<{ id: string | null }>;
}

export const smsSender: SmsSender = {
  async send(to, body, template) {
    if (!env.SMS_ENABLED) {
      logger.debug({ to, template }, `[sms deferred] ${body}`);
      return { id: null };
    }
    // TODO: integrate MSG91 / Twilio (DLT template ids) when credentials arrive.
    logger.warn('SMS_ENABLED=true but no provider is configured');
    return { id: null };
  },
};
