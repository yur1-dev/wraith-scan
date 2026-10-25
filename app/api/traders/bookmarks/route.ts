import { getPrivySession } from "@/lib/privyAuth";
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongoClient";

async function getUserId() {
  const session = await getPrivySession();
  return session?.user?.id ?? null;
}

export async function POST(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to save traders." }, { status: 401 });
  }

  try {
    const body: unknown = await request.json();
    const traderId =
      typeof body === "object" &&
      body !== null &&
      "traderId" in body &&
      typeof body.traderId === "string"
        ? body.traderId
        : "";
    if (!ObjectId.isValid(traderId) || traderId === userId) {
      return NextResponse.json({ error: "Invalid trader." }, { status: 400 });
    }

    const db = await getDb();
    const profile = await db.collection("profiles").findOne(
      { userId: traderId, publicTrading: true },
      { projection: { _id: 1 } },
    );
    if (!profile) {
      return NextResponse.json(
        { error: "This trader is not publicly available." },
        { status: 404 },
      );
    }

    await db.collection("user_settings").updateOne(
      { userId },
      {
        $setOnInsert: { userId },
        $addToSet: { bookmarkedTraders: traderId },
      },
      { upsert: true },
    );
    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("[trader bookmarks POST]", error);
    return NextResponse.json(
      { error: "Could not save this trader." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to manage saved traders." }, { status: 401 });
  }

  try {
    const traderId = request.nextUrl.searchParams.get("traderId") ?? "";
    if (!ObjectId.isValid(traderId)) {
      return NextResponse.json({ error: "Invalid trader." }, { status: 400 });
    }

    const db = await getDb();
    await db.collection("user_settings").updateOne(
      { userId },
      { $pull: { bookmarkedTraders: traderId } },
    );
    return NextResponse.json({ saved: false });
  } catch (error) {
    console.error("[trader bookmarks DELETE]", error);
    return NextResponse.json(
      { error: "Could not remove this trader." },
      { status: 500 },
    );
  }
}
