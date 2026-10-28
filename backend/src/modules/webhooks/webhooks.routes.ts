import { Router } from 'express';
import { logger } from '../../config/logger';
import { Errors } from '../../domain/errors';
import { asyncHandler } from '../../http/async-handler';
import { handleWhatsAppWebhook, isValidWhatsAppSignature, whatsappHandshake } from './whatsapp.service';

/**
 * Webhook receivers — scaffolded but INERT until providers are configured
 * (PAYMENTS_ENABLED / SMS_ENABLED). When enabled, verify the provider signature
 * before processing (docs/06 §7, docs/11 §7). WhatsApp is live: docs/whatsapp-india.md.
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

/** Meta's subscription handshake: plain-text challenge back, or 403. */
webhooksRouter.get('/whatsapp', (req, res) => {
  const challenge = whatsappHandshake(req.query as Record<string, unknown>);
  if (challenge === null) throw Errors.forbidden('Webhook verification failed');
  res.type('text/plain').send(challenge);
});

/** The signature is over the exact bytes Meta sent, kept by app.ts's express.json `verify`. */
webhooksRouter.post(
  '/whatsapp',
  asyncHandler(async (req, res) => {
    const raw = (req as { rawBody?: Buffer }).rawBody;
    if (!isValidWhatsAppSignature(raw, req.get('x-hub-signature-256'))) {
      throw Errors.unauthenticated('Invalid webhook signature');
    }
    await handleWhatsAppWebhook(req.body);
    res.json({ received: true });
  }),
);
