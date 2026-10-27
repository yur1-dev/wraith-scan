// GET /api/landing → public, read-only proof data for the marketing site. 30s cache.
// Only already-played history is exposed (tracked calls, wins, the call record), never the live signals feed,
// so the tier-gated "live signals" stay gated. Telegram text comes from the bot's own builders, so the site
// shows exactly what users receive.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import type { SignalCall } from "@/lib/signalCalls";
import { milestoneFor, signalMessage, winMessage } from "@/lib/telegramBot";
import { tokenKeyboard } from "@/lib/telegramUi";
import type { Signal } from "@/app/api/signals/route";

let cache: { ts: number; body: unknown } | null = null;

const xOf = (c: SignalCall) => (c.spottedMcap > 0 ? c.peakMcap / c.spottedMcap : 0);

async function candlesFor(origin: string, c: SignalCall) {
  try {
    const chain = c.chain && c.chain !== "solana" ? c.chain : null;
    const url = chain
      ? `${origin}/api/evm-chart?address=${c.address}&chain=${chain}&tf=15m`
      : `${origin}/api/token-chart?address=${c.address}&tf=15m`;
    const mod = chain ? await import("@/app/api/evm-chart/route") : await import("@/app/api/token-chart/route");
    const res = await mod.GET(new NextRequest(url));
    const j = (await res.json()) as { candles?: { t: number; o: number; h: number; l: number; c: number; v?: number }[] };
    return (j.candles ?? []).slice(-90);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  if (cache && Date.now() - cache.ts < 30_000) return NextResponse.json(cache.body);
  const now = Date.now();
  let calls: SignalCall[] = [];
  try {
    const db = await getDb();
    calls = await db.collection<SignalCall>("signal_calls").find({ spottedAt: { $gt: now - 7 * 86_400_000 }, spottedMcap: { $gt: 0 }, shadow: { $ne: true }, engine: 2 }).toArray();
  } catch { /* db optional: site shows empty states */ }

  const hit2 = calls.filter((c) => xOf(c) >= 2).length;
  const stats = { calls: calls.length, hit2, rate: calls.length ? Math.round((hit2 / calls.length) * 100) : 0 };
  const slim = (c: SignalCall) => ({ address: c.address, chain: c.chain ?? "solana", symbol: c.symbol, imageUrl: c.imageUrl ?? null, tier: c.tier, score: c.score, spottedAt: c.spottedAt, spottedMcap: c.spottedMcap, peakMcap: c.peakMcap, lastMcap: c.lastMcap, x: Math.round(xOf(c) * 100) / 100 });

  const wins = calls.filter((c) => xOf(c) >= 1.5).sort((a, b) => xOf(b) - xOf(a)).slice(0, 8).map(slim);
  const recent = calls.filter((c) => c.spottedAt < now - 3_600_000).sort((a, b) => b.spottedAt - a.spottedAt).slice(0, 8).map(slim);

  // Real Telegram text (bot builders), for the top win and one older call that is still in the live list.
  const topWin = calls.filter((c) => xOf(c) >= 2).sort((a, b) => xOf(b) - xOf(a))[0];
  let signalHtml: string | null = null;
  let signalKb: unknown = null;
  try {
    const mod = await import("@/app/api/signals/route");
    const r = await mod.GET(new NextRequest(`${req.nextUrl.origin}/api/signals`));
    const sigs = ((await r.json()) as { signals?: Signal[] }).signals ?? [];
    const old = new Map(calls.filter((c) => c.spottedAt < now - 3_600_000).map((c) => [c.address, c]));
    const s = sigs.find((x) => old.has(x.token.address));
    if (s) { signalHtml = signalMessage(s); signalKb = tokenKeyboard(s.token.address, s.token.chain ?? "solana"); }
  } catch { /* optional */ }

  const win = topWin
    ? { html: winMessage(topWin, milestoneFor(topWin.lastMcap / topWin.spottedMcap) || 2), kb: tokenKeyboard(topWin.address, topWin.chain ?? "solana") }
    : null;

  const chartSrc = topWin ?? wins[0] ?? null;
  const chart = chartSrc ? { symbol: chartSrc.symbol, chain: chartSrc.chain ?? "solana", spottedAt: chartSrc.spottedAt, spottedMcap: chartSrc.spottedMcap, candles: await candlesFor(req.nextUrl.origin, chartSrc as SignalCall) } : null;

  const body = { updatedAt: now, stats, wins, recent, telegram: { signal: signalHtml ? { html: signalHtml, kb: signalKb } : null, win }, chart };
  cache = { ts: now, body };
  return NextResponse.json(body);
}
