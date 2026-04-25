// app/api/telegram/stale/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/mongoClient";

const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function send(chatId: string, text: string) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { symbol, keyword, initialMcap, currentMcap, contractAddress, seenAt } =
    body;

  // Only send stale alert if token is 20+ mins old and below 1.5x
  const ageMs = Date.now() - seenAt;
  const xNow = initialMcap > 0 ? currentMcap / initialMcap : 0;

  if (ageMs < 20 * 60 * 1000 || xNow >= 1.5) {
    return NextResponse.json({ skipped: true });
  }

  const db = await getDb();
  const user = await db
    .collection("users")
    .findOne(
      { _id: new (require("mongodb").ObjectId)(session.user.id) },
      { projection: { telegramChatId: 1, tier: 1 } },
    );

  if (!user?.telegramChatId) {
    return NextResponse.json({ error: "No Telegram linked" }, { status: 400 });
  }

  const eligibleTiers = ["SPECTER", "WRAITH"];
  if (!eligibleTiers.includes(user.tier)) {
    return NextResponse.json({ error: "Tier not eligible" }, { status: 403 });
  }

  const fmtMcap = (n: number) => {
    if (!n) return "—";
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  };

  const xStr = xNow >= 10 ? `${xNow.toFixed(1)}x` : `${xNow.toFixed(2)}x`;
  const ageMin = Math.floor(ageMs / 60_000);

  let msg = `☠️ <b>STALE / NO PROGRESS — $${symbol.toUpperCase()}</b>\n\n`;
  msg += `📉 Entry: <b>${fmtMcap(initialMcap)}</b> → Now: <b>${fmtMcap(currentMcap)}</b> (<b>${xStr}</b>)\n`;
  msg += `⏱ Age: <b>${ageMin}m</b> with no meaningful move\n`;
  if (contractAddress) {
    msg += `\n<a href="https://dexscreener.com/solana/${contractAddress}">View on DexScreener ↗</a>`;
  }

  await send(user.telegramChatId, msg);

  return NextResponse.json({ ok: true });
}
