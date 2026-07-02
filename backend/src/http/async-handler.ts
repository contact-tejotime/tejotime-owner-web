import { NextFunction, Request, Response } from 'express';

/** Wrap async route handlers so rejections reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };

/** Narrow req.principal (set by authenticate) — throws if missing. */
export function requirePrincipal(req: Request) {
  if (!req.principal) {
    throw Object.assign(new Error('UNAUTHENTICATED'), { httpStatus: 401 });
  }
  return req.principal;
}
