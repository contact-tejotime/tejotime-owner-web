import { NextFunction, Request, Response, Router } from 'express';
import { Errors } from '../../domain/errors';
import { atLeast, isOwnerRole } from '../../domain/permissions';
import { asyncHandler } from '../../http/async-handler';
import { ReportQuery, reportQuerySchema } from '../../lib/report-window';
import { authenticate } from '../../middleware/authenticate';
import { limiters } from '../../middleware/rate-limit';
import { loadAccess, requirePermission, scopeStaffId } from '../../middleware/require-permission';
import { validate } from '../../middleware/validate';
import { rateDayParams, setRateSchema, staffParams, visitsQuerySchema } from './commission.schemas';
import * as commission from './commission.service';

/**
 * Staff commission: dated pay rates per stylist, and the reports built on them.
 * See docs/staff-commission.md.
 *
 *  - Reading (`commission: view`): owners see the whole store; every staff login sees its own
 *    chair and ONLY its own chair (scopeStaffId). It is not a grantable module — no owner toggle
 *    hides it, and no override row raises it (domain/permissions.ts).
 *  - Setting rates (`commission: manage`): owner roles only. No other role holds `manage`, so no
 *    staff login can set its own pay.
 */
export const commissionRouter = Router();
commissionRouter.use(authenticate);

/**
 * Rate writes check the ROLE as well as the permission. The permission alone already excludes
 * staff (ROLE_DEFAULTS gives it `view`, and commission takes no overrides), but "a staff login can
 * never set a rate" is the rule this feature lives or dies by, so it should not hang on a single
 * table entry staying as it is.
 */
function requireOwnerRole(req: Request, _res: Response, next: NextFunction): void {
  if (!req.principal) return next(Errors.unauthenticated());
  if (!isOwnerRole(req.principal.role)) {
    return next(Errors.forbidden('Only the business owner can set commission rates'));
  }
  next();
}

commissionRouter.get(
  '/summary',
  limiters.ownerRead,
  requirePermission('commission'),
  validate({ query: reportQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = req.principal!;
    res.json(
      await commission.summary(principal.businessId, req.query as unknown as ReportQuery, scopeStaffId(principal)),
    );
  }),
);

commissionRouter.get(
  '/visits',
  limiters.ownerRead,
  requirePermission('commission'),
  validate({ query: visitsQuerySchema }),
  asyncHandler(async (req, res) => {
    const principal = req.principal!;
    const seat = scopeStaffId(principal);
    const asked = req.query.staffId as string | undefined;
    // A staff login reads its own chair and nobody else's — the same rule as requireOwnRow.
    if (seat && asked && asked !== seat) throw Errors.forbidden('That belongs to another chair');
    const staffId = seat ?? asked;
    if (!staffId) throw Errors.validation('Pick a stylist');

    const access = await loadAccess(req);
    res.json(
      await commission.visits(principal.businessId, req.query as unknown as ReportQuery, staffId, {
        limit: Number(req.query.limit ?? 200),
        includeCustomerName: atLeast(access.customers, 'view'),
      }),
    );
  }),
);

commissionRouter.get(
  '/rates',
  limiters.ownerRead,
  requirePermission('commission', 'manage'),
  asyncHandler(async (req, res) => {
    res.json(await commission.listRates(req.principal!.businessId));
  }),
);

commissionRouter.put(
  '/rates/:staffId',
  limiters.ownerWrite,
  requireOwnerRole,
  requirePermission('commission', 'manage'),
  validate({ params: staffParams, body: setRateSchema }),
  asyncHandler(async (req, res) => {
    res.json(await commission.setRate(req.principal!, req.params.staffId, req.body));
  }),
);

commissionRouter.delete(
  '/rates/:staffId/:effectiveFrom',
  limiters.ownerWrite,
  requireOwnerRole,
  requirePermission('commission', 'manage'),
  validate({ params: rateDayParams }),
  asyncHandler(async (req, res) => {
    res.json(await commission.deleteRate(req.principal!, req.params.staffId, req.params.effectiveFrom));
  }),
);
