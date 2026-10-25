// app/api/user/tier/route.ts
// Called from the frontend whenever the user's tier is known.
// Saves tier to MongoDB so the alert broadcaster can query it.

import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getPrivySession } from "@/lib/privyAuth";
import { getDb } from "@/lib/mongoClient";

const VALID_TIERS = ["GHOST", "SHADE", "SPECTER", "WRAITH"];

export async function POST(req: NextRequest) {
  const session = await getPrivySession();
  if (!session?.user?.id || !ObjectId.isValid(session.user.id))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { tier?: unknown; walletAddress?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tier, walletAddress } = body;
  if (typeof tier !== "string" || !VALID_TIERS.includes(tier))
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  if (
    walletAddress !== undefined &&
    (typeof walletAddress !== "string" || walletAddress.length > 64)
  )
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });

  const db = await getDb();
  await db.collection("users").updateOne(
    { _id: new ObjectId(session.user.id) },
    {
      $set: {
        tier,
        ...(walletAddress ? { walletAddress } : {}),
        tierUpdatedAt: new Date(),
      },
    },
  );

  return NextResponse.json({ ok: true });
}
