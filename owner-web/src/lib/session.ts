import { cookies } from "next/headers";

import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_SECONDS,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE_SECONDS,
} from "./session-cookie";

/**
 * owner-web session: two httpOnly cookies holding the backend-issued owner tokens.
 *
 * Server code reads the access token and forwards it as `Authorization: Bearer <jwt>`; the
 * backend authoritatively verifies the signature. Everything here only DECODES the payload —
 * to know whether a token is worth sending, and to read `bid` for cache keys. Browser JS can
 * neither read nor forge these cookies, and the proxy (src/proxy.ts) only presence-checks them.
 */
export { ACCESS_COOKIE, REFRESH_COOKIE, ACCESS_MAX_AGE_SECONDS, REFRESH_MAX_AGE_SECONDS };

/** Access-token claims the backend signs — see backend/src/modules/auth/token.service.ts. */
export interface AccessClaims {
  /** app_user.id */
  sub: string;
  /** business.id — the tenant. */
  bid: string;
  role: string;
  plan: string;
  typ: string;
  exp: number;
}

/** Decode (without verifying) a JWT payload; null on malformed input. */
function decodeJwt<T>(token: string): T | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Claims from the access token when it is present and not about to expire.
 *
 * The 30-second skew means a token that dies mid-flight is treated as already dead, so we
 * refresh before the call rather than after a 401 round trip.
 */
export function readAccess(token: string | undefined | null): AccessClaims | null {
  if (!token) return null;
  const claims = decodeJwt<AccessClaims>(token);
  if (!claims?.sub || typeof claims.exp !== "number") return null;
  if (Date.now() >= (claims.exp - 30) * 1000) return null;
  return claims;
}

export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value ?? null;
}

/**
 * The tenant this session belongs to.
 *
 * Every cached read MUST include this in its cache key. admin-panel deliberately excludes the
 * token from its key so all admins share one cache entry — correct for a platform-wide tool,
 * and a cross-tenant leak here, where each visitor sees a different business.
 */
export async function getBusinessId(): Promise<string | null> {
  return readAccess(await getAccessToken())?.bid ?? null;
}

/** Cookie options shared by every place that writes a session. */
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
