import { Router } from 'express';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import { changePasswordSchema, loginSchema, refreshSchema } from './auth.schemas';
import * as authService from './auth.service';
import { changeOwnPassword } from '../users/users.service';
import { signSocketTicket, SOCKET_TICKET_TTL } from './token.service';

export const authRouter = Router();

authRouter.post(
  '/login',
  // IP ceiling first, then the per-(IP, phone) bucket — so one shop's staff sharing a Wi-Fi
  // can't lock each other out, while brute force against a single number is still throttled.
  limiters.loginIp,
  limiters.login,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { phone, password, accountType } = req.body;
    res.json(await authService.login(phone, password, accountType));
  }),
);

authRouter.post(
  '/refresh',
  validate({ body: refreshSchema }),
  asyncHandler(async (req, res) => {
    res.json(await authService.refresh(req.body.refreshToken));
  }),
);

authRouter.post(
  '/logout',
  validate({ body: refreshSchema }),
  asyncHandler(async (req, res) => {
    res.json(await authService.logout(req.body.refreshToken));
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await authService.me(req.principal!));
  }),
);

/**
 * Mint a 60-second ticket for the `/owner` socket. Used by owner-web, whose access token is an
 * httpOnly cookie the browser cannot read (see signSocketTicket). Built from the principal only.
 */
authRouter.post(
  '/socket-ticket',
  authenticate,
  limiters.ownerRead,
  asyncHandler(async (req, res) => {
    const p = req.principal!;
    const ticket = signSocketTicket({ userId: p.userId, businessId: p.businessId, role: p.role, staffId: p.staffId });
    res.json({ ticket, expiresIn: SOCKET_TICKET_TTL });
  }),
);

/**
 * Change your own password. Every login except the super owner's is created by somebody else,
 * who therefore knows the initial password — so this is the first thing a new co-owner or
 * staff member should do. Rate-limited on the login bucket because it accepts a password.
 */
authRouter.post(
  '/password',
  authenticate,
  limiters.ownerWrite,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    res.json(await changeOwnPassword(req.principal!, req.body.currentPassword, req.body.newPassword));
  }),
);
