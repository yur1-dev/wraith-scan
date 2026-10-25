import { NextRequest, NextResponse } from "next/server";
import { getPrivySession, PRIVY_SESSION_COOKIE } from "@/lib/privyAuth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getPrivySession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, user: session.user });
  response.cookies.set(PRIVY_SESSION_COOKIE, getBearerToken(request), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PRIVY_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function getBearerToken(request: NextRequest): string {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    throw new Error("The Privy access token was not provided.");
  }
  return token;
}
