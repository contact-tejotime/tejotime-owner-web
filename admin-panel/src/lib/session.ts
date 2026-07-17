import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./session-cookie";

/**
 * Admin-panel session: the httpOnly cookie holds the backend-issued admin JWT
 * (minted by /admin/auth/verify-otp). Server code reads it and forwards it as
 * `Authorization: Bearer <jwt>` on every backend call; the backend authoritatively
 * verifies the signature. Here we only decode the payload to gate the UI (check exp)
 * and to fetch the token for outgoing calls. The cookie is httpOnly, so browser JS
 * can't read or forge it; the proxy (src/proxy.ts, Next 16's renamed middleware)
 * just presence-checks it.
 */
export { SESSION_COOKIE };

/** Cookie lifetime — mirrors the backend JWT_ADMIN_TTL (12h). */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/** Decode (without verifying) a JWT's payload; returns null on malformed input. */
function decodeJwt(token: string): { sub?: string; exp?: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Read the admin JWT and return the admin mobile (`sub`) if the token is present and
 * not expired, else null. UX gate only — the backend does the real signature check.
 */
export function readSession(token: string | undefined | null): { mobile: string } | null {
  if (!token) return null;
  const claims = decodeJwt(token);
  if (!claims?.sub || typeof claims.exp !== "number") return null;
  if (Date.now() >= claims.exp * 1000) return null;
  return { mobile: claims.sub };
}

/** The raw admin JWT from the session cookie, for server→backend Authorization headers. */
export async function getAdminToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}
