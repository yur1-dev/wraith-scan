import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";

import { chainName, esc, footer, fmtUsd, header, rule, scoreBar, tokenKeyboard } from "@/lib/telegramUi";
import { broadcast, claim, milestoneFor, signalMessage } from "@/lib/telegramBot";
import type { Signal } from "@/app/api/signals/route";


function buildEntryMessage(body: {
  symbol: string; name?: string; chain?: string; mcap: number; holders?: number; contractAddress?: string;
  celebMention?: string; aiContext?: string; platforms?: string[]; twoXTier?: string; seenAt: number;
  aiScore?: number; aiTier?: "HOT" | "WATCH" | "SKIP"; aiReason?: string; peakMcap?: number; dexPaid?: boolean;
}): string {
  const hot = body.aiTier === "HOT";
  const plat = body.platforms?.length ? body.platforms.map((p) => p.toUpperCase()).join(" · ") : chainName(body.chain);
  const lines: string[] = [
    header(hot ? "🟢" : "🟡", hot ? "HOT SIGNAL" : "WATCH SIGNAL", body.symbol, body.chain, body.name),
    `💰 <b>MCap</b>  ${fmtUsd(body.mcap)}${body.holders ? `   ·   🧑‍🤝‍🧑 <b>Holders</b>  ${body.holders}` : ""}`,
  ];
  if (body.aiScore !== undefined) lines.push(`📈 <b>Score</b>  ${body.aiScore}/100  <code>${scoreBar(body.aiScore)}</code>`);
  if (body.twoXTier) lines.push(`${body.twoXTier === "ULTRA" || body.twoXTier === "HIGH" ? "🔥" : "👁"} <b>Tier</b>  ${esc(body.twoXTier)}${body.dexPaid ? "   ·   ✅ Dex paid" : ""}`);
  else if (body.dexPaid) lines.push(`✅ <b>Dex paid</b>`);
  if (body.celebMention) lines.push(`⭐ ${esc(body.celebMention)}`);
  if (body.aiContext || body.aiReason) {
    lines.push(rule);
    if (body.aiContext) lines.push(`🧠 ${esc(body.aiContext)}`);
    if (body.aiReason) lines.push(`💡 <i>${esc(body.aiReason)}</i>`);
  }
  lines.push(rule, `📡 ${esc(plat)}`);
  if (body.contractAddress) lines.push(`<code>${body.contractAddress}</code>`);
  lines.push("", footer);
  return lines.join("\n");
}

function buildWinMessage(body: {
  symbol: string; name?: string; chain?: string; initialMcap: number; currentMcap: number; xNow: number;
  peakMcap?: number; peakX?: number; holders?: number; contractAddress?: string; celebMention?: string;
  platforms?: string[]; seenAt: number; aiScore?: number; aiContext?: string; dexPaid?: boolean;
}): string {
  const xStr = body.xNow >= 10 ? `${body.xNow.toFixed(1)}x` : `${body.xNow.toFixed(2)}x`;
  const at = new Date(body.seenAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" });
  const lines: string[] = [
    header("✅", "WRAITH WIN", body.symbol, body.chain, body.name),
    `🚀 <b>${xStr}</b> from spotted price`,
    `📍 <b>Spotted</b>  ${fmtUsd(body.initialMcap)}  <i>at ${at}</i>`,
    `📊 <b>Now</b>  ${fmtUsd(body.currentMcap)}`,
  ];
  if (body.peakX && body.peakX > body.xNow) lines.push(`🏔 <b>Peak</b>  ${body.peakX.toFixed(2)}x`);
  if (body.aiScore !== undefined) lines.push(`📈 <b>Score at spot</b>  ${body.aiScore}/100  <code>${scoreBar(body.aiScore)}</code>`);
  if (body.contractAddress) lines.push(rule, `<code>${body.contractAddress}</code>`);
  lines.push("", footer);
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.TELEGRAM_BOT_TOKEN) return NextResponse.json({ error: "Telegram not configured" }, { status: 503 });

  const body = await req.json();
  if (body._ping) return NextResponse.json({ ok: true });

  const ca: string | undefined = body.contractAddress;
  const chain: string = body.chain ?? "solana";
  const markup = ca ? tokenKeyboard(ca, chain) : undefined;

  try {
    if (body.type === "entry") {
      // de-dupe with the server cron: whoever fires first sends, the other is a no-op
      if (ca && !(await claim(`entry:${ca}`))) return NextResponse.json({ ok: true, deduped: true });
      // prefer the full scanner detail when this token is in the live feed
      let sig: Signal | undefined;
      try {
        const r = await fetch(`${req.nextUrl.origin}/api/signals`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (r.ok) sig = ((await r.json()) as { signals?: Signal[] }).signals?.find((x) => x.token.address === ca);
      } catch { /* fall back to the client payload */ }
      const text = sig
        ? signalMessage(sig)
        : buildEntryMessage({ symbol: body.symbol, name: body.name, chain, mcap: body.mcap ?? 0, holders: body.holders, contractAddress: ca, celebMention: body.celebMention, aiContext: body.aiContext, platforms: body.platforms, twoXTier: body.twoXTier, seenAt: body.seenAt ?? Date.now(), aiScore: body.aiScore, aiTier: body.aiTier, aiReason: body.aiReason, dexPaid: body.dexPaid });
      const r = await broadcast("signal", text, { chain, score: sig?.score ?? body.aiScore ?? 100, markup, imageUrl: body.imageUrl ?? sig?.token.imageUrl });
      return NextResponse.json({ ok: true, ...r });
    }
    const m = milestoneFor(body.xNow ?? 0) || 2;
    if (ca && !(await claim(`win:${ca}:${m}`))) return NextResponse.json({ ok: true, deduped: true });
    const text = buildWinMessage({ symbol: body.symbol, name: body.name, chain, initialMcap: body.initialMcap ?? 0, currentMcap: body.currentMcap ?? 0, xNow: body.xNow ?? 0, peakMcap: body.peakMcap, peakX: body.peakX, holders: body.holders, contractAddress: ca, celebMention: body.celebMention, platforms: body.platforms, seenAt: body.seenAt ?? Date.now(), aiScore: body.aiScore, aiContext: body.aiContext, dexPaid: body.dexPaid });
    const r = await broadcast("win", text, { chain, markup });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("[telegram] broadcast error:", err);
    return NextResponse.json({ error: "Broadcast failed" }, { status: 500 });
  }
}
