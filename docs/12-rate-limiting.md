# 12 — Rate Limiting & Abuse Prevention

Public microsite endpoints are the main abuse surface (unauthenticated queue-join, OTP send → SMS cost, enumeration). Owner endpoints need protection too but are authenticated.

## 1. Mechanism

- **Redis-backed** sliding-window / token-bucket limiter (e.g. `rate-limiter-flexible`), shared across all API instances.
- Keyed by the most specific stable identifier available: `businessId`, `userId`, verified `phone`, `ip`, or a composite.
- Responses on limit: `429 RATE_LIMITED` + `Retry-After` + `RateLimit-*` headers.
- Layer with an edge/WAF limiter (Cloudflare) for volumetric protection before traffic hits the app.

## 2. Limit classes

| Class | Endpoints | Key | Limit (suggested) |
|---|---|---|---|
| **Auth-login** | `POST /auth/login` | ip + handle | 10 / 5 min, then exponential lockout |
| **OTP-request** | `.../otp/request` | phone + ip | 1 / 30s, 5 / hour, 10 / day per phone |
| **OTP-verify** | `.../otp/verify` | phone | 5 attempts / code, then invalidate |
| **Public-join/book** | `POST /public/.../queue`, `/appointments` | phone + ip (+ business) | 3 active tickets / phone / business; 10 / hour / ip |
| **Public-read** | `GET /public/businesses/:slug`, `/availability`, `/slots` | ip | 60 / min (cache-first; cheap) |
| **Ticket-poll** | `GET /public/tickets/:id` | ticket + ip | 30 / min (sockets preferred) |
| **Owner-read** | `GET` owner routes | userId | 300 / min |
| **Owner-write** | queue/appt/customer mutations | userId | 120 / min (bursty during rush is normal) |
| **Uploads-sign** | `POST /uploads/sign` | userId | 60 / hour |
| **Webhooks** | `/webhooks/*` | provider ip allow-list + signature | high; no user limit, signature-gated |
| **Global per-IP** | all | ip | 600 / min safety net |

Values are starting points — tune from production metrics.

## 3. Endpoint-specific abuse controls

- **OTP / SMS cost control:** hard per-phone daily cap; escalate to CAPTCHA (hCaptcha/Turnstile) after threshold; block obvious VOIP/disposable ranges if fraud appears; honor DND.
- **Queue-join flooding:** cap concurrent *active* tickets per phone per business (e.g., 1–3). A phone can't hold 50 tokens. Require OTP verification when abuse detected.
- **Enumeration:** `NOT_FOUND` (not `403`) for cross-tenant ids; constant-time responses on auth/OTP; slug lookups rate-limited.
- **Booking abuse:** limit bookings per phone per day; expire unconfirmed holds.
- **Login brute force:** lockout + backoff + alert; optional device fingerprint.

## 4. Fairness & multi-tenant isolation

- Per-**business** quotas prevent one busy tenant from starving others on shared infra.
- Background SMS throughput throttled per provider account and per business.

## 5. Headers & client contract

```
RateLimit-Limit: 60
RateLimit-Remaining: 12
RateLimit-Reset: 34            # seconds
Retry-After: 34               # on 429 only
```
Clients (esp. the microsite poll and mobile retry logic) must honor `Retry-After` and prefer Socket.IO over polling to stay well under limits.

## 6. Exemptions

- Health checks, internal service-to-service (network-isolated), and signed webhooks bypass user limits (still WAF-protected).
- Platform admin has elevated limits, audited.
