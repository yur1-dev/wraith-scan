import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";

const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 20;
const ipMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipMap.get(ip);
  if (!entry || now > entry.resetAt) {
    ipMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

export async function GET(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (isRateLimited(ip))
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1)
    return NextResponse.json({ traders: [] });

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  try {
    const db = await getDb();
    const profiles = await db
      .collection("profiles")
      .find(
        {
          $and: [
            { publicTrading: true },
            {
              $or: [
                { username: new RegExp(`^${escaped}`, "i") },
                { displayName: new RegExp(escaped, "i") },
              ],
            },
          ],
        },
        {
          projection: {
            _id: 0,
            userId: 1,
            username: 1,
            displayName: 1,
            avatarDataUrl: 1,
            avatarUrl: 1,
          },
        },
      )
      .sort({ username: 1 })
      .limit(8)
      .toArray();

    const userIds = profiles.map((p) => p.userId).filter(Boolean);
    const followCounts = await db
      .collection("trader_follows")
      .aggregate([
        { $match: { traderId: { $in: userIds } } },
        { $group: { _id: "$traderId", count: { $sum: 1 } } },
      ])
      .toArray();
    const followerMap = new Map(
      followCounts.map((fc) => [fc._id as string, fc.count as number]),
    );

    return NextResponse.json({
      traders: profiles.map((p) => ({
        userId: p.userId,
        username: p.username ?? null,
        displayName: p.displayName || "Wraith trader",
        avatarDataUrl: p.avatarDataUrl || p.avatarUrl || "",
        followerCount: followerMap.get(p.userId) ?? 0,
      })),
    });
  } catch (error) {
    console.error("[traders search GET]", error);
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}
