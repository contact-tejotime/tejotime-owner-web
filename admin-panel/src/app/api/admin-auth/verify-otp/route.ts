import { NextRequest, NextResponse } from "next/server";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

/**
 * Step 2 of admin login. Forwards mobile + OTP to the backend for verification;
 * on success mints an httpOnly signed session cookie so the (protected) pages
 * become reachable. The OTP itself is validated by the backend (demo `1234` for
 * now) — this handler never hard-codes it.
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "";

export async function POST(req: NextRequest) {
  if (!ADMIN_KEY) {
    return NextResponse.json(
      { error: { message: "Server misconfigured: ADMIN_API_KEY is not set in admin-panel env." } },
      { status: 500 },
    );
  }

  let body: { mobile?: unknown; otp?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body." } }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND}/admin/auth/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": ADMIN_KEY },
      body: JSON.stringify({ mobile: body.mobile, otp: body.otp }),
      cache: "no-store",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to reach backend";
    return NextResponse.json(
      { error: { message: `Could not reach the backend API at ${BACKEND}. Is it running? (${message})` } },
      { status: 502 },
    );
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok || !json?.mobile) {
    return NextResponse.json(json, { status: res.ok ? 502 : res.status });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, createSession(json.mobile), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
