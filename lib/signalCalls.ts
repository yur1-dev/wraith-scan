// lib/signalCalls.ts  (server only)
// Shared, server-side record of every token Wraith flagged. One copy for all
// users, so spotted / now / peak are identical everywhere and keep updating
// whenever anyone has the app open.

import { getDb } from "@/lib/mongoClient";
import { SOLANA_MINT_RE } from "@/lib/market";
import { arr, getJson, getSolUsd, obj, parseDexPair } from "@/lib/marketProviders";
import { liveEvmMcaps } from "@/lib/evmScan";
import { EVM_ADDR_RE } from "@/lib/chains";

export interface SignalCall {
  address: string;
  chain?: string;
  symbol: string;
  name?: string;
  imageUrl?: string;
  spottedAt: number;
  spottedMcap: number;
  peakMcap: number;
  lastMcap: number;
  lastCheck: number;
  tier: "HOT" | "WATCH";
  score: number;
}

const COLLECTION = "signal_calls";
const WINDOW_MS = 7 * 24 * 3_600_000;
const REFRESH_EVERY_MS = 8_000;
let lastRefresh = 0;
let refreshing: Promise<void> | null = null;
let indexed = false;

async function col() {
  const db = await getDb();
  const c = db.collection<SignalCall>(COLLECTION);
  if (!indexed) {
    indexed = true;
    await c.createIndex({ address: 1 }, { unique: true }).catch(() => undefined);
    await c.createIndex({ spottedAt: -1 }).catch(() => undefined);
  }
  return c;
}

/** Live market caps straight from DexScreener (batched, <= 30 mints). */
export async function liveMcaps(items: ({ address: string; chain?: string } | string)[]): Promise<Map<string, number>> {
  const norm = items.map((i) => (typeof i === "string" ? { address: i, chain: undefined } : i));
  const evmItems = norm.filter((i) => i.chain && i.chain !== "solana").map((i) => ({ address: i.address, chain: i.chain as string }));
  const evm = evmItems.length ? await liveEvmMcaps(evmItems) : new Map<string, number>();
  const mints = norm.filter((i) => !i.chain || i.chain === "solana").map((i) => i.address);
  const sol = await liveSolMcaps(mints);
  for (const [k, v] of evm) sol.set(k, v);
  return sol;
}

async function liveSolMcaps(mints: string[]): Promise<Map<string, number>> {
  const list = mints.filter((m, i, a) => SOLANA_MINT_RE.test(m) && a.indexOf(m) === i).slice(0, 30);
  const out = new Map<string, number>();
  if (!list.length) return out;
  try {
    const solUsd = await getSolUsd();
    const pairs = arr(await getJson(`https://api.dexscreener.com/tokens/v1/solana/${list.join(",")}`, undefined, 9000));
    const bestLiq = new Map<string, number>();
    for (const p of pairs) {
      const t = parseDexPair(obj(p), solUsd);
      if (!t || !(t.mcap > 0)) continue;
      if ((bestLiq.get(t.address) ?? -1) < t.liquidity) {
        bestLiq.set(t.address, t.liquidity);
        out.set(t.address, t.mcap);
      }
    }
  } catch {
    /* caller keeps previous values */
  }
  return out;
}

export async function recordSignals(
  signals: { token: { address: string; chain?: string; symbol: string; name: string; imageUrl?: string; mcap: number }; score: number; tier: "HOT" | "WATCH" }[],
) {
  const eligible = signals.filter((s) => s.score >= 60 && s.token.mcap > 0);
  if (!eligible.length) return;
  const c = await col();
  const existing = new Set(
    (await c.find({ address: { $in: eligible.map((s) => s.token.address) } }, { projection: { address: 1 } }).toArray()).map((d) => d.address),
  );
  const fresh = eligible.filter((s) => !existing.has(s.token.address)).slice(0, 30);
  if (!fresh.length) return;
  // The market cache can be ~30s old: re-read the live market cap so "spotted" is the real price at spot time.
  const live = await liveMcaps(fresh.map((s) => ({ address: s.token.address, chain: s.token.chain })));
  const now = Date.now();
  for (const s of fresh) {
    const mcap = live.get(s.token.address) ?? s.token.mcap;
    await c
      .updateOne(
        { address: s.token.address },
        {
          $setOnInsert: {
            address: s.token.address,
            chain: s.token.chain && s.token.chain !== "solana" ? s.token.chain : "solana",
            symbol: s.token.symbol.toUpperCase(),
            name: s.token.name,
            imageUrl: s.token.imageUrl,
            spottedAt: now,
            spottedMcap: mcap,
            peakMcap: mcap,
            lastMcap: mcap,
            lastCheck: now,
            tier: s.tier,
            score: s.score,
          },
        },
        { upsert: true },
      )
      .catch(() => undefined);
  }
}

export async function refreshCalls(force = false) {
  if (!force && Date.now() - lastRefresh < REFRESH_EVERY_MS) return;
  if (refreshing) return refreshing;
  lastRefresh = Date.now();
  refreshing = (async () => {
    try {
      const c = await col();
      const due = await c
        .find({ spottedAt: { $gt: Date.now() - WINDOW_MS } }, { projection: { address: 1, chain: 1 } })
        .sort({ lastCheck: 1 })
        .limit(30)
        .toArray();
      if (!due.length) return;
      const live = await liveMcaps(due.map((d) => ({ address: d.address, chain: d.chain })));
      const now = Date.now();
      await Promise.all(
        [...live.entries()].map(([address, mcap]) =>
          c.updateOne({ address }, { $set: { lastMcap: mcap, lastCheck: now }, $max: { peakMcap: mcap } }).catch(() => undefined),
        ),
      );
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function listCalls(limit = 120, mint?: string): Promise<SignalCall[]> {
  const c = await col();
  const filter = mint ? { address: EVM_ADDR_RE.test(mint) ? mint.toLowerCase() : mint } : { spottedAt: { $gt: Date.now() - WINDOW_MS } };
  const docs = await c.find(filter, { projection: { _id: 0 } }).sort({ spottedAt: -1 }).limit(limit).toArray();
  return docs as SignalCall[];
}
