# 06 — Authentication & Authorization

## 1. Principals

| Principal | Credential | Token type | Scope |
|---|---|---|---|
| Owner / Manager / Staff | `handle` + password (`Login.tsx`) | JWT access + refresh | one `business_id`, a `role` |
| Customer | phone + OTP (`OTPInput.tsx`) | short-lived customer token / signed ticket | one `business_id` (the microsite's), own tickets |
| Platform admin | internal SSO | JWT (admin aud) | cross-tenant, audited |
| Service/webhook | provider HMAC signature | none (signature) | webhook-specific |

## 2. Owner authentication

### 2.1 Login (FR-A1)
`POST /auth/login { handle, password }`.
1. Look up active `user` by `handle` (unique platform-wide).
2. Verify password with **argon2id** (`password_hash`). Constant-time; identical error for unknown handle vs wrong password → `401 INVALID_CREDENTIALS`.
3. Empty handle/password → `400` message "Enter your user ID and password" (exact mock copy).
4. Issue tokens; record `last_login_at`, create `auth_session`.

### 2.2 Tokens
- **Access token (JWT)**: 15-min TTL. Claims: `sub` (user id), `bid` (business id), `role`, `plan`, `iat`, `exp`, `jti`. Signed RS256 (rotateable keys) or HS256 with a strong secret.
- **Refresh token**: opaque random (or JWT), 30-day TTL, stored **hashed** in `auth_session`, rotated on every refresh (reuse detection → revoke session family).
- `POST /auth/refresh` swaps a valid refresh token for a new access+refresh pair. `POST /auth/logout` revokes the presented refresh token/session.
- Mobile stores tokens in secure storage (Keychain/Keystore via `expo-secure-store` — not currently in the app; add it).

### 2.3 OTP (FR-A5)
The design system ships a 4-digit `OTPInput`. Provide OTP as:
- **Owner MFA / passwordless onboarding**: `POST /auth/otp/request { phone }` → `POST /auth/otp/verify { phone, code }`.
- Codes are 4–6 digits, hashed in `otp_verification`, TTL 5 min, max 5 attempts, single-use, rate-limited per phone/IP ([12](./12-rate-limiting.md)).

> **Open question:** the mock login is password-only; the OTP component may be intended for **customers**, not owners. Confirm in [17](./17-assumptions-open-questions.md#authentication).

## 3. Customer authentication (public microsite)

The microsite is anonymous until a customer joins/books. To prevent queue-spam and protect PII:

1. `POST /public/businesses/:slug/otp/request { phone }` — sends SMS OTP.
2. `POST /public/businesses/:slug/otp/verify { phone, code }` — returns a **customer token** (JWT, ~30-min TTL, claims `phone`, `bid`, `aud:customer`).
3. Join/book endpoints accept that token (`otpToken`) and bind the created ticket to the verified phone.
4. **Ticket access**: `GET /public/tickets/:id` requires either the customer token or a **signed, unguessable ticket URL** (HMAC of ticket id + phone). A bare sequential id must never return another customer's PII.

> OTP gating on join can be made optional per business (friction vs. abuse). Default: OTP required for booking, optional for walk-in-style queue-join, backed by rate limits. Flag in [17](./17-assumptions-open-questions.md#authentication).

## 4. Authorization model

### 4.1 Tenant isolation (NFR-SE4)
`business_id` is **always** taken from the authenticated token (`bid` claim for owner/customer, or resolved from `:slug` for public reads), **never** from a client-supplied body/param. Every repository method requires a `businessId` argument; there is no unscoped data access path. Requesting an entity id from another tenant returns `404` (not `403`) to avoid existence enumeration.

### 4.2 Role guard (see [03](./03-roles-and-permissions.md#3-permission-matrix-owner-app-scope))
Route middleware asserts the principal's `role` permits the action. Staff-scoped actions (start/complete/extend/reorder) additionally assert the entry's `staff_id` belongs to the acting staff (or the actor is owner/manager).

### 4.3 Ownership guard (customer)
Customer mutations (`GET/DELETE /public/tickets/:id`) verify the ticket's phone matches the token's `phone` (or the signed-URL HMAC validates).

### 4.4 Plan guard (NFR-SE10)
A middleware/repository decorator applies the subscription's limits to list/detail responses (customer list truncation for free plan, FR-E3). Enforced server-side regardless of client.

## 5. Middleware order (Express)

```
requestId → helmet/CORS → bodyParser → rateLimit(class)
  → authenticate (resolve principal or anonymous)
  → tenantContext (bind business_id)
  → authorize(role/capability)
  → validate(zod schema)
  → controller → service (tenant-scoped) → response
  → errorHandler (envelope)
```

## 6. CORS & CSRF

- **CORS allow-list**: owner app (native — no origin/uses bearer), marketing + microsite web origins (`tejotime.com`, `*.tejotime.com`), and staging. Credentials via bearer tokens (not cookies) → CSRF is a non-issue for the API. If any cookie-based session is introduced (e.g., admin), add CSRF tokens + `SameSite=Lax`.

## 7. Secrets & keys

- JWT signing keys, OTP pepper, HMAC ticket-URL secret, provider webhook secrets — all from env/secret manager ([14](./14-environment-variables.md)), rotated on a schedule; support 2 active keys during rotation (`kid` in JWT header).

## 8. Session/security policies

| Policy | Value |
|---|---|
| Access TTL | 15 min |
| Refresh TTL | 30 days, rotating, reuse-detection |
| OTP TTL / attempts | 5 min / 5 attempts / single-use |
| Password hash | argon2id (mem 64MB, t=3) |
| Password policy | ≥ 8 chars; block breached (HIBP k-anon) — owner onboarding |
| Failed-login lockout | exponential backoff + temp lock after N fails per handle/IP |
| Token audience | `owner` vs `customer` vs `admin` — never interchangeable |
