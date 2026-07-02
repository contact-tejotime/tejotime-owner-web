import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../domain/errors';
import { logger } from '../config/logger';
import { isProd } from '../config/env';

/** Maps a raised Postgres 'TEJO:<CODE>' error (from plpgsql) → HTTP. */
const PG_ERROR_MAP: Record<string, { status: number; code: string; message: string }> = {
  NOT_FOUND: { status: 404, code: 'NOT_FOUND', message: 'Not found' },
  INVALID_STATE: { status: 422, code: 'INVALID_STATE_TRANSITION', message: 'Invalid state transition' },
  SEAT_BUSY: { status: 409, code: 'SEAT_BUSY', message: 'That seat is already serving someone' },
  ALREADY_CHECKED_IN: { status: 409, code: 'ALREADY_CHECKED_IN', message: 'Appointment already checked in' },
};

export function mapPgError(message: string): AppError | null {
  const m = /TEJO:([A-Z_]+)/.exec(message);
  if (!m) return null;
  const mapped = PG_ERROR_MAP[m[1]!];
  if (!mapped) return new AppError(422, m[1]!, m[1]!.replace(/_/g, ' ').toLowerCase());
  return new AppError(mapped.status, mapped.code, mapped.message);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let appErr: AppError;

  if (err instanceof AppError) {
    appErr = err;
  } else if (err instanceof ZodError) {
    appErr = new AppError(400, 'VALIDATION_ERROR', 'Validation failed', err.issues.map((i) => ({
      field: i.path.join('.') || '(root)',
      rule: i.code,
      message: i.message,
    })));
  } else if (err instanceof Error && /TEJO:/.test(err.message)) {
    appErr = mapPgError(err.message) ?? new AppError(422, 'INVALID_STATE_TRANSITION', 'Invalid operation');
  } else {
    const e = err as Error;
    logger.error({ err: e, requestId: req.requestId, path: req.path }, 'Unhandled error');
    appErr = new AppError(500, 'INTERNAL_ERROR', isProd ? 'Internal error' : e?.message ?? 'Internal error');
  }

  if (appErr.httpStatus >= 500) {
    logger.error({ err, requestId: req.requestId, code: appErr.code }, appErr.message);
  } else {
    logger.warn({ requestId: req.requestId, code: appErr.code, status: appErr.httpStatus }, appErr.message);
  }

  res.status(appErr.httpStatus).json({
    error: {
      code: appErr.code,
      message: appErr.message,
      requestId: req.requestId,
      ...(appErr.details ? { details: appErr.details } : {}),
    },
  });
}

/** 404 fallback for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.path}`, requestId: req.requestId },
  });
}
