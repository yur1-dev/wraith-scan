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

// ─── Score bar helper (e.g. ██████░░░░ 67/100) ────────────────────────────────
const scoreBar = (score: number) => {
  const filled = Math.round(score / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
};

// ─── Send a plain text message ────────────────────────────────────────────────
async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
) {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

// ─── Send a photo with caption ────────────────────────────────────────────────
async function sendTelegramPhoto(
  token: string,
  chatId: string,
  photoUrl: string,
  caption: string,
) {
  return fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: "HTML",
    }),
  });
}

// ─── Entry message — WRAITH SIGNALS style ────────────────────────────────────
function buildEntryMessage(body: {
  symbol: string;
  name?: string;
  mcap: number;
  holders?: number;
  contractAddress?: string;
  celebMention?: string;
  aiContext?: string;
  platforms?: string[];
  twoXTier?: string;
  seenAt: number;
  aiScore?: number;
  aiTier?: "HOT" | "WATCH" | "SKIP";
  aiReason?: string;
  peakMcap?: number;
  dexPaid?: boolean;
}): string {
  const statusDot = body.aiTier === "HOT" ? "🟢" : "🟡";
  const statusLabel = body.aiTier === "HOT" ? "HOT SIGNAL" : "WATCH SIGNAL";
  const tierEmoji =
    body.twoXTier === "ULTRA" || body.twoXTier === "HIGH" ? "🔥" : "👁";

  const platStr = body.platforms?.length
    ? body.platforms.map((p) => p.toUpperCase()).join(" · ")
    : "PUMPFUN";

  const lines: string[] = [
    `${statusDot} <b>${statusLabel} — ${body.name ?? body.symbol} — $${body.symbol}</b>`,
    ``,
    body.mcap ? `💰 <b>MCAP:</b> ${fmt(body.mcap)}` : "",
    body.holders ? `🧑‍🤝‍🧑 <b>Holders:</b> ${body.holders}` : "",
    ``,
    `🏁 <b>First Call:</b> ${fmt(body.mcap)} (just now)`,
    body.aiScore !== undefined ? `📈 <b>AI Score:</b> ${body.aiScore}/100` : "",
    body.twoXTier ? `${tierEmoji} <b>Signal Tier:</b> ${body.twoXTier}` : "",
    body.dexPaid ? `✅ <b>Dex Paid</b>` : "",
    body.celebMention ? `⭐ <b>Signal:</b> ${body.celebMention}` : "",
    ``,
  ];

  if (body.aiContext) {
    lines.push(`🧠 <b>LORE</b>`);
    lines.push(body.aiContext);
    lines.push(``);
  }

  if (body.aiReason) {
    lines.push(`💡 ${body.aiReason}`);
    lines.push(``);
  }

  lines.push(`📡 <b>Sources:</b> ${platStr}`);
  lines.push(``);

  if (body.contractAddress) {
    const ca = body.contractAddress;
    lines.push(
      `🔗 <a href="https://dexscreener.com/solana/${ca}">DexScreener</a> • ` +
        `<a href="https://pump.fun/${ca}">Pump</a> • ` +
        `<a href="https://jup.ag/swap/SOL-${ca}">Swap</a> • ` +
        `<a href="https://birdeye.so/token/${ca}?chain=solana">BullX</a> • ` +
        `<a href="https://solscan.io/token/${ca}">Solscan</a>`,
    );
    lines.push(``);
    lines.push(`<code>${ca}</code>`);
  }

  return lines.filter((l) => l !== "").join("\n");
}

// ─── Win message — WRAITH SIGNALS style ──────────────────────────────────────
function buildWinMessage(body: {
  symbol: string;
  name?: string;
  initialMcap: number;
  currentMcap: number;
  xNow: number;
  peakMcap?: number;
  peakX?: number;
  holders?: number;
  contractAddress?: string;
  celebMention?: string;
  platforms?: string[];
  seenAt: number;
  aiScore?: number;
  aiContext?: string;
  dexPaid?: boolean;
}): string {
  const xStr =
    body.xNow >= 10 ? `${body.xNow.toFixed(1)}x` : `${body.xNow.toFixed(2)}x`;

  const spottedTime = new Date(body.seenAt).toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });

  const platStr = body.platforms?.length
    ? body.platforms.map((p) => p.toUpperCase()).join(" · ")
    : "PUMPFUN";

  const lines: string[] = [
    `✅ <b>WRAITH WIN — $$${body.symbol}</b>`,
    `📊 ${xStr} from spotted price`,
    `Spotted:  ${fmt(body.initialMcap)} at ${spottedTime}`,
    `Now:      ${fmt(body.currentMcap)}`,
    body.aiScore !== undefined
      ? `AI Score: ${scoreBar(body.aiScore)} ${body.aiScore}/100 (at spot)`
      : "",
    `Sources:  ${platStr}`,
    ``,
  ];

  if (body.contractAddress) {
    const ca = body.contractAddress;
    lines.push(`DEX:\nhttps://dexscreener.com/solana/${ca}`);
    lines.push(`\nPUMP:\nhttps://pump.fun/${ca}`);
    lines.push(`\nSWAP:\nhttps://jup.ag/swap/SOL-${ca}`);
  }

  return lines.filter((l) => l !== undefined).join("\n");
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
          name: body.name,
          mcap: body.mcap ?? 0,
          holders: body.holders,
          contractAddress: body.contractAddress,
          celebMention: body.celebMention,
          aiContext: body.aiContext,
          platforms: body.platforms,
          twoXTier: body.twoXTier,
          seenAt: body.seenAt ?? Date.now(),
          aiScore: body.aiScore,
          aiTier: body.aiTier,
          aiReason: body.aiReason,
          dexPaid: body.dexPaid,
        })
      : buildWinMessage({
          symbol: body.symbol,
          name: body.name,
          initialMcap: body.initialMcap ?? 0,
          currentMcap: body.currentMcap ?? 0,
          xNow: body.xNow ?? 0,
          peakMcap: body.peakMcap,
          peakX: body.peakX,
          holders: body.holders,
          contractAddress: body.contractAddress,
          celebMention: body.celebMention,
          platforms: body.platforms,
          seenAt: body.seenAt ?? Date.now(),
          aiScore: body.aiScore,
          aiContext: body.aiContext,
          dexPaid: body.dexPaid,
        });

  try {
    // If there's a token image URL, send as photo with caption; otherwise plain message
    const imageUrl: string | undefined = body.imageUrl;

    const tgRes = imageUrl
      ? await sendTelegramPhoto(token, chatId, imageUrl, text)
      : await sendTelegramMessage(token, chatId, text);

    if (!tgRes.ok) {
      const err = await tgRes.text();
      console.error("[telegram] send failed:", err);

      // If photo send fails (bad URL etc), fall back to plain message
      if (imageUrl) {
        const fallback = await sendTelegramMessage(token, chatId, text);
        if (!fallback.ok) {
          return NextResponse.json(
            { error: "Telegram API error" },
            { status: 502 },
          );
        }
        return NextResponse.json({ ok: true, fallback: true });
      }

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
