import { NextRequest, NextResponse } from "next/server";
import { t, format } from "@/i18n";

/**
 * Step 1 of admin login. Forwards the submitted mobile number to the backend's
 * public request-otp endpoint (which checks it's a known admin). Running server-side
 * avoids CORS and keeps a single request topology (browser → admin server → backend).
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

export async function POST(req: NextRequest) {
  let body: { mobile?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: t.api.invalidJson } }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND}/admin/auth/request-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile: body.mobile }),
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
  return NextResponse.json(json, { status: res.status });
}
