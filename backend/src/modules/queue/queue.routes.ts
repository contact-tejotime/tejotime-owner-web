import { Router } from 'express';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import {
  addWalkInSchema,
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
  validate({ query: queueQuerySchema }),
  asyncHandler(async (req, res) => {
    const { view, staffId } = req.query as any;
    res.json(await queue.getQueueView(req.principal!.businessId, { view, staffId }));
  }),
);

queueRouter.post(
  '/',
  limiters.ownerWrite,
  validate({ body: addWalkInSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await queue.addWalkIn(req.principal!.businessId, req.body));
  }),
);

queueRouter.get(
  '/:id',
  limiters.ownerRead,
  validate({ params: entryParams }),
  asyncHandler(async (req, res) => {
    res.json(await queue.getEntryDetail(req.principal!.businessId, req.params.id));
  }),
);

queueRouter.post(
  '/:id/start',
  limiters.ownerWrite,
  validate({ params: entryParams }),
  asyncHandler(async (req, res) => {
    res.json(await queue.startService(req.principal!.businessId, req.params.id));
  }),
);

queueRouter.post(
  '/:id/checkout',
  limiters.ownerWrite,
  validate({ params: entryParams }),
  asyncHandler(async (req, res) => {
    res.json(await queue.checkout(req.principal!.businessId, req.params.id));
  }),
);

queueRouter.post(
  '/:id/no-show',
  limiters.ownerWrite,
  validate({ params: entryParams }),
  asyncHandler(async (req, res) => {
    res.json(await queue.noShow(req.principal!.businessId, req.params.id));
  }),
);

queueRouter.post(
  '/:id/reassign',
  limiters.ownerWrite,
  validate({ params: entryParams, body: reassignSchema }),
  asyncHandler(async (req, res) => {
    res.json(await queue.reassign(req.principal!.businessId, req.params.id, req.body.staffId));
  }),
);

queueRouter.post(
  '/:id/extend',
  limiters.ownerWrite,
  validate({ params: entryParams, body: extendSchema }),
  asyncHandler(async (req, res) => {
    res.json(await queue.extendService(req.principal!.businessId, req.params.id, req.body.label, req.body.minutes));
  }),
);

queueRouter.post(
  '/:id/move',
  limiters.ownerWrite,
  validate({ params: entryParams, body: moveSchema }),
  asyncHandler(async (req, res) => {
    res.json(await queue.moveWithinSeat(req.principal!.businessId, req.params.id, req.body.toIndex));
  }),
);

queueRouter.delete(
  '/:id',
  limiters.ownerWrite,
  validate({ params: entryParams }),
  asyncHandler(async (req, res) => {
    res.json(await queue.cancelEntry(req.principal!.businessId, req.params.id));
  }),
);
