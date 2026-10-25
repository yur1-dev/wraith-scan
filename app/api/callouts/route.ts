import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongoClient";
import { getPrivySession } from "@/lib/privyAuth";
import { checkTokenHolding, hasTradedToken } from "@/lib/holdingCheck";

const TEXT_MAX = 280;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

function jsonError(msg: string, status: number) {
  return NextResponse.json({ error: msg }, { status });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawMint = params.get("mint") ?? "";
  const mint = EVM_RE.test(rawMint) ? rawMint.toLowerCase() : rawMint; // EVM tokens are keyed by lowercase address
  const userId = params.get("userId") ?? null;
  const following = params.get("following") === "1";
  const limit = Math.min(Number(params.get("limit") ?? "30"), 50);
  const offset = Math.max(Number(params.get("offset") ?? "0"), 0);

  if (mint && !MINT_RE.test(mint) && !EVM_RE.test(mint)) return jsonError("Invalid mint.", 400);

  const session = await getPrivySession();
  const viewerId = session?.user?.id ?? null;

  try {
    const db = await getDb();

    const filter: Record<string, unknown> = {};
    if (mint) filter.mint = mint;
    if (userId) filter.userId = userId;

    if (following && viewerId) {
      const follows = await db.collection("trader_follows")
        .find({ followerId: viewerId }, { projection: { _id: 0, traderId: 1 } })
        .limit(200)
        .toArray();
      const ids = follows.map((f) => f.traderId).filter((id): id is string => typeof id === "string");
      if (!ids.length) return NextResponse.json({ callouts: [], total: 0 });
      filter.userId = { $in: ids };
    }

    filter.parentId = { $exists: false };

    const [docs, total] = await Promise.all([
      db.collection("callouts")
        .find(filter, { projection: { _id: 1, userId: 1, mint: 1, text: 1, createdAt: 1, mcapAtPost: 1, hearts: 1, reposts: 1, imageUrl: 1, repostedFrom: 1 } })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection("callouts").countDocuments(filter),
    ]);

    if (!docs.length) return NextResponse.json({ callouts: [], total: 0 });

    const userIds = [...new Set(docs.map((d) => d.userId as string))];
    const calloutIds = docs.map((d) => (d._id as ObjectId).toHexString());

    const [profiles, positions, viewerHearts, viewerReposts, commentCounts] = await Promise.all([
      db.collection("profiles")
        .find({ userId: { $in: userIds } }, { projection: { _id: 0, userId: 1, username: 1, displayName: 1, avatarDataUrl: 1, avatarUrl: 1 } })
        .toArray(),
      mint
        ? db.collection("positions")
            .find({ userId: { $in: userIds }, mint, status: { $in: ["watching", "selling"] } }, {
              projection: { _id: 0, userId: 1, amountSol: 1, entryMcap: 1, currentMcap: 1, currentPnlPct: 1, symbol: 1 },
            })
            .toArray()
        : Promise.resolve([]),
      viewerId
        ? db.collection("callout_hearts")
            .find({ calloutId: { $in: calloutIds }, userId: viewerId }, { projection: { _id: 0, calloutId: 1 } })
            .toArray()
        : Promise.resolve([]),
      viewerId
        ? db.collection("callout_reposts")
            .find({ calloutId: { $in: calloutIds }, userId: viewerId }, { projection: { _id: 0, calloutId: 1 } })
            .toArray()
        : Promise.resolve([]),
      db.collection("callouts")
        .aggregate([
          { $match: { parentId: { $in: calloutIds } } },
          { $group: { _id: "$parentId", count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);

    const profileMap = new Map(profiles.map((p) => [p.userId as string, p]));
    const positionMap = new Map(positions.map((p) => [p.userId as string, p]));
    const heartedSet = new Set((viewerHearts as unknown as { calloutId: string }[]).map((h) => h.calloutId));
    const repostedSet = new Set((viewerReposts as unknown as { calloutId: string }[]).map((r) => r.calloutId));
    const commentCountMap = new Map((commentCounts as { _id: string; count: number }[]).map((c) => [c._id, c.count]));

    const callouts = docs.map((d) => {
      const id = (d._id as ObjectId).toHexString();
      const profile = profileMap.get(d.userId as string);
      const position = positionMap.get(d.userId as string);
      return {
        id,
        userId: d.userId,
        displayName: profile?.displayName ?? "Wraith trader",
        username: profile?.username ?? null,
        avatarDataUrl: profile?.avatarDataUrl || profile?.avatarUrl || "",
        text: d.text,
        createdAt: d.createdAt,
        mcapAtPost: d.mcapAtPost ?? null,
        hearts: d.hearts ?? 0,
        hearted: heartedSet.has(id),
        reposts: d.reposts ?? 0,
        reposted: repostedSet.has(id),
        comments: commentCountMap.get(id) ?? 0,
        mint: d.mint as string | undefined,
        imageUrl: d.imageUrl ?? null,
        repostedFrom: d.repostedFrom ?? null,
        position: position
          ? {
              amountSol: position.amountSol,
              entryMcap: position.entryMcap,
              currentMcap: position.currentMcap,
              currentPnlPct: position.currentPnlPct,
              symbol: position.symbol,
            }
          : null,
      };
    });

    return NextResponse.json({ callouts, total });
  } catch (err) {
    console.error("[callouts GET]", err);
    return jsonError("Could not load callouts.", 500);
  }
}

export async function POST(request: NextRequest) {
  const session = await getPrivySession();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON.", 400);
  }

  const { mint, text, mcapAtPost, imageUrl, parentId } = body as Record<string, unknown>;
  if (typeof mint === "string" && EVM_RE.test(mint)) return jsonError("Posting intel on EVM tokens is coming soon. You can read it here.", 403);
  if (typeof mint !== "string" || !MINT_RE.test(mint)) return jsonError("Invalid mint.", 400);
  if (typeof text !== "string" || !text.trim()) return jsonError("Text is required.", 400);
  const trimmed = text.trim().slice(0, TEXT_MAX);

  const safeImageUrl =
    typeof imageUrl === "string" && imageUrl.startsWith("data:image/") && imageUrl.length < 1_500_000
      ? imageUrl
      : null;

  try {
    const db = await getDb();
    const now = Date.now();

    // Comments (replies) are gated: the commenter must hold >= $3 of the token.
    let commentMint = mint;
    if (typeof parentId === "string" && /^[a-f0-9]{24}$/.test(parentId)) {
      const parent = await db.collection("callouts").findOne({ _id: new ObjectId(parentId) }, { projection: { mint: 1 } });
      if (!parent || typeof parent.mint !== "string") return jsonError("Callout not found.", 404);
      commentMint = parent.mint;
      const hold = await checkTokenHolding(userId, commentMint);
      if (!hold.ok) {
        return NextResponse.json(
          {
            error: hold.reason ?? `Hold at least $${hold.minUsd} of this token to comment (you hold $${hold.heldUsd.toFixed(2)}).`,
            code: "HOLD_REQUIRED",
            heldUsd: hold.heldUsd,
            minUsd: hold.minUsd,
          },
          { status: 403 },
        );
      }
    }

    // Posting intel on a token requires having bought or sold it.
    if (!(typeof parentId === "string" && /^[a-f0-9]{24}$/.test(parentId))) {
      if (!(await hasTradedToken(userId, mint))) {
        return NextResponse.json(
          { error: "Buy or sell this token on Wraith before posting intel on it.", code: "TRADE_REQUIRED" },
          { status: 403 },
        );
      }
    }

    // Remember the signed-in photo so other people see it too.
    if (session.user.image) {
      await db.collection("profiles").updateOne(
        { userId, $or: [{ avatarDataUrl: { $exists: false } }, { avatarDataUrl: "" }, { avatarDataUrl: null }], avatarUrl: { $ne: session.user.image } },
        { $set: { avatarUrl: session.user.image } },
      );
    }

    const doc: Record<string, unknown> = {
      userId,
      mint: commentMint,
      text: trimmed,
      createdAt: now,
      mcapAtPost: typeof mcapAtPost === "number" && isFinite(mcapAtPost) ? mcapAtPost : null,
      hearts: 0,
      reposts: 0,
    };
    if (safeImageUrl) doc.imageUrl = safeImageUrl;
    if (typeof parentId === "string" && /^[a-f0-9]{24}$/.test(parentId)) doc.parentId = parentId;

    const result = await db.collection("callouts").insertOne(doc);
    return NextResponse.json({ id: result.insertedId.toHexString(), createdAt: now });
  } catch (err) {
    console.error("[callouts POST]", err);
    return jsonError("Could not save callout.", 500);
  }
}
