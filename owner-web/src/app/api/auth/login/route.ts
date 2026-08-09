import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin, BACKEND, unreachable } from "@/lib/http";
import { landingPath, NO_ACCESS } from "@/lib/roles";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_SECONDS,
  cookieOptions,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE_SECONDS,
} from "@/lib/session";

/**
 * Sign in. Proxies to the backend's owner login and turns the returned token pair into two
 * httpOnly cookies, so the browser never holds a JWT it could leak.
 *
 * The backend identifies a login by PHONE DIGITS ONLY — `app_user.handle` and `.email` are
 * vestigial. The client sends the full international number with no punctuation.
 */
export async function POST(req: NextRequest) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid request." } }, { status: 400 });
  }

  const { phone, password, accountType } = (body ?? {}) as {
    phone?: string;
    password?: string;
    accountType?: "owner" | "staff";
  };
  if (!phone || !password) {
    return NextResponse.json(
      { error: { message: "Enter your phone number and password." } },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phone: String(phone).replace(/\D/g, ""),
        password,
        // Forwarded only when it is one of the two known values, so a crafted body cannot
        // reach the backend's schema with something it has to reject.
        ...(accountType === "owner" || accountType === "staff" ? { accountType } : {}),
      }),
      cache: "no-store",
    });
  } catch (e) {
    return unreachable(e);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(json, { status: res.status });

  const { accessToken, refreshToken } = json as { accessToken?: string; refreshToken?: string };
  if (!accessToken || !refreshToken) {
    return NextResponse.json(
      { error: { message: "The API did not return a session." } },
      { status: 502 },
    );
  }

  // Return the user/business summary so the login page can route on it, but never the tokens.
  // `landingPath` is computed here rather than in the page because a staff account may have no
  // dashboard access at all, and "/dashboard" would land it straight on a No-access screen.
  const response = NextResponse.json({
    ok: true,
    user: json.user,
    business: json.business,
    landingPath: landingPath(json?.user?.permissions ?? NO_ACCESS),
  });
  response.cookies.set(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_MAX_AGE_SECONDS));
  response.cookies.set(REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_MAX_AGE_SECONDS));
  return response;
}
