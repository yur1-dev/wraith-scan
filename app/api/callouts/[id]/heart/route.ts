import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongoClient";
import { getPrivySession } from "@/lib/privyAuth";

function jsonError(msg: string, status: number) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getPrivySession();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);
  const userId = session.user.id;

  const { id } = await params;
  if (!id || !/^[a-f0-9]{24}$/.test(id)) return jsonError("Invalid id.", 400);

  try {
    const db = await getDb();
    const calloutOid = new ObjectId(id);

    const existing = await db.collection("callout_hearts").findOne({ calloutId: id, userId });
    if (existing) {
      await Promise.all([
        db.collection("callout_hearts").deleteOne({ calloutId: id, userId }),
        db.collection("callouts").updateOne({ _id: calloutOid }, { $inc: { hearts: -1 } }),
      ]);
      return NextResponse.json({ hearted: false });
    } else {
      await Promise.all([
        db.collection("callout_hearts").insertOne({ calloutId: id, userId, createdAt: Date.now() }),
        db.collection("callouts").updateOne({ _id: calloutOid }, { $inc: { hearts: 1 } }),
      ]);
      return NextResponse.json({ hearted: true });
    }
  } catch (err) {
    console.error("[callout heart POST]", err);
    return jsonError("Could not update heart.", 500);
  }
}
