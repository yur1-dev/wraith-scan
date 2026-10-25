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

    const original = await db.collection("callouts").findOne({ _id: calloutOid });
    if (!original) return jsonError("Callout not found.", 404);

    const existing = await db.collection("callout_reposts").findOne({ calloutId: id, userId });
    if (existing) {
      await Promise.all([
        db.collection("callout_reposts").deleteOne({ calloutId: id, userId }),
        db.collection("callouts").updateOne({ _id: calloutOid }, { $inc: { reposts: -1 } }),
      ]);
      return NextResponse.json({ reposted: false });
    }

    const profile = await db.collection("profiles").findOne({ userId }, { projection: { displayName: 1, username: 1 } });
    const author = await db.collection("profiles").findOne({ userId: original.userId as string }, { projection: { displayName: 1, username: 1 } });

    await Promise.all([
      db.collection("callout_reposts").insertOne({ calloutId: id, userId, createdAt: Date.now() }),
      db.collection("callouts").updateOne({ _id: calloutOid }, { $inc: { reposts: 1 } }),
      db.collection("callouts").insertOne({
        userId,
        mint: original.mint,
        text: original.text,
        createdAt: Date.now(),
        mcapAtPost: original.mcapAtPost ?? null,
        hearts: 0,
        reposts: 0,
        repostedFrom: {
          id,
          userId: original.userId as string,
          displayName: author?.displayName ?? "Wraith trader",
          username: author?.username ?? null,
          text: original.text,
        },
        repostedBy: { userId, displayName: profile?.displayName ?? "Wraith trader", username: profile?.username ?? null },
      }),
    ]);
    return NextResponse.json({ reposted: true });
  } catch (err) {
    console.error("[callout repost POST]", err);
    return jsonError("Could not repost.", 500);
  }
}
