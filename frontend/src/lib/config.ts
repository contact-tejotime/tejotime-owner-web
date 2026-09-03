/** Runtime config for the customer site. Override via NEXT_PUBLIC_* env vars. */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api/v1";

export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:8080";

/**
 * Where the header "Sign in" link sends a business owner. Defaults to the
 * owner web app's dev port; production sets NEXT_PUBLIC_OWNER_ORIGIN the same
 * way it already sets NEXT_PUBLIC_ADMIN_ORIGIN.
 */
export const OWNER_ORIGIN =
  process.env.NEXT_PUBLIC_OWNER_ORIGIN ?? "http://localhost:3002";
