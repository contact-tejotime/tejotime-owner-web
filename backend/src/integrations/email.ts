import { env } from '../config/env';
import { logger } from '../config/logger';

/** Email provider seam — DEFERRED until credentials (EMAIL_ENABLED=false). */
export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<{ id: string | null }>;
}

export const emailSender: EmailSender = {
  async send(to, subject) {
    if (!env.EMAIL_ENABLED) {
      logger.debug({ to, subject }, '[email deferred]');
      return { id: null };
    }
    logger.warn('EMAIL_ENABLED=true but no provider is configured');
    return { id: null };
  },
};
