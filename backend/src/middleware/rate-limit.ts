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

/**
 * Per-(IP, account) key for login attempts.
 *
 * The default IP key is fine while a business has exactly one login, but a shop where several
 * people sign in from the same Wi-Fi shares one bucket — and with a 900s access token they
 * re-authenticate often enough to lock each other out. Keying on the account too means brute
 * force against one number is still throttled at 10/5min, while a colleague on the same network
 * is unaffected. `loginIpLimiter` below keeps a looser ceiling on the IP as a whole so this is
 * not a way to bypass throttling by rotating the phone number.
 */
const loginKey = (req: Request) => {
  const phone = String((req.body as { phone?: unknown } | undefined)?.phone ?? '').replace(/\D/g, '');
  return `${req.ip ?? 'anon'}:${phone || 'nophone'}`;
};

export const limiters = {
  login: rateLimit({ ...base, windowMs: 5 * 60_000, limit: 10, keyGenerator: loginKey }),
  /** Layered in front of `login`: bounds total attempts from one network. */
  loginIp: rateLimit({ ...base, windowMs: 5 * 60_000, limit: 60 }),
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
