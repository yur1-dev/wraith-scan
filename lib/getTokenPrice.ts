// ─── SHARED TOKEN PRICE SOURCE OF TRUTH ────────────────────────────────────
// Previously TokenPanel, WinsPanel (via MemeScanner), and PaperTrader each
// had their own independent price-fetching function, hitting different
// endpoints in different orders with different caching. That guarantees the
// same token shows different numbers in different panels at the same moment.
//
// Every panel should call getTokenPrice() from here instead. One cache, one
// fallback order, one number, everywhere.
//
// Fallback order:
//   1. DexScreener  — pair metadata, supply baseline, works for anything with
//                      a live DEX pool (Raydium/Orca/etc).
//   2. Jupiter Price v2 — overlaid on top when available. This is the price
//                      swaps actually execute at, so it's the most "real"
//                      number when it exists. More current than DexScreener's
//                      cached pair data.
//   3. pump.fun bonding curve — last resort for tokens that haven't migrated
//                      to a DEX yet (no DexScreener pair, no Jupiter route).
//                      Unofficial/undocumented API — treat as best-effort.

export interface LiveTokenPrice {
  mcap?: number;
  price?: number; // USD
  liquidity?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  volume24h?: number;
  ageMinutes?: number;
  source: "dexscreener+jupiter" | "dexscreener" | "pumpfun" | "none";
}

interface CacheEntry {
  data: LiveTokenPrice;
  ts: number;
}

const _cache = new Map<string, CacheEntry>();
const _supplyCache = new Map<string, number>();
const CACHE_MS = 45_000; // was 4s — did nothing since nothing re-requests within 4s; this now actually lets WinsPanel's 60s refresh and MemeScanner's own polling share one fetch instead of each hitting DexScreener independently

let _solUsdCache: { price: number; ts: number } | null = null;
async function getSolUsd(): Promise<number> {
  if (_solUsdCache && Date.now() - _solUsdCache.ts < 15_000) {
    return _solUsdCache.price;
  }
  try {
    // Jupiter's price API has no CORS headers for browser origins, and the
    // old v2 endpoint is gone (404). Route through your own server-side
    // proxy (app/api/jupiter/route.ts) which already uses v3 correctly.
    const res = await fetch(
      "/api/jupiter?endpoint=price&ids=So11111111111111111111111111111111111111112",
      { signal: AbortSignal.timeout(5000) },
    );
    const data = await res.json();
    const price = parseFloat(
      data?.data?.So11111111111111111111111111111111111111112?.price ?? "0",
    );
    if (price > 0) {
      _solUsdCache = { price, ts: Date.now() };
      return price;
    }
  } catch {
    // fall through
  }
  return _solUsdCache?.price ?? 0;
}

async function fromPumpFun(ca: string): Promise<LiveTokenPrice | null> {
  try {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins/${ca}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const mcap = d?.usd_market_cap ?? d?.market_cap ?? 0;
    if (!mcap || mcap <= 0) return null;

    // pump.fun gives SOL-denominated bonding curve price — convert to USD
    const solUsd = await getSolUsd();
    const priceSol =
      d?.virtual_sol_reserves && d?.virtual_token_reserves
        ? d.virtual_sol_reserves / 1e9 / (d.virtual_token_reserves / 1e6)
        : 0;
    const price = priceSol && solUsd ? priceSol * solUsd : undefined;

    return {
      mcap,
      price,
      liquidity: d?.virtual_sol_reserves
        ? (d.virtual_sol_reserves / 1e9) * solUsd
        : undefined,
      source: "pumpfun",
    };
  } catch {
    return null;
  }
}

export async function getTokenPrice(
  ca: string,
  opts?: { skipJupiter?: boolean },
): Promise<LiveTokenPrice> {
  const cached = _cache.get(ca);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  const result = await _fetchTokenPrice(ca, opts?.skipJupiter ?? false);
  _cache.set(ca, { data: result, ts: Date.now() });
  return result;
}

async function _fetchTokenPrice(
  ca: string,
  skipJupiter: boolean,
): Promise<LiveTokenPrice> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${ca}`,
      { signal: AbortSignal.timeout(8000) },
    );

    if (res.ok) {
      const data = await res.json();
      const pairs = (data?.pairs || [])
        .filter((p: { chainId: string }) => p.chainId === "solana")
        .sort(
          (
            a: { liquidity?: { usd?: number } },
            b: { liquidity?: { usd?: number } },
          ) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0),
        );

      if (pairs.length) {
        const pair = pairs[0];
        const ageMinutes = pair.pairCreatedAt
          ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000)
          : undefined;

        // Use circulating marketCap, not fdv (fdv = total supply, inflated)
        const dexMcap = pair.marketCap || pair.fdv || 0;
        const dexPrice = parseFloat(pair.priceUsd || "0") || 0;

        if (dexPrice > 0 && dexMcap > 0) {
          const freshSupply = dexMcap / dexPrice;
          const cachedSupply = _supplyCache.get(ca);
          // Refresh if unset, or if the new read disagrees with cache by more
          // than 5% — a stale/bad first snapshot shouldn't get locked in
          // permanently.
          if (
            !cachedSupply ||
            Math.abs(freshSupply - cachedSupply) / cachedSupply > 0.05
          ) {
            _supplyCache.set(ca, freshSupply);
          }
        }

        let mcap = dexMcap;
        let price = dexPrice;

        // Overlay Jupiter — the price swaps actually execute at, more
        // current than DexScreener's cached pair snapshot when available.
        // Skipped for bulk background refreshes (WinsPanel tracking N
        // tokens at once) since that precision only matters for whatever
        // token the user actually has open — halves the request count
        // for bulk callers with zero visible accuracy loss there.
        try {
          if (skipJupiter) throw new Error("skip");
          const jupRes = await fetch(`/api/jupiter?endpoint=price&ids=${ca}`, {
            signal: AbortSignal.timeout(4000),
          });
          const jupData = await jupRes.json();
          const jupPrice = parseFloat(jupData?.data?.[ca]?.price ?? "0");
          if (jupPrice > 0) {
            price = jupPrice;
            const supply = _supplyCache.get(ca);
            if (supply && supply > 0) {
              mcap = jupPrice * supply;
            } else if (dexMcap > 0 && dexPrice > 0) {
              mcap = (jupPrice / dexPrice) * dexMcap;
            }
            return {
              mcap,
              price,
              liquidity: pair.liquidity?.usd,
              priceChange1h: pair.priceChange?.h1,
              priceChange24h: pair.priceChange?.h24,
              volume24h: pair.volume?.h24,
              ageMinutes,
              source: "dexscreener+jupiter",
            };
          }
        } catch {
          // Jupiter unavailable — DexScreener values still valid
        }

        return {
          mcap,
          price,
          liquidity: pair.liquidity?.usd,
          priceChange1h: pair.priceChange?.h1,
          priceChange24h: pair.priceChange?.h24,
          volume24h: pair.volume?.h24,
          ageMinutes,
          source: "dexscreener",
        };
      }
    }
  } catch {
    // DexScreener unavailable — fall through to pump.fun
  }

  // No DEX pair anywhere — token may still be on the pump.fun bonding curve
  const pf = await fromPumpFun(ca);
  if (pf) return pf;

  return { source: "none" };
}

// ─── Back-compat thin wrappers ──────────────────────────────────────────────
// So existing call sites (fetchCurrentMcap, fetchMcap, fetchLiveTokenData)
// can be swapped to call these without restructuring every caller at once.

export async function getMcap(
  ca: string,
  opts?: { skipJupiter?: boolean },
): Promise<number> {
  const d = await getTokenPrice(ca, opts);
  return d.mcap ?? 0;
}
