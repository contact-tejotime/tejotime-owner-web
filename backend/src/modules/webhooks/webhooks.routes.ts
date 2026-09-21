import { Router } from 'express';
import { logger } from '../../config/logger';

/**
 * Webhook receivers — scaffolded but INERT until providers are configured
 * (PAYMENTS_ENABLED / SMS_ENABLED). When enabled, verify the provider signature
 * before processing (docs/06 §7, docs/11 §7).
 */
export const webhooksRouter = Router();

webhooksRouter.post('/payments', (req, res) => {
  logger.info({ provider: 'payments' }, 'Received payment webhook (inert — payments disabled)');
  res.json({ received: true });
});

webhooksRouter.post('/sms', (req, res) => {
  logger.info({ provider: 'sms' }, 'Received SMS DLR webhook (inert — sms disabled)');
  res.json({ received: true });
});
