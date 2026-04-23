import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// ─── POST /api/alert/telegram ─────────────────────────────────────────────────
// Handles two alert types:
//
//   type: "entry" — fired by recordTokenSighting the moment scanner spots a token.
//                   This is the BUY SIGNAL. Token has NOT 2x'd yet.
//                   Includes AI score (0-100) and HOT/WATCH tier.
//
//   type: "win"   — fired by WinsPanel when a token hits 2x AFTER being spotted.
//                   This is the WIN NOTIFICATION.

const fmt = (n: number) => {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });

// ─── Score bar visual — shows how strong the signal is ───────────────────────
// e.g. score 82 → "████████░░ 82/100"
function scoreBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return `${"█".repeat(filled)}${"░".repeat(empty)} ${score}/100`;
}

function buildEntryMessage(body: {
  symbol: string;
  mcap: number;
  contractAddress?: string;
  celebMention?: string;
  aiContext?: string;
  platforms?: string[];
  twoXTier?: string;
  seenAt: number;
  aiScore?: number;
  aiTier?: "HOT" | "WATCH" | "SKIP";
  aiReason?: string;
}): string {
  const score = body.aiScore ?? 50;
  const aiTier = body.aiTier ?? "WATCH";

  // Header varies by AI tier
  const headerEmoji =
    aiTier === "HOT" ? "🔥🔥🔥 HOT SIGNAL" : "👁 WATCH SIGNAL";

  const tierEmoji =
    body.twoXTier === "ULTRA"
      ? "ULTRA 🔥🔥🔥"
      : body.twoXTier === "HIGH"
        ? "HIGH 🔥🔥"
        : "MEDIUM 🔥";

  const platStr = body.platforms?.length
    ? body.platforms.map((p) => p.toUpperCase()).join(" · ")
    : "";

  // Score bar line
  const scoreLine = `AI Score: ${scoreBar(score)}${body.aiReason ? `\n          ${body.aiReason}` : ""}`;

  // HOT signals get a more urgent header
  const urgencyLine =
    aiTier === "HOT"
      ? "⚡ HIGH CONFIDENCE — act fast, similar tokens pumped hard"
      : "⚡ BUY SIGNAL — monitor closely";

  return [
    `${headerEmoji} — $${body.symbol}`,
    ``,
    urgencyLine,
    ``,
    scoreLine,
    ``,
    `MCap:     ${fmt(body.mcap)}`,
    `Scanner:  ${tierEmoji}`,
    `Time:     ${fmtTime(body.seenAt)}`,
    body.celebMention ? `Signal:   ⭐ ${body.celebMention}` : "",
    platStr ? `Sources:  ${platStr}` : "",
    body.aiContext ? `Context:  ${body.aiContext.slice(0, 100)}` : "",
    ``,
    body.contractAddress
      ? `DEX:  https://dexscreener.com/solana/${body.contractAddress}`
      : "",
    body.contractAddress
      ? `PUMP: https://pump.fun/${body.contractAddress}`
      : "",
    body.contractAddress
      ? `SWAP: https://jup.ag/swap/SOL-${body.contractAddress}`
      : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function buildWinMessage(body: {
  symbol: string;
  initialMcap: number;
  currentMcap: number;
  xNow: number;
  contractAddress?: string;
  celebMention?: string;
  platforms?: string[];
  seenAt: number;
  aiScore?: number;
}): string {
  const xStr =
    body.xNow >= 10 ? `${body.xNow.toFixed(1)}x` : `${body.xNow.toFixed(2)}x`;
  const platStr = body.platforms?.length
    ? body.platforms.map((p) => p.toUpperCase()).join(" · ")
    : "";

  const scoreLine =
    typeof body.aiScore === "number"
      ? `AI Score: ${scoreBar(body.aiScore)} (at spot)`
      : "";

  return [
    `✅ WRAITH WIN — $${body.symbol}`,
    ``,
    `📈 ${xStr} from spotted price`,
    ``,
    `Spotted:  ${fmt(body.initialMcap)} at ${fmtTime(body.seenAt)}`,
    `Now:      ${fmt(body.currentMcap)}`,
    scoreLine,
    body.celebMention ? `Signal:   ⭐ ${body.celebMention}` : "",
    platStr ? `Sources:  ${platStr}` : "",
    ``,
    body.contractAddress
      ? `DEX:  https://dexscreener.com/solana/${body.contractAddress}`
      : "",
    body.contractAddress
      ? `PUMP: https://pump.fun/${body.contractAddress}`
      : "",
    body.contractAddress
      ? `SWAP: https://jup.ag/swap/SOL-${body.contractAddress}`
      : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId)
    return NextResponse.json(
      { error: "Telegram not configured" },
      { status: 503 },
    );

  const body = await req.json();

  // _ping — just used by WinsPanel to check if Telegram is configured
  if (body._ping) return NextResponse.json({ ok: true });

  const alertType: "entry" | "win" = body.type === "entry" ? "entry" : "win";

  const text =
    alertType === "entry"
      ? buildEntryMessage({
          symbol: body.symbol,
          mcap: body.mcap ?? 0,
          contractAddress: body.contractAddress,
          celebMention: body.celebMention,
          aiContext: body.aiContext,
          platforms: body.platforms,
          twoXTier: body.twoXTier,
          seenAt: body.seenAt ?? Date.now(),
          aiScore: body.aiScore,
          aiTier: body.aiTier,
          aiReason: body.aiReason,
        })
      : buildWinMessage({
          symbol: body.symbol,
          initialMcap: body.initialMcap ?? 0,
          currentMcap: body.currentMcap ?? 0,
          xNow: body.xNow ?? 0,
          contractAddress: body.contractAddress,
          celebMention: body.celebMention,
          platforms: body.platforms,
          seenAt: body.seenAt ?? Date.now(),
          aiScore: body.aiScore,
        });

  try {
    const tgRes = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      },
    );

    if (!tgRes.ok) {
      const err = await tgRes.text();
      console.error("[telegram] send failed:", err);
      return NextResponse.json(
        { error: "Telegram API error" },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[telegram] fetch error:", err);
    return NextResponse.json({ error: "Network error" }, { status: 500 });
  }
}
