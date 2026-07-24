import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "lizard_session";

// Public files a logged-out visitor (or the browser itself, pre-login) must
// still fetch un-redirected — install/offline support depends on it. Kept as a
// readable list here rather than crammed into the matcher regex, so a new
// asset type is one line, not a regex edit.
function isPublicFile(pathname: string): boolean {
  return (
    pathname === "/~offline" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".ico")
  );
}

// Fast-path redirect for page requests with no session cookie. Real validation
// (and stale-cookie handling) happens in the routes/AppShell — this only avoids
// rendering the app chrome for obviously-unauthenticated visitors.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicFile(pathname)) return NextResponse.next();
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
  matcher: ["/((?!api|_next/static|_next/image).*)"],
};
