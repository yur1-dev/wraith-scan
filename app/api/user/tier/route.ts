// app/api/user/tier/route.ts
// Called from the frontend whenever the user's tier is known.
// Saves tier to MongoDB so the alert broadcaster can query it.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import clientPromise from "@/lib/mongoClient";
import { ObjectId } from "mongodb";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tier, walletAddress } = await req.json();

  // Validate tier value
  const validTiers = ["GHOST", "SHADE", "SPECTER", "WRAITH"];
  if (!validTiers.includes(tier))
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });

  const client = await clientPromise;
  const db = client.db();

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
