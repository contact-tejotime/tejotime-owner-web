import { Router } from 'express';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { limiters } from '../../middleware/rate-limit';
import * as subscription from './subscription.service';

export const subscriptionRouter = Router();
subscriptionRouter.use(authenticate);

subscriptionRouter.get('/', limiters.ownerRead, asyncHandler(async (req, res) => {
  res.json(await subscription.getSubscription(req.principal!.businessId));
}));

subscriptionRouter.post(
  '/upgrade',
  limiters.ownerWrite,
  authorize('owner'),
  asyncHandler(async (req, res) => {
    res.json(await subscription.upgrade(req.principal!.businessId));
  }),
);

subscriptionRouter.post(
  '/cancel',
  limiters.ownerWrite,
  authorize('owner'),
  asyncHandler(async (req, res) => {
    res.json(await subscription.cancel(req.principal!.businessId));
  }),
);
