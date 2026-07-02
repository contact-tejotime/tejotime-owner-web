import { Router } from 'express';
import { asyncHandler } from '../../http/async-handler';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { limiters } from '../../middleware/rate-limit';
import { loginSchema, refreshSchema } from './auth.schemas';
import * as authService from './auth.service';

export const authRouter = Router();

authRouter.post(
  '/login',
  limiters.login,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { handle, password } = req.body;
    res.json(await authService.login(handle, password));
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
