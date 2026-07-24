import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";
import { t, format } from "@/i18n";

/**
 * Admin login: forwards mobile + shared static password to the backend, which
 * checks the admins allow-list and bcrypt-compares the password. On success the
 * backend returns an admin JWT, stored in an httpOnly cookie so (protected) pages
 * become reachable and server code can forward it as a Bearer token.
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

export async function POST(req: NextRequest) {
  let body: { mobile?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: t.api.invalidJson } }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND}/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile: body.mobile, password: body.password }),
      cache: "no-store",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : t.api.failedToReach;
    return NextResponse.json(
      { error: { message: format(t.api.backendUnreachable, { backend: BACKEND, message }) } },
      { status: 502 },
    );
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok || !json?.token) {
    return NextResponse.json(json, { status: res.ok ? 502 : res.status });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, json.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
