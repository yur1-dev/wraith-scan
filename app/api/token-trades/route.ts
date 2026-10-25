// app/api/token-trades/route.ts
// Recent swaps for a token (last ~50 on its deepest pool) from GeckoTerminal.
// Feeds the "Swaps" tab + live trade tape on the token page.

import { NextRequest, NextResponse } from "next/server";
import { SOLANA_MINT_RE } from "@/lib/market";
import { arr, GECKO, GECKO_HEADERS, getJson, getSolUsd, num, obj, resolvePool } from "@/lib/marketProviders";
import { getSandboxToken } from "@/lib/devnetTokens";
import { getDb } from "@/lib/mongoClient";

export interface ApiTrade {
  id: string;
  ts: number; // ms
  side: "buy" | "sell";
  usd: number;
  tokens: number;
  priceUsd: number;
  wallet: string;
  tx: string;
}

const CACHE_MS = 25_000;
const cache = new Map<string, { trades: ApiTrade[]; ts: number }>();
const inflight = new Map<string, Promise<ApiTrade[] | null>>();

async function load(mint: string): Promise<ApiTrade[] | null> {
  const pool = await resolvePool(mint);
  if (!pool) return null;
  try {
    const payload = obj(await getJson(`${GECKO}/pools/${pool}/trades`, GECKO_HEADERS, 8000));
    const out: ApiTrade[] = [];
    for (const row of arr(payload.data).map(obj)) {
      const a = obj(row.attributes);
      const side = a.kind === "sell" ? "sell" : a.kind === "buy" ? "buy" : null;
      if (!side) continue;
      const ts = Date.parse(String(a.block_timestamp ?? ""));
      if (!Number.isFinite(ts)) continue;
      const tokens = num(side === "buy" ? a.to_token_amount : a.from_token_amount);
      const priceUsd = num(side === "buy" ? a.price_to_in_usd : a.price_from_in_usd);
      out.push({
        id: String(row.id ?? `${a.tx_hash}-${ts}`),
        ts,
        side,
        usd: num(a.volume_in_usd),
        tokens,
        priceUsd,
        wallet: String(a.tx_from_address ?? ""),
        tx: String(a.tx_hash ?? ""),
      });
    }
    return out.sort((a, b) => b.ts - a.ts).slice(0, 60);
  } catch (e) {
    console.warn("[token-trades]", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  if (!SOLANA_MINT_RE.test(mint)) {
    return NextResponse.json({ trades: [], error: "Invalid Solana mint" }, { status: 400 });
  }
  const sandboxTok = await getSandboxToken(mint);
  if (sandboxTok) {
    const solUsd = await getSolUsd();
    const docs = await (await getDb()).collection("devnet_trades").find({ mint, tokens: { $exists: true } }).sort({ at: -1 }).limit(60).toArray();
    const trades: ApiTrade[] = docs.map((d) => ({
      id: String(d._id),
      ts: Number(d.at),
      side: d.side === "sell" ? "sell" : "buy",
      usd: Number(d.sol) * solUsd,
      tokens: Number(d.tokens),
      priceUsd: sandboxTok.priceSol * solUsd,
      wallet: String(d.wallet ?? ""),
      tx: String(d._id),
    }));
    return NextResponse.json({ trades });
  }

  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < CACHE_MS) return NextResponse.json({ trades: hit.trades });

  let job = inflight.get(mint);
  if (!job) {
    job = load(mint).finally(() => inflight.delete(mint));
    inflight.set(mint, job);
  }
  const trades = await job;
  if (trades) {
    cache.set(mint, { trades, ts: Date.now() });
    return NextResponse.json({ trades });
  }
  if (hit) return NextResponse.json({ trades: hit.trades, stale: true });
  return NextResponse.json({ trades: [] });
}
