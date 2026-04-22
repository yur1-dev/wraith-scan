import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// Routes that are publicly accessible without a session
const PUBLIC_PATHS = new Set(["/login"]);

// API routes that handle their own auth (NextAuth internals)
const PUBLIC_API_PREFIXES = ["/api/auth/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow NextAuth's own endpoints
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Always allow static assets
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  // Check JWT token
  const token = await getToken({ req });

  if (!token) {
    // API routes: return 401 JSON — never redirect, never leak HTML
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Public pages: allow through
    if (PUBLIC_PATHS.has(pathname)) {
      return NextResponse.next();
    }

    // All other pages: redirect to login
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user hitting /login — send them home
  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|[^/]+\\.[^/]+$).*)"],
};
