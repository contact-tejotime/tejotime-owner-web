import { Router } from 'express';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { requireOwnRow, requirePermission, scopeStaffId } from '../../middleware/require-permission';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import {
  addWalkInSchema,
  checkoutSchema,
  entryParams,
  extendSchema,
  moveSchema,
  queueQuerySchema,
  reassignSchema,
} from './queue.schemas';
import * as queue from './queue.service';

export const queueRouter = Router();
queueRouter.use(authenticate);

queueRouter.get(
  '/',
  limiters.ownerRead,
  requirePermission('queue'),
  validate({ query: queueQuerySchema }),
  asyncHandler(async (req, res) => {
    const { view, staffId } = req.query as any;
    // A staff login's own seat overrides whatever `staffId` was asked for, so the whole-shop
    // view is not one query string away.
    const seat = scopeStaffId(req.principal!);
    res.json(
      await queue.getQueueView(req.principal!.businessId, { view, staffId: seat ?? staffId }),
    );
  }),
);

queueRouter.post(
  '/',
  limiters.ownerWrite,
  requirePermission('queue', 'manage'),
  validate({ body: addWalkInSchema }),
  asyncHandler(async (req, res) => {
    // A staff login adds walk-ins to its own chair — 'auto' would let the engine seat them
    // anywhere, including someone else's queue.
    const seat = scopeStaffId(req.principal!);
    const body = seat ? { ...req.body, staffId: seat } : req.body;
    res.status(201).json(await queue.addWalkIn(req.principal!.businessId, body));
  }),
);

queueRouter.get(
  '/:id',
  limiters.ownerRead,
  requirePermission('queue'),
  validate({ params: entryParams }),
  requireOwnRow('queue_entry'),
  asyncHandler(async (req, res) => {
    res.json(await queue.getEntryDetail(req.principal!.businessId, req.params.id));
  }),
);

queueRouter.post(
  '/:id/start',
  limiters.ownerWrite,
  requirePermission('queue', 'manage'),
  validate({ params: entryParams }),
  requireOwnRow('queue_entry'),
  asyncHandler(async (req, res) => {
    res.json(await queue.startService(req.principal!.businessId, req.params.id));
  }),
);

queueRouter.post(
  '/:id/checkout',
  limiters.ownerWrite,
  requirePermission('queue', 'manage'),
  // `amountPaise` overrides the derived total for the visit written by this checkout — for the
  // customer who booked a beard trim and also had a haircut. Optional: omit it and the booked
  // service plus recorded add-ons is used, which is what every existing client sends.
  validate({ params: entryParams, body: checkoutSchema }),
  requireOwnRow('queue_entry'),
  asyncHandler(async (req, res) => {
    res.json(await queue.checkout(req.principal!.businessId, req.params.id, req.body?.amountPaise));
  }),
);

queueRouter.post(
  '/:id/no-show',
  limiters.ownerWrite,
  requirePermission('queue', 'manage'),
  validate({ params: entryParams }),
  requireOwnRow('queue_entry'),
  asyncHandler(async (req, res) => {
    res.json(await queue.noShow(req.principal!.businessId, req.params.id));
  }),
);

queueRouter.post(
  '/:id/reassign',
  limiters.ownerWrite,
  requirePermission('queue', 'manage'),
  validate({ params: entryParams, body: reassignSchema }),
  requireOwnRow('queue_entry'),
  asyncHandler(async (req, res) => {
    res.json(await queue.reassign(req.principal!.businessId, req.params.id, req.body.staffId));
  }),
);

queueRouter.post(
  '/:id/extend',
  limiters.ownerWrite,
  requirePermission('queue', 'manage'),
  validate({ params: entryParams, body: extendSchema }),
  requireOwnRow('queue_entry'),
  asyncHandler(async (req, res) => {
    res.json(await queue.extendService(req.principal!.businessId, req.params.id, req.body.label, req.body.minutes));
  }),
);

queueRouter.post(
  '/:id/move',
  limiters.ownerWrite,
  requirePermission('queue', 'manage'),
  validate({ params: entryParams, body: moveSchema }),
  requireOwnRow('queue_entry'),
  asyncHandler(async (req, res) => {
    res.json(await queue.moveWithinSeat(req.principal!.businessId, req.params.id, req.body.toIndex));
  }),
);

queueRouter.delete(
  '/:id',
  limiters.ownerWrite,
  requirePermission('queue', 'manage'),
  validate({ params: entryParams }),
  requireOwnRow('queue_entry'),
  asyncHandler(async (req, res) => {
    res.json(await queue.cancelEntry(req.principal!.businessId, req.params.id));
  }),
);
