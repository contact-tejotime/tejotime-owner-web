import { Router } from 'express';
import { z } from 'zod';
import { CREATABLE_ROLES } from '../../domain/enums';
import { Errors } from '../../domain/errors';
import {
  ACCESS_LEVELS,
  GRANTABLE_MODULES,
  MODULE_LABELS,
  ROLE_DEFAULTS,
  grantableSubset,
  isOwnerRole,
} from '../../domain/permissions';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import * as users from './users.service';

export const usersRouter = Router();
usersRouter.use(authenticate);

/**
 * Managing team logins is restricted to owner roles by the ROLE, not by the `team` permission.
 *
 * The difference matters: permissions are things an owner hands out, and "can create logins"
 * is the one that would let a staff account grant itself everything else. So it is not on the
 * menu — a staff login cannot reach these routes even if someone ticks every box.
 */
usersRouter.use((req, _res, next) => {
  if (!req.principal) return next(Errors.unauthenticated());
  if (!isOwnerRole(req.principal.role)) {
    return next(Errors.forbidden('Only the business owner can manage team logins'));
  }
  next();
});

const idParams = z.object({ id: z.string().uuid() });

/** The permission map the editor sends. Only staff-grantable modules are accepted. */
const permissionsSchema = z.record(
  z.enum(GRANTABLE_MODULES),
  z.enum(ACCESS_LEVELS),
);

const createSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(80),
    phone: z.string().trim().min(10, 'Enter a full mobile number').max(20),
    password: z.string().min(8, 'Use at least 8 characters').max(128),
    role: z.enum(CREATABLE_ROLES),
    staffId: z.string().uuid().nullable().optional(),
    permissions: permissionsSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.role === 'staff' && !body.staffId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['staffId'],
        message: 'Pick a chair for this staff login',
      });
    }
  });

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    phone: z.string().trim().min(10).max(20).optional(),
    role: z.enum(CREATABLE_ROLES).optional(),
    // null is rejected in the service for staff — keep the type for clear API errors.
    staffId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const passwordSchema = z.object({ password: z.string().min(8).max(128) }).strict();

/**
 * The catalogue the permission editor renders from — modules, labels and the defaults each
 * role starts at. Served rather than duplicated in the web app so the two can never disagree
 * about what a "default" is.
 */
usersRouter.get('/modules', limiters.ownerRead, asyncHandler(async (_req, res) => {
  res.json({
    modules: GRANTABLE_MODULES.map((m) => ({ key: m, label: MODULE_LABELS[m] })),
    accessLevels: ACCESS_LEVELS,
    // Filtered to the grantable set: the editor seeds a draft straight from this, and an
    // unfiltered map would seed `team` — a key the create/update payloads reject.
    defaults: {
      staff: grantableSubset(ROLE_DEFAULTS.staff),
      co_owner: grantableSubset(ROLE_DEFAULTS.co_owner),
    },
  });
}));

usersRouter.get('/', limiters.ownerRead, asyncHandler(async (req, res) => {
  res.json(await users.listUsers(req.principal!.businessId));
}));

usersRouter.get(
  '/:id',
  limiters.ownerRead,
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json(await users.getUser(req.principal!.businessId, req.params.id));
  }),
);

usersRouter.post(
  '/',
  limiters.ownerWrite,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await users.createUser(req.principal!, req.body));
  }),
);

usersRouter.patch(
  '/:id',
  limiters.ownerWrite,
  validate({ params: idParams, body: updateSchema }),
  asyncHandler(async (req, res) => {
    res.json(await users.updateUser(req.principal!, req.params.id, req.body));
  }),
);

usersRouter.put(
  '/:id/permissions',
  limiters.ownerWrite,
  validate({ params: idParams, body: z.object({ permissions: permissionsSchema }).strict() }),
  asyncHandler(async (req, res) => {
    res.json(await users.setPermissions(req.principal!, req.params.id, req.body.permissions));
  }),
);

usersRouter.post(
  '/:id/password',
  limiters.ownerWrite,
  validate({ params: idParams, body: passwordSchema }),
  asyncHandler(async (req, res) => {
    res.json(await users.resetPassword(req.principal!, req.params.id, req.body.password));
  }),
);

usersRouter.delete(
  '/:id',
  limiters.ownerWrite,
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json(await users.deactivateUser(req.principal!, req.params.id));
  }),
);
