import { NextRequest, NextResponse } from "next/server";
import { verifyPrivyAccessToken } from "@/lib/privyServer";

const PUBLIC_PATHS = new Set(["/login", "/"]);
const PUBLIC_API_PATHS = new Set(["/api/native-prices"]);
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/telegram/bot",
  "/api/traders/search",
  "/api/user/username/check",
  "/api/callouts",
];
const PRIVY_SESSION_COOKIE = "wraith_privy_session";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  if (
    PUBLIC_API_PATHS.has(pathname) ||
    PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(PRIVY_SESSION_COOKIE)?.value;
  const hasSession = sessionToken
    ? Boolean(await verifyPrivyAccessToken(sessionToken))
    : false;
  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === "/login" && hasSession) {
      return NextResponse.redirect(new URL("/app", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?)$).*)",
  ],
};
