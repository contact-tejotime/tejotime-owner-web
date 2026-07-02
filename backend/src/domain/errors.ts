/**
 * Typed application errors → the error envelope in docs/11-errors-logging.md.
 * Controllers throw AppError; the errorHandler middleware serializes it.
 */
export interface ErrorDetail {
  field: string;
  rule?: string;
  message: string;
}

export class AppError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(httpStatus: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
  }
}

/** Factory helpers for the common cases in the code/status catalog. */
export const Errors = {
  validation: (message = 'Validation failed', details?: ErrorDetail[]) =>
    new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthenticated: (message = 'Authentication required') =>
    new AppError(401, 'UNAUTHENTICATED', message),
  invalidCredentials: (message = 'Invalid credentials') =>
    new AppError(401, 'INVALID_CREDENTIALS', message),
  tokenExpired: (message = 'Token expired') => new AppError(401, 'TOKEN_EXPIRED', message),
  forbidden: (message = 'Not permitted') => new AppError(403, 'FORBIDDEN', message),
  planLimit: (message = 'Upgrade required') => new AppError(402, 'PLAN_LIMIT_REACHED', message),
  notFound: (message = 'Not found') => new AppError(404, 'NOT_FOUND', message),
  conflict: (code: string, message: string) => new AppError(409, code, message),
  gone: (code: string, message: string) => new AppError(410, code, message),
  invalidState: (message = 'Invalid state transition') =>
    new AppError(422, 'INVALID_STATE_TRANSITION', message),
  rateLimited: (message = 'Too many requests') => new AppError(429, 'RATE_LIMITED', message),
  internal: (message = 'Internal error') => new AppError(500, 'INTERNAL_ERROR', message),
};
