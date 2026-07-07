import { createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE } from "./session-cookie";

/**
 * Admin-panel session cookie: an httpOnly, HMAC-signed token that proves the
 * visitor completed the mobile + OTP login. Signed with the server-only
 * ADMIN_API_KEY (never shipped to the browser), so a client can't forge one.
 *
 * Used only by server code (route handlers + the (protected) layout) — the Node
 * runtime, so `node:crypto` is available. The middleware only presence-checks the
 * cookie for a fast redirect; this file does the authoritative verification.
 */
export { SESSION_COOKIE };

/** Sessions expire after 12h — re-login required after that. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_SECONDS = MAX_AGE_MS / 1000;

const SECRET = process.env.ADMIN_API_KEY ?? "";

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/** Build a signed session token for a verified admin mobile. */
export function createSession(mobile: string): string {
  const payload = b64url(JSON.stringify({ mobile, iat: Date.now() }));
  return `${payload}.${sign(payload)}`;
}

/** Verify a session token; returns the admin mobile, or null if invalid/expired. */
export function verifySession(value: string | undefined | null): { mobile: string } | null {
  if (!value || !SECRET) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const { mobile, iat } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof mobile !== "string" || typeof iat !== "number") return null;
    if (Date.now() - iat > MAX_AGE_MS) return null;
    return { mobile };
  } catch {
    return null;
  }
}
