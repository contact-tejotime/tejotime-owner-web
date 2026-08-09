/**
 * Customer microsite origin for admin links / Appearance preview.
 * Env only in production builds — never falls back to a hardcoded tejotime.com host.
 */
export function frontendUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_FRONTEND_URL?.trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "";
}
