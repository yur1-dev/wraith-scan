import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";

type Trade = {
  id?: string;
  symbol?: string;
  mint?: string;
  amountSol?: number;
  entryMcap?: number;
  exitMcap?: number;
  pnlPct?: number;
  status?: string;
  imageUrl?: string;
  ts?: number;
};

type Position = {
  id?: string;
  symbol?: string;
  mint?: string;
  amountSol?: number;
  entryMcap?: number;
  currentMcap?: number;
  currentPnlPct?: number;
  ts?: number;
  imageUrl?: string;
  status?: string;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  let { userId } = await params;

  try {
    const db = await getDb();

    // Accept either a 24-char hex userId or a @username
    let profile = null;
    if (/^[a-f\d]{24}$/i.test(userId)) {
      profile = await db.collection("profiles").findOne(
        { userId, publicTrading: true },
        {
          projection: {
            _id: 0,
            userId: 1,
            username: 1,
            displayName: 1,
            bio: 1,
            xHandle: 1,
            avatarDataUrl: 1,
            avatarUrl: 1,
            coverDataUrl: 1,
            updatedAt: 1,
          },
        },
      );
    } else {
      // Username lookup — strip leading @
      const handle = userId.replace(/^@/, "");
      profile = await db.collection("profiles").findOne(
        { username: new RegExp(`^${handle}$`, "i"), publicTrading: true },
        {
          projection: {
            _id: 0,
            userId: 1,
            username: 1,
            displayName: 1,
            bio: 1,
            xHandle: 1,
            avatarDataUrl: 1,
            avatarUrl: 1,
            coverDataUrl: 1,
            updatedAt: 1,
          },
        },
      );
      if (profile?.userId) userId = profile.userId;
    }

    if (!profile) {
      return NextResponse.json({ error: "Trader not found" }, { status: 404 });
    }

    const [tradeDoc, positionDoc, xLink, followerCount, followingCount] = await Promise.all([
      db
        .collection("trades")
        .findOne(
          { userId },
          { projection: { _id: 0, trades: 1 } },
        ),
      db
        .collection("positions")
        .findOne(
          { userId },
          { projection: { _id: 0, positions: 1 } },
        ),
      db.collection("x_links").findOne(
        { userId },
        { projection: { _id: 0, username: 1 } },
      ),
      db.collection("trader_follows").countDocuments({ traderId: userId }),
      db.collection("trader_follows").countDocuments({ followerId: userId }),
    ]);
    const allTrades: Trade[] = Array.isArray(tradeDoc?.trades)
      ? tradeDoc.trades
      : [];
    const closedTrades = allTrades
      .filter(
        (trade) =>
          typeof trade.pnlPct === "number" &&
          trade.status !== "failed",
      )
      .slice(0, 100);
    const openPositions: Position[] = Array.isArray(positionDoc?.positions)
      ? positionDoc.positions
          .filter(
            (position: Position) => position.status === "watching",
          )
          .slice(0, 50)
      : [];

    return NextResponse.json({
      trader: {
        userId: profile.userId,
        username: profile.username ?? null,
        displayName: profile.displayName || "Wraith trader",
        bio: profile.bio || "",
        xHandle: xLink?.username || "",
        avatarDataUrl: profile.avatarDataUrl || profile.avatarUrl || "",
        coverDataUrl: profile.coverDataUrl || "",
        followerCount,
        followingCount,
      },
      openPositions,
      closedTrades,
    });
  } catch (error) {
    console.error("[trader profile GET]", error);
    return NextResponse.json(
      { error: "Could not load trader profile" },
      { status: 500 },
    );
  }
}
