// POST /api/push/test → sends one test notification to this user's devices.
import { NextResponse } from "next/server";
import { getPrivySession } from "@/lib/privyAuth";
import { pushConfigured, sendTest } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getPrivySession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ error: "Push is not set up on the server yet." }, { status: 503 });
  const sent = await sendTest(userId);
  return NextResponse.json({ sent });
}
