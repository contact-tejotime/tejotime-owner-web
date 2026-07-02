import { NextFunction, Request, Response } from 'express';
import { ZodTypeAny, z } from 'zod';
import { AppError } from '../domain/errors';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** Validate request parts against zod schemas; replaces req parts with parsed data. */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as any;
      if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query));
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        next(
          new AppError(
            400,
            'VALIDATION_ERROR',
            err.issues[0]?.message ?? 'Validation failed',
            err.issues.map((i) => ({ field: i.path.join('.') || '(root)', rule: i.code, message: i.message })),
          ),
        );
      } else {
        next(err);
      }
    }
  };
}
