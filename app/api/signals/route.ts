// app/api/signals/route.ts
// Fast, AI-free signal feed. Reads the shared /api/market cache (one upstream
// fetch for every viewer), then scores each token on momentum, volume
// pressure, buy/sell balance, liquidity health and freshness.
// No Gemini / Twitter / Rugcheck calls: this is cheap enough to poll.

import { NextRequest, NextResponse } from "next/server";
import type { MarketCategory, MarketToken } from "@/lib/market";
import { recordSignals, refreshCalls } from "@/lib/signalCalls";
import { getSolUsd, IGNORED_MINTS, IGNORED_SYMBOLS } from "@/lib/marketProviders";
import { evmCandidates } from "@/lib/evmScan";
import { dexCandidates, jupiterCandidates, jupiterEnrich, type Candidate, type ScanMeta } from "@/lib/scannerSources";

export type SignalTier = "HOT" | "WATCH";
export interface Signal {
  token: MarketToken;
  score: number;
  tier: SignalTier;
  tags: string[];
  risks: string[];
  meta?: ScanMeta;
}

const CACHE_MS = 30_000;
let cache: { ts: number; signals: Signal[] } | null = null;
let inflight: Promise<Signal[]> | null = null;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));

/**
 * Score 0-100 across seven pillars: volume pressure, buy pressure, momentum,
 * liquidity health, freshness, token quality (holders / organic / authorities)
 * and manipulation checks. Hard gates drop dust, mega-caps and unsellable pools.
 */
function scoreToken(t: MarketToken, meta: ScanMeta, now: number): Signal | null {
  if (!(t.priceUsd > 0) || !(t.mcap > 0)) return null;
  if (IGNORED_MINTS.has(t.address) || IGNORED_SYMBOLS.has(t.symbol.toUpperCase())) return null;
  const liq = t.liquidity || 0;
  if (!t.onCurve && liq < 3_000) return null;
  if (t.mcap < 5_000 || t.mcap > 50_000_000) return null;

  const good: string[] = [];
  const risks: string[] = [];
  let score = 0;

  // 1. volume pressure (1h volume vs market cap)
  const volRatio = t.volume.h1 / t.mcap;
  score += clamp(volRatio * 180, 0, 22);
  if (volRatio >= 0.08) good.push("Volume surge");

  // 2. buy pressure: real buy/sell volume when we have it, else txn counts
  let buyShare: number | null = null;
  if (meta.buyVol1h !== undefined && meta.sellVol1h !== undefined && meta.buyVol1h + meta.sellVol1h > 0) {
    buyShare = meta.buyVol1h / (meta.buyVol1h + meta.sellVol1h);
  } else if (t.txns.buys + t.txns.sells >= 40) {
    buyShare = t.txns.buys / (t.txns.buys + t.txns.sells);
  }
  if (buyShare !== null) {
    score += clamp((buyShare - 0.5) * 56, 0, 14);
    if (buyShare >= 0.55) good.push("Buy pressure");
    if (buyShare < 0.42) risks.push("Sell heavy");
  }

  // 3. momentum
  const h1 = t.change.h1 ?? 0;
  const m5 = t.change.m5 ?? 0;
  const h6 = t.change.h6 ?? 0;
  const h24 = t.change.h24 ?? 0;
  if (h1 > 2) score += clamp(h1 / 4, 0, 16);
  if (m5 > 0) score += 4;
  if (h1 > 0 && h6 > 10) { score += 3; good.push("Sustained"); }
  if (h1 > 300) { score -= 15; risks.push("Already pumped"); }
  if (h24 < -50) { score -= 20; risks.push("Down hard 24h"); }
  else if (h1 < -10) { score -= 10; risks.push("Dumping"); }
  if (h1 >= 15 && m5 > 0) good.push("Trending up");

  // 4. liquidity health
  const liqRatio = liq / t.mcap;
  if (liq >= 20_000) { score += 5; good.push("Strong liquidity"); }
  if (liqRatio >= 0.05 && liqRatio <= 0.6) score += 10;
  else if (!t.onCurve) risks.push(liqRatio < 0.05 ? "Thin liquidity" : "Liquidity-heavy");

  // 5. freshness
  if (t.createdAt) {
    const ageH = (now - t.createdAt) / 3_600_000;
    if (ageH <= 6) { score += 10; good.push("Fresh"); }
    else if (ageH <= 24) { score += 7; good.push("New today"); }
    else if (ageH <= 72) score += 3;
    else if (ageH > 24 * 14) score -= 8;
  }
  if (t.graduated) { score += 5; good.push("Graduated"); }
  if (t.onCurve && (t.curveProgress ?? 0) > 0.6) { score += 5; good.push(`Curve ${Math.round((t.curveProgress ?? 0) * 100)}%`); }

  // 6. quality (Jupiter data): holders, organic activity, authorities, concentration
  if (meta.organicScore !== undefined) {
    if (meta.organicScore >= 70) { score += 8; good.push(`Organic ${Math.round(meta.organicScore)}`); }
    else if (meta.organicScore >= 40) score += 4;
    else if (meta.organicScore < 20) { score -= 6; risks.push("Low organic"); }
  }
  if (meta.holders !== undefined) {
    if (meta.holders >= 1000) { score += 6; good.push(`${compact(meta.holders)} holders`); }
    else if (meta.holders >= 300) score += 3;
    else if (meta.holders < 60) { score -= 5; risks.push("Few holders"); }
  }
  if (meta.mintRevoked === true && meta.freezeRevoked === true) { score += 5; good.push("Authorities revoked"); }
  if (meta.mintRevoked === false) { score -= 15; risks.push("Mint authority"); }
  if (meta.freezeRevoked === false) { score -= 15; risks.push("Freeze authority"); }
  if (meta.topHoldersPct !== undefined && meta.topHoldersPct > 50) { score -= 10; risks.push(`Top holders ${Math.round(meta.topHoldersPct)}%`); }
  if (meta.devPct !== undefined && meta.devPct > 15) { score -= 6; risks.push(`Dev holds ${Math.round(meta.devPct)}%`); }

  // 7. manipulation: huge volume from very few wallets
  if (meta.traders1h !== undefined && meta.traders1h < 15 && volRatio > 1.5) { score -= 15; risks.push("Wash volume"); }

  score = Math.round(clamp(score, 0, 100));
  if (score < 22) return null;
  return {
    token: t,
    score,
    tier: score >= 70 ? "HOT" : "WATCH",
    tags: good.slice(0, 5),
    risks: risks.slice(0, 3),
    meta: Object.keys(meta).length ? meta : undefined,
  };
}

async function build(origin: string): Promise<Signal[]> {
  const solUsd = await getSolUsd();
  const cats: MarketCategory[] = ["trending", "new", "gainers", "volume"];

  const [market, jup, dex, evm] = await Promise.all([
    Promise.allSettled(
      cats.map(async (c) => {
        const res = await fetch(`${origin}/api/market?category=${c}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(String(res.status));
        const data: { tokens?: MarketToken[] } = await res.json();
        return data.tokens ?? [];
      }),
    ),
    jupiterCandidates(solUsd).catch(() => [] as Candidate[]),
    dexCandidates(solUsd).catch(() => [] as MarketToken[]),
    evmCandidates().catch(() => [] as Candidate[]),
  ]);

  const byAddr = new Map<string, Candidate>();
  // Market feed (Gecko) first: best txn/age data.
  for (const r of market) {
    if (r.status !== "fulfilled") continue;
    for (const t of r.value) if (!byAddr.has(t.address)) byAddr.set(t.address, { token: t, meta: {} });
  }
  // Jupiter: add new mints, attach quality meta to existing ones.
  for (const c of jup) {
    const have = byAddr.get(c.token.address);
    if (!have) byAddr.set(c.token.address, c);
    else {
      have.meta = { ...c.meta, ...have.meta };
      if (!have.token.imageUrl) have.token.imageUrl = c.token.imageUrl;
      if (!have.token.createdAt) have.token.createdAt = c.token.createdAt;
    }
  }
  // DexScreener: fill gaps.
  for (const t of dex) {
    const have = byAddr.get(t.address);
    if (!have) byAddr.set(t.address, { token: t, meta: {} });
    else if (!have.token.imageUrl && t.imageUrl) have.token.imageUrl = t.imageUrl;
  }
  // Every other supported chain (Base, Ethereum, BNB, Monad, Arc, Robinhood).
  for (const c of evm) if (!byAddr.has(c.token.address)) byAddr.set(c.token.address, c);
  if (!byAddr.size) throw new Error("no candidates from any source");

  // One batched Jupiter lookup for anything still missing quality data.
  const missing = [...byAddr.values()].filter((c) => c.meta.holders === undefined && (!c.token.chain || c.token.chain === "solana")).map((c) => c.token.address).slice(0, 100);
  if (missing.length) {
    const extra = await jupiterEnrich(missing, solUsd);
    for (const [addr, m] of extra) {
      const c = byAddr.get(addr);
      if (c) c.meta = { ...m, ...c.meta };
    }
  }

  const now = Date.now();
  const scored: Signal[] = [];
  for (const c of byAddr.values()) {
    const s = scoreToken(c.token, c.meta, now);
    if (s) scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score);
  // Keep the quality bar (>=35) but never leave the feed near-empty.
  const strong = scored.filter((s) => s.score >= 35);
  const pool = strong.length >= 15 ? strong : scored;
  // Top 80 overall, but every chain keeps a seat: guarantee its best 8 are included.
  const top = pool.slice(0, 80);
  const seen = new Set(top.map((s) => s.token.address));
  const perChain = new Map<string, number>();
  for (const s of top) perChain.set(s.token.chain ?? "solana", (perChain.get(s.token.chain ?? "solana") ?? 0) + 1);
  for (const s of scored) {
    const k = s.token.chain ?? "solana";
    if (seen.has(s.token.address) || (perChain.get(k) ?? 0) >= 8) continue;
    top.push(s); seen.add(s.token.address); perChain.set(k, (perChain.get(k) ?? 0) + 1);
  }
  return top.sort((a, b) => b.score - a.score);
}

export async function GET(req: NextRequest) {
  if (cache && Date.now() - cache.ts < CACHE_MS) {
    return NextResponse.json({ signals: cache.signals, updatedAt: cache.ts });
  }
  if (!inflight) {
    inflight = build(req.nextUrl.origin).finally(() => { inflight = null; });
  }
  try {
    const signals = await inflight;
    if (signals.length) cache = { ts: Date.now(), signals };
    else if (!cache) throw new Error("scored zero candidates");
    // Persist new calls and refresh tracked prices for everyone (awaited so serverless does not drop it).
    await recordSignals(signals).catch(() => undefined);
    await refreshCalls().catch(() => undefined);
    return NextResponse.json({ signals: cache.signals, updatedAt: cache.ts });
  } catch {
    if (cache) return NextResponse.json({ signals: cache.signals, updatedAt: cache.ts, stale: true });
    return NextResponse.json({ signals: [], error: "Signal sources unreachable" }, { status: 502 });
  }
}
