// app/api/token-chart/route.ts
// OHLCV candles for one Solana token.
//
// What was wrong before (why charts "never loaded"):
//   * the browser aborted after 2.5s while this route waited up to 8s on
//     Birdeye + Gecko (and on-chain RPC walks that take minutes) -> empty chart
//   * every request re-resolved the pool through a separate Gecko call and
//     burned the free rate limit (30/min) -> 429 -> circuit breaker -> nothing
//   * candles had holes wherever nobody traded, so the chart looked broken
//
// Now:
//   1. pool resolved once per mint (DexScreener, Gecko fallback) and cached
//   2. GeckoTerminal OHLCV is the fast path; Birdeye races it as backup
//   3. on-chain pump.fun reconstruction only runs if both fail, and is capped
//   4. gaps are forward-filled and the series is extended to "now"
//   5. last good series is served (marked stale) if every provider fails

import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { fromPumpFunOnChain } from "@/lib/onchain-pumpfun";
import { SOLANA_MINT_RE } from "@/lib/market";
import {
  arr,
  GECKO,
  GECKO_HEADERS,
  getJson,
  getSolUsd,
  INC,
  num,
  obj,
  resolvePool,
} from "@/lib/marketProviders";
import { getSandboxToken, sandboxCandles } from "@/lib/devnetTokens";

interface Candle {
  t: number; // bucket start, ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // USD volume
}

interface Tf {
  geckoTf: "minute" | "hour" | "day";
  geckoAgg: number;
  birdeyeType: string;
  sec: number;
  limit: number;
}

const TF: Record<string, Tf> = {
  "1m": { geckoTf: "minute", geckoAgg: 1, birdeyeType: "1m", sec: 60, limit: 300 },
  "5m": { geckoTf: "minute", geckoAgg: 5, birdeyeType: "5m", sec: 300, limit: 300 },
  "15m": { geckoTf: "minute", geckoAgg: 15, birdeyeType: "15m", sec: 900, limit: 300 },
  "1h": { geckoTf: "hour", geckoAgg: 1, birdeyeType: "1H", sec: 3600, limit: 300 },
  "4h": { geckoTf: "hour", geckoAgg: 4, birdeyeType: "4H", sec: 14400, limit: 300 },
  "1d": { geckoTf: "day", geckoAgg: 1, birdeyeType: "1D", sec: 86400, limit: 300 },
};

const MAX_POINTS = 400;
const CACHE_MS = 20_000;
const STALE_MS = 30 * 60_000;
const ONCHAIN_BUDGET_MS = 12_000;

const cache = new Map<string, { candles: Candle[]; source: string; ts: number }>();
const lastGood = new Map<string, { candles: Candle[]; source: string; ts: number }>();
const inflight = new Map<string, Promise<{ candles: Candle[]; source: string } | null>>();

// ── circuit breaker (per provider) ──────────────────────────────────────
const downUntil: Record<string, number> = { gecko: 0, birdeye: 0 };
const isDown = (k: string) => Date.now() < (downUntil[k] ?? 0);
const markDown = (k: string, ms = 60_000) => {
  downUntil[k] = Date.now() + ms;
};

let _conn: Connection | null = null;
function connection(): Connection {
  if (!_conn) {
    const url =
      process.env.NEXT_PUBLIC_SOLANA_RPC ||
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
      "https://api.mainnet-beta.solana.com";
    _conn = new Connection(url, { disableRetryOnRateLimit: true });
  }
  return _conn;
}

// ── providers ───────────────────────────────────────────────────────────
async function fromGecko(mint: string, tf: Tf): Promise<Candle[] | null> {
  if (isDown("gecko")) return null;
  const pool = await resolvePool(mint);
  if (!pool) return null;
  try {
    const url =
      `${GECKO}/pools/${pool}/ohlcv/${tf.geckoTf}?aggregate=${tf.geckoAgg}` +
      `&limit=${tf.limit}&currency=usd&token=base&include_empty_intervals=false`;
    const payload = obj(await getJson(url, GECKO_HEADERS, 5000));
    const list = arr(obj(obj(payload.data).attributes).ohlcv_list);
    const candles: Candle[] = [];
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 6) continue;
      candles.push({ t: num(row[0]) * 1000, o: num(row[1]), h: num(row[2]), l: num(row[3]), c: num(row[4]), v: num(row[5]) });
    }
    return candles.length ? candles : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[token-chart] gecko ohlcv failed:", msg);
    if (msg.startsWith("429")) markDown("gecko", 45_000);
    return null;
  }
}

async function fromBirdeye(mint: string, tf: Tf): Promise<Candle[] | null> {
  const key = process.env.BIRDEYE_API_KEY;
  if (!key || isDown("birdeye")) return null;
  const now = Math.floor(Date.now() / 1000);
  const from = now - tf.sec * tf.limit;
  try {
    const payload = obj(
      await getJson(
        `https://public-api.birdeye.so/defi/ohlcv?address=${mint}&type=${tf.birdeyeType}&time_from=${from}&time_to=${now}`,
        { "X-API-KEY": key, "x-chain": "solana" },
        5000,
      ),
    );
    const items = arr(obj(payload.data).items).map(obj);
    const candles = items.map((i) => ({ t: num(i.unixTime) * 1000, o: num(i.o), h: num(i.h), l: num(i.l), c: num(i.c), v: num(i.v) * num(i.c) }));
    return candles.length ? candles : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[token-chart] birdeye failed:", msg);
    if (msg.startsWith("400") || msg.startsWith("401") || msg.startsWith("429")) markDown("birdeye", 5 * 60_000);
    return null;
  }
}

async function fromOnChain(mint: string, tf: Tf): Promise<Candle[] | null> {
  if (!mint.endsWith("pump")) return null; // on-chain reconstruction only understands pump.fun curves/pools
  const work = fromPumpFunOnChain(mint, { pumpIntervalSec: tf.sec }, connection(), getSolUsd).then((rows) =>
    rows ? rows.map((r) => ({ ...r, v: 0 })) : null,
  );
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ONCHAIN_BUDGET_MS));
  return Promise.race([work, timeout]).catch(() => null);
}

// ── cleaning ────────────────────────────────────────────────────────────
function clean(rows: Candle[], sec: number): Candle[] {
  const byT = new Map<number, Candle>();
  for (const r of rows) {
    if (![r.t, r.o, r.h, r.l, r.c].every(Number.isFinite) || r.o <= 0 || r.h <= 0 || r.l <= 0 || r.c <= 0) continue;
    const t = Math.floor(r.t / (sec * 1000)) * sec * 1000;
    const body = { hi: Math.max(r.o, r.c), lo: Math.min(r.o, r.c) };
    // A single bad print can make a wick 1000x the body and flatten the whole chart.
    const h = r.h > body.hi * 100 ? body.hi : Math.max(r.h, body.hi);
    const l = r.l < body.lo / 100 ? body.lo : Math.min(r.l, body.lo);
    byT.set(t, { t, o: r.o, h, l, c: r.c, v: Number.isFinite(r.v) && r.v > 0 ? r.v : 0 });
  }
  const sorted = [...byT.values()].sort((a, b) => a.t - b.t);
  if (!sorted.length) return sorted;

  // Chain candles: open = previous close so there are no visual gaps.
  const filled: Candle[] = [];
  const step = sec * 1000;
  const nowBucket = Math.floor(Date.now() / step) * step;
  let prev: Candle | null = null;
  const lastT = Math.max(sorted[sorted.length - 1].t, nowBucket);
  const byTime = new Map(sorted.map((c) => [c.t, c]));
  for (let t = sorted[0].t; t <= lastT && filled.length < 5000; t += step) {
    const real = byTime.get(t);
    if (real) {
      const o = prev ? prev.c : real.o;
      filled.push({ ...real, o, h: Math.max(real.h, o), l: Math.min(real.l, o) });
      prev = filled[filled.length - 1];
    } else if (prev) {
      filled.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
      prev = filled[filled.length - 1];
    }
  }
  return filled.slice(-MAX_POINTS);
}

// ── orchestration ───────────────────────────────────────────────────────
const MIN_GOOD = 3;

async function load(mint: string, tf: Tf, onCurve = false): Promise<{ candles: Candle[]; source: string } | null> {
  // Race Gecko and Birdeye simultaneously — take the first provider that returns
  // MIN_GOOD candles.  This avoids waiting for Gecko to time-out (8 s on 429)
  // before we even look at the Birdeye result that was ready 6 s earlier.
  const geckoJob = fromGecko(mint, tf);
  const birdeyeJob = fromBirdeye(mint, tf);

  type Tagged = { rows: Candle[]; source: string };
  const toTagged = (rows: Candle[] | null, src: string): Tagged | null =>
    rows && rows.length >= MIN_GOOD ? { rows, source: src } : null;

  const winner = await Promise.any([
    geckoJob.then((r) => {
      const t = toTagged(r, "geckoterminal");
      if (!t) throw new Error("gecko: insufficient");
      return t;
    }),
    birdeyeJob.then((r) => {
      const t = toTagged(r, "birdeye");
      if (!t) throw new Error("birdeye: insufficient");
      return t;
    }),
    // pump.fun tokens (esp. bonding curve) often have no indexer candles: start the on-chain rebuild
    // in parallel after a short head start instead of only after both providers finish/time out.
    (async () => {
      if (!mint.endsWith("pump") || !onCurve) throw new Error("not on curve");
      await new Promise((r) => setTimeout(r, 1200));
      const rows = await fromOnChain(mint, tf);
      const t = rows && rows.length ? { rows, source: "pumpfun-onchain" } : null;
      if (!t) throw new Error("onchain: empty");
      return t;
    })(),
  ]).catch(() => null as Tagged | null);

  if (winner) {
    const candles = clean(winner.rows, tf.sec);
    if (candles.length) return { candles, source: winner.source };
  }

  // On-chain fallback (pump.fun tokens only, capped to ONCHAIN_BUDGET_MS).
  const onchain = onCurve ? await fromOnChain(mint, tf) : null; // graduated tokens: curve history is useless and burns RPC credits
  if (onchain && onchain.length) {
    const candles = clean(onchain, tf.sec);
    if (candles.length) return { candles, source: "pumpfun-onchain" };
  }

  // Sparse-but-real beats nothing (brand-new token with 1-2 trades).
  const [gecko, birdeye] = await Promise.all([geckoJob, birdeyeJob]);
  const sparse = [gecko, birdeye].find((x) => x && x.length);
  if (sparse) {
    const candles = clean(sparse, tf.sec);
    if (candles.length) return { candles, source: "sparse" };
  }
  return null;
}

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("address") ?? req.nextUrl.searchParams.get("mint") ?? "";
  const tfKey = req.nextUrl.searchParams.get("tf") ?? "15m";
  if (!SOLANA_MINT_RE.test(mint)) {
    return NextResponse.json({ candles: [], error: "Invalid Solana mint" }, { status: 400 });
  }
  const tf = TF[tfKey] ?? TF["15m"];
  const sandboxTok = await getSandboxToken(mint);
  if (sandboxTok) {
    const solUsd = await getSolUsd();
    return NextResponse.json({ candles: sandboxCandles(sandboxTok.priceSol * solUsd, tf.sec), source: "sandbox", intervalSec: tf.sec, updatedAt: Date.now() });
  }
  const key = `${mint}:${tfKey in TF ? tfKey : "15m"}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) {
    return NextResponse.json({ candles: hit.candles, source: hit.source, intervalSec: tf.sec, updatedAt: hit.ts });
  }

  // Stale-while-revalidate: anything we've seen in the last 30 min is served instantly, refreshed in the background.
  if (hit && Date.now() - hit.ts < STALE_MS) {
    if (!inflight.has(key)) {
      const bg = load(mint, tf, req.nextUrl.searchParams.get("curve") === "1")
        .then((r) => {
          if (r) cache.set(key, { ...r, ts: Date.now() });
          return r;
        })
        .catch(() => null)
        .finally(() => inflight.delete(key));
      inflight.set(key, bg);
    }
    return NextResponse.json({ candles: hit.candles, source: hit.source, stale: true, intervalSec: tf.sec, updatedAt: hit.ts });
  }

  const t0 = Date.now();
  let job = inflight.get(key);
  if (!job) {
    job = load(mint, tf, req.nextUrl.searchParams.get("curve") === "1")
      .catch((e) => {
        console.error("[token-chart] load threw", e);
        return null;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  const result = await job;
  console.log(`[token-chart] ${mint.slice(0, 6)} ${tfKey} ${result ? result.source : "none"} ${Date.now() - t0}ms`);

  if (result) {
    const entry = { ...result, ts: Date.now() };
    cache.set(key, entry);
    // Never let a thin result overwrite a richer one we already served.
    const prev = lastGood.get(key);
    if (!prev || result.candles.length >= prev.candles.length * 0.5 || result.source !== "sparse") {
      lastGood.set(key, entry);
    }
    if (cache.size > 400) {
      for (const [k, v] of cache) if (Date.now() - v.ts > 120_000) cache.delete(k);
    }
    return NextResponse.json({ candles: result.candles, source: result.source, intervalSec: tf.sec, updatedAt: entry.ts });
  }

  const stale = lastGood.get(key);
  if (stale && Date.now() - stale.ts < STALE_MS) {
    return NextResponse.json({ candles: stale.candles, source: stale.source, stale: true, intervalSec: tf.sec, updatedAt: stale.ts });
  }
  return NextResponse.json({ candles: [], source: "none", intervalSec: tf.sec });
}
