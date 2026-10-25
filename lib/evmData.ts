// lib/evmData.ts  (server only)
// DexScreener pair lookup for any EVM chain, cached. Picks the deepest pool.

import { getJson, num, numOrNull, arr, obj } from "@/lib/marketProviders";
import { EVM_ADDR_RE, chainOf } from "@/lib/chains";

export interface EvmSnapshot {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  priceUsd: number;
  marketCap: number | null;
  fdv: number | null;
  supply: number | null;
  liquidity: number;
  volume: { m5: number; h1: number; h6: number; h24: number };
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  txns: { h1: { buys: number; sells: number }; h24: { buys: number; sells: number } };
  pairAddress: string;
  pools: string[];          // top pools by liquidity (chart tries them in order)
  dex: string | null;
  quoteSymbol: string | null;
  createdAt: number | null;
  websites: string[];
  socials: { type: string; url: string }[];
  updatedAt: number;
}

const cache = new Map<string, { ts: number; snap: EvmSnapshot }>();
const TTL = 4_000;

export async function getEvmSnapshot(address: string, chainKey?: string | null): Promise<EvmSnapshot | null> {
  if (!EVM_ADDR_RE.test(address)) return null;
  const wanted = chainOf(chainKey)?.key ?? null;
  const key = `${wanted ?? "any"}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.snap;

  const url = wanted
    ? `https://api.dexscreener.com/tokens/v1/${wanted}/${address}`
    : `https://api.dexscreener.com/latest/dex/tokens/${address}`;
  let data: unknown;
  try {
    data = await getJson(url, undefined, 8000);
  } catch (e) {
    if (hit) return hit.snap;
    throw e;
  }
  const pairs = (Array.isArray(data) ? data : arr(obj(data).pairs))
    .map(obj)
    .filter((p) => chainOf(String(p.chainId)) && String(obj(p.baseToken).address).toLowerCase() === address.toLowerCase());
  if (!pairs.length) return hit?.snap ?? null;
  pairs.sort((a, b) => num(obj(b.liquidity).usd) - num(obj(a.liquidity).usd));
  const p = pairs[0];
  const base = obj(p.baseToken);
  const quote = obj(p.quoteToken);
  const vol = obj(p.volume);
  const chg = obj(p.priceChange);
  const tx = obj(p.txns);
  const t1 = obj(tx.h1);
  const t24 = obj(tx.h24);
  const info = obj(p.info);
  const priceUsd = num(p.priceUsd);
  const marketCap = numOrNull(p.marketCap);
  const fdv = numOrNull(p.fdv);
  const mc = marketCap && marketCap > 0 ? marketCap : fdv && fdv > 0 ? fdv : null;
  const snap: EvmSnapshot = {
    chain: String(p.chainId),
    address,
    symbol: String(base.symbol ?? "?"),
    name: String(base.name ?? base.symbol ?? "?"),
    imageUrl: typeof info.imageUrl === "string" ? info.imageUrl : null,
    priceUsd,
    marketCap: marketCap && marketCap > 0 ? marketCap : null,
    fdv: fdv && fdv > 0 ? fdv : null,
    supply: mc && priceUsd > 0 ? mc / priceUsd : null,
    liquidity: num(obj(p.liquidity).usd),
    volume: { m5: num(vol.m5), h1: num(vol.h1), h6: num(vol.h6), h24: num(vol.h24) },
    change: { m5: numOrNull(chg.m5), h1: numOrNull(chg.h1), h6: numOrNull(chg.h6), h24: numOrNull(chg.h24) },
    txns: { h1: { buys: num(t1.buys), sells: num(t1.sells) }, h24: { buys: num(t24.buys), sells: num(t24.sells) } },
    pairAddress: String(p.pairAddress ?? ""),
    pools: pairs.slice(0, 4).map((x) => String(x.pairAddress ?? "")).filter(Boolean),
    dex: typeof p.dexId === "string" ? p.dexId : null,
    quoteSymbol: typeof quote.symbol === "string" ? quote.symbol : null,
    createdAt: typeof p.pairCreatedAt === "number" ? p.pairCreatedAt : null,
    websites: arr(info.websites).map((w) => String(obj(w).url ?? "")).filter(Boolean),
    socials: arr(info.socials).map((s) => ({ type: String(obj(s).type ?? ""), url: String(obj(s).url ?? "") })).filter((s) => s.url),
    updatedAt: Date.now(),
  };
  cache.set(key, { ts: Date.now(), snap });
  return snap;
}
