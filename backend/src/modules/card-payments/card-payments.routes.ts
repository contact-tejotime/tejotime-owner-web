import { Router } from 'express';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { limiters } from '../../middleware/rate-limit';
import { requireSuperOwner } from '../../middleware/require-permission';
import { validate } from '../../middleware/validate';
import {
  completeSchema,
  failSchema,
  listQuerySchema,
  paymentParams,
  refundSchema,
  settingsSchema,
  startSchema,
} from './card-payments.schemas';
import * as cards from './card-payments.service';

/**
 * Card payments on a PayPal POS Card Reader — docs/card-payments-paypal.md.
 *
 * MAIN OWNER ONLY, every route (client decision 2026-10-15): the money lands in their PayPal
 * account, and they charge and refund on their own phone. Not `OWNER_ONLY_COLUMNS` or an owner-role
 * check — those admit co-owners. A co-owner or staff login gets 403 here, and 403 CARD_OWNER_ONLY
 * if it tries to record a checkout as paid by card while card charging is on (queue.service).
 */
export const cardPaymentsRouter = Router();
cardPaymentsRouter.use(authenticate, requireSuperOwner);

cardPaymentsRouter.get(
  '/settings',
  limiters.ownerRead,
  asyncHandler(async (req, res) => {
    res.json(await cards.getSettings(req.principal!.businessId));
  }),
);

cardPaymentsRouter.put(
  '/settings',
  limiters.ownerWrite,
  validate({ body: settingsSchema }),
  asyncHandler(async (req, res) => {
    res.json(await cards.setSettings(req.principal!.businessId, req.body.enabled, req.body.paypalOrgRef));
  }),
);

// "Sign out of PayPal": off, and the saved PayPal account forgotten (see cards.disconnect).
cardPaymentsRouter.post(
  '/disconnect',
  limiters.ownerWrite,
  asyncHandler(async (req, res) => {
    res.json(await cards.disconnect(req.principal!.businessId));
  }),
);

cardPaymentsRouter.get(
  '/',
  limiters.ownerRead,
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await cards.list(req.principal!.businessId, req.query as any));
  }),
);

cardPaymentsRouter.post(
  '/',
  limiters.ownerWrite,
  validate({ body: startSchema }),
  asyncHandler(async (req, res) => {
    const p = req.principal!;
    res.status(201).json(await cards.start(p.businessId, p.userId, req.body.queueEntryId, req.body.amountPaise));
  }),
);

cardPaymentsRouter.post(
  '/:id/complete',
  limiters.ownerWrite,
  validate({ params: paymentParams, body: completeSchema }),
  asyncHandler(async (req, res) => {
    res.json(await cards.complete(req.principal!.businessId, req.params.id, req.body));
  }),
);

cardPaymentsRouter.post(
  '/:id/fail',
  limiters.ownerWrite,
  validate({ params: paymentParams, body: failSchema }),
  asyncHandler(async (req, res) => {
    res.json(await cards.fail(req.principal!.businessId, req.params.id, req.body.reason));
  }),
);

cardPaymentsRouter.post(
  '/:id/refund',
  limiters.ownerWrite,
  validate({ params: paymentParams, body: refundSchema }),
  asyncHandler(async (req, res) => {
    const p = req.principal!;
    res.json(await cards.refund(p.businessId, p.userId, req.params.id, req.body.refundReference));
  }),
);
