import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

/** Attach a correlation id to every request (honoring X-Request-Id if present). */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && incoming.length <= 200 ? incoming : `req_${randomUUID()}`;
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
