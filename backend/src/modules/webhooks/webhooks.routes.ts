import { Router } from 'express';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

/**
 * Webhook receivers — scaffolded but INERT until providers are configured
 * (PAYMENTS_ENABLED / SMS_ENABLED). When enabled, verify the provider signature
 * before processing (docs/06 §7, docs/11 §7).
 *
 * WhatsApp Cloud API: GET verifies the Meta subscription challenge; POST
 * acknowledges delivery events (inbound handling deferred).
 */
export const webhooksRouter = Router();

webhooksRouter.get('/whatsapp', (req, res) => {
  const mode = String(req.query['hub.mode'] ?? '');
  const token = String(req.query['hub.verify_token'] ?? '');
  const challenge = String(req.query['hub.challenge'] ?? '');
  const expected = env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && expected && token === expected) {
    res.status(200).type('text/plain').send(challenge);
    return;
  }

  logger.warn({ mode }, 'WhatsApp webhook verification failed');
  res.sendStatus(403);
});

webhooksRouter.post('/whatsapp', (req, res) => {
  const body = req.body as { object?: string; entry?: unknown[] } | undefined;
  logger.info(
    {
      object: body?.object,
      entryCount: Array.isArray(body?.entry) ? body.entry.length : 0,
    },
    'Received WhatsApp webhook',
  );
  res.status(200).json({ received: true });
});

webhooksRouter.post('/payments', (req, res) => {
  logger.info({ provider: 'payments' }, 'Received payment webhook (inert — payments disabled)');
  res.json({ received: true });
});

webhooksRouter.post('/sms', (req, res) => {
  logger.info({ provider: 'sms' }, 'Received SMS DLR webhook (inert — sms disabled)');
  res.json({ received: true });
});
