import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/** Clears the admin session cookie. The client then redirects to /login. */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
