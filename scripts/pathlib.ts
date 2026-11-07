/** Shared by relabel-paths.ts (GeckoTerminal candles) and relabel-helius.ts (candles built from on-chain trades). No side effects on import. */
export interface PathRec {
  addr: string; pool: string | null; ok: boolean; n: number;
  p0: number; peak1h: number; peak6h: number; peak24h: number; trough24h: number;
  first2xMin: number | null; firstHalfMin: number | null; clean2x: boolean; clean15x: boolean;
  r1h: number | null; r6h: number | null; r24h: number | null; maxDrawBeforePeak: number;
  /** minutes of the first 24h that the data actually covers (24h = complete) */
  coverMin?: number;
  src?: "gecko" | "helius";
  /** why there is no usable path, e.g. "busy" (too many trades to read in full: left to the candle route) */
  note?: string;
}
export type Candle = [number, number, number, number, number, number]; // t(sec), o, h, l, c, v

export const emptyRec = (addr: string, pool: string | null): PathRec => ({ addr, pool, ok: false, n: 0, p0: 0, peak1h: 0, peak6h: 0, peak24h: 0, trough24h: 0, first2xMin: null, firstHalfMin: null, clean2x: false, clean15x: false, r1h: null, r6h: null, r24h: null, maxDrawBeforePeak: 0 });

/** From 5-minute candles around a call, work out what the price really did in the 24h after it. Prices only need to be consistent with each other. */
export function pathStats(addr: string, pool: string, c: Candle[], t0Sec: number): PathRec {
  const empty: PathRec = { ...emptyRec(addr, pool), n: c.length };
  if (c.length < 3) return empty;
  // price at the moment of the call: the candle that contains it (its close), else the first candle after it
  const at = c.findIndex((k) => k[0] <= t0Sec && t0Sec < k[0] + 300);
  const first = at >= 0 ? at : c.findIndex((k) => k[0] >= t0Sec);
  if (first < 0) return empty;
  const p0 = at >= 0 ? c[at][4] : c[first][1];
  if (!(p0 > 0)) return empty;
  const after = c.slice(at >= 0 ? at + 1 : first).filter((k) => k[0] <= t0Sec + 24 * 3600);
  if (after.length < 2) return { ...empty, p0 };
  let peak1 = 1, peak6 = 1, peak24 = 1, trough = 1, first2 = null as number | null, firstHalf = null as number | null, clean2 = false, clean15 = false, hit15 = null as number | null;
  let runPeak = 1, maxDraw = 0;
  for (const k of after) {
    const min = (k[0] - t0Sec) / 60;
    const hi = k[2] / p0, lo = k[3] / p0;
    // inside one candle the order of high and low is unknown: assume the LOW came first (the cautious choice for any stop)
    if (lo <= 0.5 && firstHalf === null) firstHalf = min;
    if (hi >= 2 && first2 === null) { first2 = min; if (firstHalf === null) clean2 = true; }
    if (hi >= 1.5 && hit15 === null) { hit15 = min; if (firstHalf === null) clean15 = true; }
    if (min <= 60) peak1 = Math.max(peak1, hi);
    if (min <= 360) peak6 = Math.max(peak6, hi);
    peak24 = Math.max(peak24, hi);
    trough = Math.min(trough, lo);
    runPeak = Math.max(runPeak, hi);
    maxDraw = Math.max(maxDraw, 1 - lo / runPeak);
  }
  const at1 = (m: number) => { const k = after.find((x) => (x[0] - t0Sec) / 60 >= m); return k ? k[4] / p0 : null; };
  const lastMin = (after[after.length - 1][0] - t0Sec) / 60;
  return { addr, pool, ok: true, n: after.length, p0, peak1h: peak1, peak6h: peak6, peak24h: peak24, trough24h: trough, first2xMin: first2, firstHalfMin: firstHalf, clean2x: clean2, clean15x: clean15, r1h: at1(60), r6h: at1(360), r24h: at1(1440), maxDrawBeforePeak: maxDraw, coverMin: Math.min(1440, Math.round(lastMin)) };
}

/** The series after the call as price ratios to the call price: [minutes after, open, high, low, close]. Used by optimize-exits.ts */
export function seriesOf(c: Candle[], p0: number, t0Sec: number): number[][] {
  return c.filter((k) => k[0] >= t0Sec - 300 && k[0] <= t0Sec + 24 * 3600).map((k) => [Math.round((k[0] - t0Sec) / 60), +(k[1] / p0).toFixed(4), +(k[2] / p0).toFixed(4), +(k[3] / p0).toFixed(4), +(k[4] / p0).toFixed(4)]);
}

/** Best pair address per token from DexScreener (30 tokens per request). */
export async function dexPairs(addrs: string[]): Promise<Map<string, { pair: string; dex: string }>> {
  const out = new Map<string, { pair: string; dex: string; l: number }>();
  for (let i = 0; i < addrs.length; i += 30) {
    const part = addrs.slice(i, i + 30);
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${part.join(",")}`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!res?.ok) continue;
    const pairs = (await res.json()) as { baseToken?: { address?: string }; pairAddress?: string; dexId?: string; liquidity?: { usd?: number } }[];
    for (const p of pairs) {
      const a = p.baseToken?.address;
      if (!a || !p.pairAddress) continue;
      const l = p.liquidity?.usd ?? 0;
      const cur = out.get(a);
      if (!cur || l > cur.l) out.set(a, { pair: p.pairAddress, dex: p.dexId ?? "", l });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return new Map([...out].map(([k, v]) => [k, { pair: v.pair, dex: v.dex }]));
}
