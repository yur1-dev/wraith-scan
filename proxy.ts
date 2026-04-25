import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = new Set(["/login", "/"]);
const PUBLIC_API_PREFIXES = ["/api/auth/"];
const ALLOWED_ORIGIN = process.env.NEXTAUTH_URL || "";

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawCallback = req.url;
    const callbackUrl = isSafeCallbackUrl(rawCallback, ALLOWED_ORIGIN)
      ? rawCallback
      : "/";

    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/app", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?)$).*)",
  ],
};

function isSafeCallbackUrl(url: string, allowedOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    if (allowedOrigin && parsed.origin === new URL(allowedOrigin).origin) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
