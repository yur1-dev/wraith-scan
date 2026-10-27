// lib/signalCalls.ts  (server only)
// Shared, server-side record of every token Wraith flagged. One copy for all
// users, so spotted / now / peak are identical everywhere and keep updating
// whenever anyone has the app open.

import { getDb } from "@/lib/mongoClient";
import { SOLANA_MINT_RE } from "@/lib/market";
import { arr, getJson, getSolUsd, obj, parseDexPair } from "@/lib/marketProviders";
import { liveEvmMcaps } from "@/lib/evmScan";
import { EVM_ADDR_RE } from "@/lib/chains";
import { learnMatured } from "@/lib/walletLearn";
import type { SignalIntel } from "@/lib/signalIntel";

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
  /** true = tracked only to learn from (never shown, never counted in the public record, never alerted) */
  shadow?: boolean;
  /** which scanner version made the call (missing = original scanner) */
  engine?: number;
  /** numeric snapshot of every indicator at call time (see featuresOf), used by /api/signal-lab */
  features?: Record<string, number | null>;
  /** wallets that were buying when the call was made, for the wallet scoreboard (server only) */
  buyers?: string[];
  learned?: boolean;
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

export interface RecordInput {
  token: { address: string; chain?: string; symbol: string; name: string; imageUrl?: string; mcap: number };
  score: number;
  tier: "HOT" | "WATCH";
  intel?: SignalIntel;
  features?: Record<string, number | null>;
}

const SHADOW_MIN_SCORE = 40;
const ENGINE = 2;

/**
 * HOT signals become public calls (shown, counted in the record, alerted). Vetted lower-ranked candidates are tracked as
 * "shadow" calls: never shown or counted, but their outcomes teach the wallet scoreboard and the calibration report.
 */
export async function recordSignals(signals: RecordInput[]) {
  const live = signals.filter((s) => s.token.mcap > 0);
  const pub = live.filter((s) => s.tier === "HOT").slice(0, 6);
  const pubSet = new Set(pub.map((s) => s.token.address));
  const shadow = live.filter((s) => !pubSet.has(s.token.address) && s.intel && s.score >= SHADOW_MIN_SCORE).slice(0, 20);
  const cands = [...pub.map((s) => ({ s, shadow: false })), ...shadow.map((s) => ({ s, shadow: true }))];
  if (!cands.length) { void learnMatured().catch(() => undefined); return; }
  const c = await col();
  const existing = new Map(
    (await c.find({ address: { $in: cands.map((x) => x.s.token.address) } }, { projection: { address: 1, shadow: 1 } }).toArray()).map((d) => [d.address, d.shadow === true]),
  );
  // already a public call -> nothing to do; already a shadow call -> only promote if it now qualifies as public
  const fresh = cands.filter((x) => !existing.has(x.s.token.address) || (existing.get(x.s.token.address) === true && !x.shadow));
  if (fresh.length) {
    // The market cache can be ~30s old: re-read the live market cap so "spotted" is the real price at spot time.
    const liveCaps = await liveMcaps(fresh.map((x) => ({ address: x.s.token.address, chain: x.s.token.chain })));
    const now = Date.now();
    for (const { s, shadow: isShadow } of fresh) {
      const mcap = liveCaps.get(s.token.address) ?? s.token.mcap;
      const base = {
        chain: s.token.chain && s.token.chain !== "solana" ? s.token.chain : "solana",
        symbol: s.token.symbol.toUpperCase(),
        name: s.token.name,
        imageUrl: s.token.imageUrl,
        spottedAt: now, spottedMcap: mcap, peakMcap: mcap, lastMcap: mcap, lastCheck: now,
        tier: s.tier, score: s.score, shadow: isShadow, engine: ENGINE,
        ...(s.features ? { features: s.features } : {}),
        ...(s.intel?.buyers?.length ? { buyers: s.intel.buyers.slice(-80) } : {}),
      };
      if (existing.has(s.token.address)) {
        // promotion: the price it is called at is the price NOW, not when it was only being watched
        await c.updateOne({ address: s.token.address }, { $set: base }).catch(() => undefined);
      } else {
        await c.updateOne({ address: s.token.address }, { $setOnInsert: { address: s.token.address, ...base } }, { upsert: true }).catch(() => undefined);
      }
    }
  }
  void learnMatured().catch(() => undefined);
}

export async function refreshCalls(force = false) {
  if (!force && Date.now() - lastRefresh < REFRESH_EVERY_MS) return;
  if (refreshing) return refreshing;
  lastRefresh = Date.now();
  refreshing = (async () => {
    try {
      const c = await col();
      const t0 = Date.now();
      const due = await c
        .find(
          { $or: [{ shadow: { $ne: true }, engine: 2, spottedAt: { $gt: t0 - WINDOW_MS } }, { shadow: true, spottedAt: { $gt: t0 - 24 * 3_600_000 } }] },
          { projection: { address: 1, chain: 1 } },
        )
        .sort({ lastCheck: 1 })
        .limit(90)
        .toArray();
      if (!due.length) return;
      const chunks: typeof due[] = [];
      for (let k = 0; k < due.length; k += 30) chunks.push(due.slice(k, k + 30));
      const live = new Map<string, number>();
      for (const part of await Promise.all(chunks.map((ch) => liveMcaps(ch.map((d) => ({ address: d.address, chain: d.chain })))))) {
        for (const [k, v] of part) live.set(k, v);
      }
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
  const filter = mint
    ? { address: EVM_ADDR_RE.test(mint) ? mint.toLowerCase() : mint, shadow: { $ne: true }, engine: 2 }
    : { spottedAt: { $gt: Date.now() - WINDOW_MS }, shadow: { $ne: true }, engine: 2 };
  const docs = await c.find(filter, { projection: { _id: 0, features: 0, buyers: 0 } }).sort({ spottedAt: -1 }).limit(limit).toArray();
  return docs as SignalCall[];
}
