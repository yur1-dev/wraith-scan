// app/api/token-chart/route.ts
//
// Proxies candle history for TokenPanel's built-in chart (LINE + CANDLES modes).
// Keeps BIRDEYE_API_KEY server-side. Uses the same env var your scanner already
// reads (BIRDEYE_API_KEY) — no new secret needed.

import { NextRequest, NextResponse } from "next/server";

const TF_MAP: Record<string, { type: string; rangeSec: number }> = {
  "5m": { type: "5m", rangeSec: 6 * 60 * 60 }, // 6h of 5m candles
  "15m": { type: "15m", rangeSec: 24 * 60 * 60 }, // 1d of 15m candles
  "1h": { type: "1H", rangeSec: 7 * 24 * 60 * 60 }, // 7d of 1h candles
  "4h": { type: "4H", rangeSec: 30 * 24 * 60 * 60 }, // 30d of 4h candles
  "1d": { type: "1D", rangeSec: 180 * 24 * 60 * 60 }, // 180d of 1d candles
};

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  const tf = req.nextUrl.searchParams.get("tf") || "15m";

  if (!address) {
    return NextResponse.json({ candles: [] }, { status: 400 });
  }

  const cfg = TF_MAP[tf] || TF_MAP["15m"];
  const now = Math.floor(Date.now() / 1000);
  const from = now - cfg.rangeSec;

  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) {
    // No key configured — fail soft so the UI shows "no chart data" instead of crashing.
    return NextResponse.json({ candles: [] });
  }

  try {
    const res = await fetch(
      `https://public-api.birdeye.so/defi/ohlcv?address=${address}&type=${cfg.type}&time_from=${from}&time_to=${now}`,
      {
        headers: {
          "X-API-KEY": apiKey,
          "x-chain": "solana",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
        // avoid caching stale candles across users/tokens
        cache: "no-store",
      },
    );

    if (!res.ok) {
      return NextResponse.json({ candles: [] });
    }

    const data = await res.json();
    const items = data?.data?.items || [];

    const candles = items.map(
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

    return NextResponse.json({ candles });
  } catch {
    return NextResponse.json({ candles: [] });
  }
}
