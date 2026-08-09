import { NextFunction, Request, Response } from 'express';
import { Errors } from '../domain/errors';
import { verifyAccessToken } from '../modules/auth/token.service';

/**
 * Owner-app authentication: resolves req.principal from the Bearer access token.
 * business_id ALWAYS comes from the token (never from client input) — tenant
 * isolation by construction (docs/06 §4.1).
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return next(Errors.unauthenticated());
  }
  const token = header.slice(7).trim();
  try {
    const claims = verifyAccessToken(token);
    if (claims.typ !== 'access') return next(Errors.unauthenticated());
    req.principal = {
      type: 'owner',
      userId: claims.sub,
      businessId: claims.bid,
      role: claims.role,
      plan: claims.plan,
      // Absent in tokens minted before 0019. Both defaults are the restrictive ones, so an
      // in-flight token from the previous deploy degrades to "no seat, not the super owner"
      // rather than to extra access. They correct themselves at the next 15-minute refresh.
      staffId: claims.sid ?? null,
      isSuperOwner: claims.sup === true,
    };
    next();
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError') return next(Errors.tokenExpired());
    next(Errors.unauthenticated('Invalid token'));
  }
}
