import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/mongoClient";

const fmt = (n: number) => {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const scoreBar = (score: number) => {
  const filled = Math.round(score / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
};

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
) {
  return fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
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

async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption: string,
) {
  return fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
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
    `✅ <b>WRAITH WIN — $${body.symbol}</b>`,
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

// ─── Broadcast to all eligible users ─────────────────────────────────────────
async function broadcastToEligibleUsers(
  botToken: string,
  text: string,
  imageUrl?: string,
) {
  const db = await getDb();

  // Only send to users who:
  // 1. Have linked their Telegram (telegramChatId exists)
  // 2. Are SPECTER or WRAITH tier
  const users = await db
    .collection("users")
    .find(
      {
        telegramChatId: { $exists: true, $ne: null },
        tier: { $in: ["SPECTER", "WRAITH"] },
      },
      { projection: { telegramChatId: 1 } },
    )
    .toArray();

  if (users.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  // Send to each user — fire in parallel but don't let one failure block others
  await Promise.allSettled(
    users.map(async (user) => {
      const chatId = user.telegramChatId as string;
      try {
        const res = imageUrl
          ? await sendTelegramPhoto(botToken, chatId, imageUrl, text)
          : await sendTelegramMessage(botToken, chatId, text);

        if (res.ok) {
          sent++;
        } else {
          // If photo fails, fall back to text
          if (imageUrl) {
            const fallback = await sendTelegramMessage(botToken, chatId, text);
            if (fallback.ok) {
              sent++;
            } else {
              failed++;
            }
          } else {
            failed++;
          }
        }
      } catch {
        failed++;
      }
    }),
  );

  return { sent, failed };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken)
    return NextResponse.json(
      { error: "Telegram not configured" },
      { status: 503 },
    );

  const body = await req.json();

  // _ping — used by WinsPanel to check if Telegram is configured
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
    const { sent, failed } = await broadcastToEligibleUsers(
      botToken,
      text,
      body.imageUrl,
    );
    console.log(`[telegram] broadcast: ${sent} sent, ${failed} failed`);
    return NextResponse.json({ ok: true, sent, failed });
  } catch (err) {
    console.error("[telegram] broadcast error:", err);
    return NextResponse.json({ error: "Broadcast failed" }, { status: 500 });
  }
}
