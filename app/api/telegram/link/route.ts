// app/api/telegram/link/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import clientPromise from "@/lib/mongoClient";
import { ObjectId } from "mongodb";
import crypto from "crypto";

// POST — generate a one-time deep link token
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = await clientPromise;
  const db = client.db();

  const token = crypto.randomBytes(12).toString("hex");

  await db.collection("telegram_links").insertOne({
    token,
    userId: new ObjectId(session.user.id),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min expiry
  });

  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "wraithscan_bot";
  const deepLink = `https://t.me/${botUsername}?start=${token}`;

  return NextResponse.json({ url: deepLink });
}

// DELETE — unlink Telegram from account
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = await clientPromise;
  const db = client.db();

  await db
    .collection("users")
    .updateOne(
      { _id: new ObjectId(session.user.id) },
      { $unset: { telegramChatId: "", telegramLinkedAt: "", tier: "" } },
    );

  return NextResponse.json({ ok: true });
}
