import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

const THIRTY_DAYS = 30 * 86400;

// Off by default: a Secure cookie is silently dropped by the browser over
// plain HTTP, which locks you out with no error. Set COOKIE_SECURE=true once
// the deployment terminates TLS.
const secure = process.env.COOKIE_SECURE === "true";

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: THIRTY_DAYS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 0 });
}
