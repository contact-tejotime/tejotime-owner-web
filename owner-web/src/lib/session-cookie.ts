/**
 * Session cookie names, isolated in their own module (no `node:crypto` import) so the
 * Edge-runtime proxy can import them without pulling in Node crypto — which only session.ts
 * (Node runtime) needs. Same reason admin-panel/src/lib/session-cookie.ts exists.
 *
 * TWO cookies, unlike the admin panel's one. Business logins use the owner auth flow: a short
 * access token plus a long-lived rotating refresh token (backend JWT_ACCESS_TTL=900s,
 * JWT_REFRESH_TTL=30d). The admin panel gets away with a single 12h JWT because admin tokens
 * never refresh.
 */
export const ACCESS_COOKIE = "tt_owner_at";
export const REFRESH_COOKIE = "tt_owner_rt";

/** Mirrors the backend's JWT_ACCESS_TTL. */
export const ACCESS_MAX_AGE_SECONDS = 15 * 60;

/** Mirrors the backend's JWT_REFRESH_TTL. This is what decides "stay signed in". */
export const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Is this access token still usable?
 *
 * Edge-safe on purpose: the proxy runs on the Edge runtime, where `Buffer` does not exist, so
 * this uses `atob` rather than session.ts's Node decoder. Keep it dependency-free.
 *
 * The 30-second skew treats a token that would die mid-flight as already dead, so the proxy
 * refreshes ahead of the request instead of the request failing and retrying.
 */
export function accessTokenIsFresh(token: string | undefined | null): boolean {
  if (!token) return false;
  const payload = token.split(".")[1];
  if (!payload) return false;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      payload.length + ((4 - (payload.length % 4)) % 4),
      "=",
    ));
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === "number" && Date.now() < (exp - 30) * 1000;
  } catch {
    return false;
  }
}
