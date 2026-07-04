import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "lizard_session";

// Fast-path redirect for page requests with no session cookie. Real validation
// (and stale-cookie handling) happens in the routes/AppShell — this only avoids
// rendering the app chrome for obviously-unauthenticated visitors.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAuthPage = pathname === "/login";
  const hasCookie = req.cookies.has(SESSION_COOKIE);
  if (!hasCookie && !isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (hasCookie && isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // run on pages only; exclude api, static assets, and the auth endpoints
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
