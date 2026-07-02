import { NextFunction, Request, Response } from 'express';
import { Errors } from '../domain/errors';
import { UserRole } from '../domain/enums';

/** Require the principal to hold one of the given roles (docs/03 matrix). */
export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.principal) return next(Errors.unauthenticated());
    if (roles.length && !roles.includes(req.principal.role)) {
      return next(Errors.forbidden('Your role cannot perform this action'));
    }
    next();
  };
}
