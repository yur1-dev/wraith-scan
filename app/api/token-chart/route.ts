import { Connection } from "@solana/web3.js";
import { fromPumpFunOnChain } from "@/lib/onchain-pumpfun";
import { NextRequest, NextResponse } from "next/server";

const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC!, {
  disableRetryOnRateLimit: true,
});

type TfConfig = {
  birdeyeType: string;
  geckoTf: string;
  geckoAgg: string;
  rangeSec: number;
  pumpIntervalSec: number;
};

const TF_MAP: Record<string, TfConfig> = {
  "1m": {
    birdeyeType: "1m",
    geckoTf: "minute",
    geckoAgg: "1",
    rangeSec: 2 * 60 * 60,
    pumpIntervalSec: 60,
  },
  "5m": {
    birdeyeType: "5m",
    geckoTf: "minute",
    geckoAgg: "5",
    rangeSec: 6 * 60 * 60,
    pumpIntervalSec: 300,
  },
  "15m": {
    birdeyeType: "15m",
    geckoTf: "minute",
    geckoAgg: "15",
    rangeSec: 24 * 60 * 60,
    pumpIntervalSec: 900,
  },
  "1h": {
    birdeyeType: "1H",
    geckoTf: "hour",
    geckoAgg: "1",
    rangeSec: 7 * 24 * 60 * 60,
    pumpIntervalSec: 3600,
  },
  "4h": {
    birdeyeType: "4H",
    geckoTf: "hour",
    geckoAgg: "4",
    rangeSec: 30 * 24 * 60 * 60,
    pumpIntervalSec: 14400,
  },
  "1d": {
    birdeyeType: "1D",
    geckoTf: "day",
    geckoAgg: "1",
    rangeSec: 180 * 24 * 60 * 60,
    pumpIntervalSec: 86400,
  },
};

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

// ─── SHORT-LIVED SERVER CACHE ───────────────────────────────────────────────
const CANDLE_CACHE_MS = 15_000;
const _candleCache = new Map<
  string,
  { candles: Candle[]; source: string; ts: number }
>();

// ─── CIRCUIT BREAKER ────────────────────────────────────────────────────────
const SOURCE_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
const _sourceDownUntil: Record<string, number> = {
  birdeye: 0,
  geckoterminal: 0,
};
function isDown(source: string) {
  return Date.now() < _sourceDownUntil[source];
}
function markDown(source: string) {
  _sourceDownUntil[source] = Date.now() + SOURCE_COOLDOWN_MS;
}

async function fromBirdeye(
  address: string,
  cfg: TfConfig,
): Promise<Candle[] | null> {
  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) return null;

  const now = Math.floor(Date.now() / 1000);
  const from = now - cfg.rangeSec;

  try {
    const res = await fetch(
      `https://public-api.birdeye.so/defi/ohlcv?address=${address}&type=${cfg.birdeyeType}&time_from=${from}&time_to=${now}`,
      {
        headers: {
          "X-API-KEY": apiKey,
          "x-chain": "solana",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        "[token-chart] Birdeye OHLCV failed",
        res.status,
        body.slice(0, 300),
      );
      if (res.status === 400 || res.status === 429) markDown("birdeye");
      return null;
    }

    const data = await res.json();
    const items = data?.data?.items || [];
    if (!items.length) return null;

    return items.map(
      (c: {
        unixTime: number;
        o: number;
        h: number;
        l: number;
        c: number;
      }) => ({
        t: c.unixTime * 1000,
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
      }),
    );
  } catch (e) {
    console.error("[token-chart] Birdeye OHLCV threw", e);
    return null;
  }
}

async function fromGeckoTerminal(
  address: string,
  cfg: TfConfig,
): Promise<Candle[] | null> {
  try {
    const poolsRes = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${address}/pools?page=1`,
      { signal: AbortSignal.timeout(8000), cache: "no-store" },
    );
    if (!poolsRes.ok) {
      if (poolsRes.status === 429) markDown("geckoterminal");
      return null;
    }
    const poolsData = await poolsRes.json();
    const pool = poolsData?.data?.[0];
    const poolAddress = pool?.attributes?.address;
    if (!poolAddress) return null;

    const ohlcvRes = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/${cfg.geckoTf}?aggregate=${cfg.geckoAgg}&limit=200`,
      { signal: AbortSignal.timeout(8000), cache: "no-store" },
    );
    if (!ohlcvRes.ok) {
      const body = await ohlcvRes.text().catch(() => "");
      console.error(
        "[token-chart] GeckoTerminal OHLCV failed",
        ohlcvRes.status,
        body.slice(0, 300),
      );
      if (ohlcvRes.status === 429) markDown("geckoterminal");
      return null;
    }
    const ohlcvData = await ohlcvRes.json();
    const list: [number, string, string, string, string, string][] =
      ohlcvData?.data?.attributes?.ohlcv_list || [];

    return list
      .map(([t, o, h, l, c]) => ({
        t: t * 1000,
        o: parseFloat(o),
        h: parseFloat(h),
        l: parseFloat(l),
        c: parseFloat(c),
      }))
      .reverse();
  } catch (e) {
    console.error("[token-chart] GeckoTerminal threw", e);
    return null;
  }
}

// ─── PUMP.FUN HTTP TRADES — DEAD, KEPT FOR RECORD ──────────────────────────
// frontend-api-v3.pump.fun/trades/all/{mint} and /candlesticks/{mint} now
// both require `Authorization: Bearer <JWT>` from a logged-in pump.fun
// session. Confirmed via direct curl, 2026-08-03. The on-chain RPC fallback
// below is the only remaining source for tokens still on the bonding curve.
//
// getSolUsd FIX (2026-08-03): this used to call api.jup.ag/price/v2
// directly, which Jupiter deprecated — it now returns 0/nothing, which
// silently made fromPumpFunOnChain abort before ever looking at trades,
// with NO error logged (see [onchain-pumpfun] ... "aborting — getSolUsd()
// returned 0" once we added entry logging). Now routes through the app's
// own /api/jupiter proxy instead, which is already proven working
// elsewhere in the codebase.
let _solUsdCache: { price: number; ts: number } | null = null;
let _solUsdInFlight: Promise<number> | null = null;
async function getSolUsd(
  origin: string,
  cookie: string | null,
): Promise<number> {
  if (_solUsdCache && Date.now() - _solUsdCache.ts < 15_000) {
    return _solUsdCache.price;
  }
  if (_solUsdInFlight) return _solUsdInFlight;
  _solUsdInFlight = getSolUsdUncached(origin, cookie).finally(() => {
    _solUsdInFlight = null;
  });
  return _solUsdInFlight;
}

async function getSolUsdUncached(
  origin: string,
  cookie: string | null,
): Promise<number> {
  try {
    const res = await fetch(
      `${origin}/api/jupiter?endpoint=price&ids=So11111111111111111111111111111111111111112`,
      {
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
        // /api/jupiter requires an authenticated session. A server-to-server
        // fetch like this one doesn't carry the browser's cookies unless we
        // forward them explicitly — without this every call comes back
        // {"error":"Unauthorized"} and getSolUsd silently returns 0, which
        // aborts the entire on-chain fallback before it looks at trades.
        headers: cookie ? { cookie } : undefined,
      },
    );
    const data = await res.json();
    // /api/jupiter returns the price flat, keyed directly by mint address —
    // { "<mint>": { usdPrice: N, ... } } — not nested under .data.<mint>.price
    // like the old Jupiter V2 shape this code was originally written for.
    const price = parseFloat(
      data?.So11111111111111111111111111111111111111112?.usdPrice ??
        data?.data?.So11111111111111111111111111111111111111112?.price ??
        "0",
    );
    if (price > 0) {
      _solUsdCache = { price, ts: Date.now() };
      return price;
    }
    console.warn(
      "[token-chart] getSolUsd: /api/jupiter returned no usable price",
      JSON.stringify(data).slice(0, 200),
    );
  } catch (e) {
    console.error("[token-chart] getSolUsd threw", e);
  }

  // Fallback: hit Jupiter's current Price V3 endpoint directly. V2 (the
  // endpoint this used to call) is deprecated and dead; V3 is current as of
  // 2026. This only runs if the internal proxy above didn't return a price,
  // so getSolUsd has two independent paths instead of one.
  try {
    const res = await fetch(
      "https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112",
      { signal: AbortSignal.timeout(5000), cache: "no-store" },
    );
    const data = await res.json();
    const price = parseFloat(
      data?.So11111111111111111111111111111111111111112?.usdPrice ??
        data?.data?.So11111111111111111111111111111111111111112?.price ??
        "0",
    );
    if (price > 0) {
      _solUsdCache = { price, ts: Date.now() };
      return price;
    }
    console.warn(
      "[token-chart] getSolUsd: direct Jupiter V3 fallback also returned no usable price",
      JSON.stringify(data).slice(0, 200),
    );
  } catch (e) {
    console.error(
      "[token-chart] getSolUsd: direct Jupiter V3 fallback threw",
      e,
    );
  }

  return _solUsdCache?.price ?? 0;
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  const tf = req.nextUrl.searchParams.get("tf") || "15m";

  if (!address) {
    return NextResponse.json({ candles: [] }, { status: 400 });
  }

  const cacheKey = `${address}:${tf}`;
  const cached = _candleCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CANDLE_CACHE_MS) {
    return NextResponse.json({
      candles: cached.candles,
      source: cached.source,
      cached: true,
    });
  }

  const cfg = TF_MAP[tf] || TF_MAP["15m"];
  const MIN_CANDLES = 5;
  const origin = req.nextUrl.origin;
  const cookie = req.headers.get("cookie");

  function respond(candles: Candle[], source: string) {
    _candleCache.set(cacheKey, { candles, source, ts: Date.now() });
    return NextResponse.json({ candles, source });
  }

  // ── on-chain RPC (Helius) + Birdeye + GeckoTerminal, ALL in parallel ────
  const [onchainRes, birdeyeRes, geckoRes] = await Promise.allSettled([
    fromPumpFunOnChain(address, cfg, connection, () =>
      getSolUsd(origin, cookie),
    ),
    isDown("birdeye") ? Promise.resolve(null) : fromBirdeye(address, cfg),
    isDown("geckoterminal")
      ? Promise.resolve(null)
      : fromGeckoTerminal(address, cfg),
  ]);

  const onchain = onchainRes.status === "fulfilled" ? onchainRes.value : null;
  const birdeye = birdeyeRes.status === "fulfilled" ? birdeyeRes.value : null;
  const gecko = geckoRes.status === "fulfilled" ? geckoRes.value : null;

  if (onchainRes.status === "rejected") {
    console.error("[token-chart] on-chain fetch threw", onchainRes.reason);
  }

  const candidates: { candles: Candle[]; source: string }[] = [];
  if (onchain && onchain.length)
    candidates.push({ candles: onchain, source: "pumpfun-onchain" });
  if (birdeye && birdeye.length)
    candidates.push({ candles: birdeye, source: "birdeye" });
  if (gecko && gecko.length)
    candidates.push({ candles: gecko, source: "geckoterminal" });

  const strong = candidates
    .filter((c) => c.candles.length >= MIN_CANDLES)
    .sort((a, b) => b.candles.length - a.candles.length)[0];
  if (strong) return respond(strong.candles, strong.source);

  const best = candidates.sort(
    (a, b) => b.candles.length - a.candles.length,
  )[0];
  if (best) {
    return NextResponse.json({
      candles: best.candles,
      source: `sparse-${best.source}`,
    });
  }

  return NextResponse.json({ candles: [], source: "none" });
}
