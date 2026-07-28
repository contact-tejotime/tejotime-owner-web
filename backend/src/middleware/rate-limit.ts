import rateLimit from 'express-rate-limit';
import { Request } from 'express';

/**
 * In-memory limiter classes (single instance). Swap the store for Redis when
 * scaling horizontally — see docs/12-rate-limiting.md.
 */
const json429 = (req: Request, res: any) =>
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: req.requestId },
  });

const base = { standardHeaders: true, legacyHeaders: false, handler: json429 };

/** Per-authenticated-user key, falling back to IP. */
const userKey = (req: Request) => req.principal?.userId ?? req.ip ?? 'anon';

export const limiters = {
  login: rateLimit({ ...base, windowMs: 5 * 60_000, limit: 10 }),
  ownerRead: rateLimit({ ...base, windowMs: 60_000, limit: 300, keyGenerator: userKey }),
  ownerWrite: rateLimit({ ...base, windowMs: 60_000, limit: 120, keyGenerator: userKey }),
  publicRead: rateLimit({ ...base, windowMs: 60_000, limit: 60 }),
  publicWrite: rateLimit({ ...base, windowMs: 60 * 60_000, limit: 20 }),
  // Separate bucket from publicWrite: this is the only fully-anonymous, no-business-context
  // write in the public API, so an abusive submitter shouldn't also throttle real queue/booking
  // traffic sharing the same IP/NAT.
  inquiries: rateLimit({ ...base, windowMs: 60 * 60_000, limit: 8 }),
  otp: rateLimit({ ...base, windowMs: 60 * 60_000, limit: 5 }),
  global: rateLimit({ ...base, windowMs: 60_000, limit: 600 }),
};
