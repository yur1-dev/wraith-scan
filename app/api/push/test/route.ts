// POST /api/push/test → sends one test notification to this user's devices and reports exactly what happened.
import { NextResponse } from "next/server";
import { getPrivySession } from "@/lib/privyAuth";
import { pushAnyConfigured, sendTest } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getPrivySession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!pushAnyConfigured()) return NextResponse.json({ error: "Push is not set up on the server yet." }, { status: 503 });
  try {
    return NextResponse.json(await sendTest(userId));
  } catch (e) {
    console.error("[push test]", e);
    return NextResponse.json({ error: "Could not send the test. Try again." }, { status: 500 });
  }
}
