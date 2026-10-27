// lib/signalIntel.ts  (server only)
// "Wraith Intelligence": leading signals that the plain market data cannot give us.
//   1. Dev history      who launched this token and what happened to their earlier launches
//   2. Order flow       who is buying right now (unique buyers, whale-led buys, buyer acceleration, bundled launches)
//   3. Proven wallets   how many of the buyers are wallets that keep showing up early in winners (learned in lib/walletLearn.ts)
// Everything here fails soft: if a source is down the token simply gets no adjustment from it.

import { getDb } from "@/lib/mongoClient";
import { fetchTokenSwaps, type Swap } from "@/lib/heliusSwaps";
import { SOLANA_MINT_RE, type MarketToken } from "@/lib/market";
import type { ScanMeta } from "@/lib/scannerSources";

export interface DevIntel { creator: string; created: number; graduated: number; dead: number; recent7d: number }
export interface FlowIntel { buyers: number; buys: number; sells: number; top3Share: number; accel: number; netSol: number; bundled: number; windowMin: number }
export interface SmartIntel { smart: number; dumpers: number }
export interface SignalIntel {
  dev?: DevIntel;
  flow?: FlowIntel;
  smart?: SmartIntel;
  /** unique buyer wallets seen (oldest first). Server side only: stripped from API responses. */
  buyers?: string[];
  adj: number;
  block?: string;
  at: number;
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ── 1. dev history (pump.fun) ───────────────────────────────────────────────────────────────────────────────
const PUMP_BASES = (process.env.PUMP_API_BASES || "https://frontend-api-v3.pump.fun,https://frontend-api.pump.fun").split(",").map((s) => s.trim()).filter(Boolean);

async function pumpJson(path: string): Promise<unknown> {
  for (const base of PUMP_BASES) {
    try {
      const res = await fetch(`${base}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3500), cache: "no-store" });
      if (res.ok) return await res.json();
    } catch { /* try the next base */ }
  }
  return null;
}

const devByMint = new Map<string, { ts: number; v: DevIntel | null }>();
const devByCreator = new Map<string, { ts: number; v: Omit<DevIntel, "creator"> | null }>();

/** Parse a pump.fun "coins created by this wallet" list. Pure, exported for tests. */
export function parseDevCoins(list: unknown, currentMint: string, now = Date.now()): Omit<DevIntel, "creator"> {
  const rows = Array.isArray(list) ? list : Array.isArray(o(list).coins) ? (o(list).coins as unknown[]) : [];
  let created = 0, graduated = 0, dead = 0, recent7d = 0;
  for (const raw of rows) {
    const r = o(raw);
    if (r.mint === currentMint) continue;
    created++;
    const ts = Number(r.created_timestamp);
    const ageMs = Number.isFinite(ts) && ts > 0 ? now - (ts < 1e12 ? ts * 1000 : ts) : NaN;
    if (Number.isFinite(ageMs) && ageMs < 7 * 86_400_000) recent7d++;
    if (r.complete === true) { graduated++; continue; }
    const usd = Number(r.usd_market_cap);
    if (Number.isFinite(usd) && usd < 5_000 && Number.isFinite(ageMs) && ageMs > 2 * 3_600_000) dead++;
  }
  return { created, graduated, dead, recent7d };
}

export async function devIntel(mint: string): Promise<DevIntel | null> {
  if (!mint.endsWith("pump")) return null;
  const hit = devByMint.get(mint);
  if (hit && Date.now() - hit.ts < 10 * 60_000) return hit.v;
  let out: DevIntel | null = null;
  try {
    const coin = o(await pumpJson(`/coins/${mint}`));
    const creator = typeof coin.creator === "string" ? coin.creator : "";
    if (SOLANA_MINT_RE.test(creator)) {
      const cached = devByCreator.get(creator);
      let stats = cached && Date.now() - cached.ts < 6 * 3_600_000 ? cached.v : null;
      if (!stats) {
        const list = await pumpJson(`/coins/user-created-coins/${creator}?offset=0&limit=50&includeNsfw=true`);
        if (list) { stats = parseDevCoins(list, mint); devByCreator.set(creator, { ts: Date.now(), v: stats }); }
      }
      if (stats) out = { creator, ...stats };
    }
  } catch { /* soft */ }
  devByMint.set(mint, { ts: Date.now(), v: out });
  if (devByMint.size > 600) devByMint.clear();
  return out;
}

// ── 2. order flow (Helius swaps) ──────────────────────────────────────────────────────────────────────────
/** Pure: turn raw swaps into flow numbers + the list of buyer wallets (oldest first). Exported for tests. */
export function computeFlow(swaps: Swap[], now = Date.now()): { flow: FlowIntel; buyers: string[] } | null {
  if (swaps.length < 8) return null;
  const sorted = [...swaps].sort((a, b) => a.ts - b.ts);
  const buys = sorted.filter((s) => s.side === "buy");
  const sells = sorted.filter((s) => s.side === "sell");
  const spend = new Map<string, number>();
  for (const b of buys) spend.set(b.wallet, (spend.get(b.wallet) ?? 0) + b.sol);
  const totalBuy = [...spend.values()].reduce((a, b) => a + b, 0);
  const top3 = [...spend.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  const t5 = now - 5 * 60_000, t10 = now - 10 * 60_000, t15 = now - 15 * 60_000;
  const b5 = buys.filter((s) => s.ts >= t5).length;
  const b10 = buys.filter((s) => s.ts < t5 && s.ts >= t10).length;
  const net = buys.filter((s) => s.ts >= t15).reduce((a, s) => a + s.sol, 0) - sells.filter((s) => s.ts >= t15).reduce((a, s) => a + s.sol, 0);
  const first = sorted[0].ts;
  const complete = swaps.length <= 90; // history reaches back to the first trade
  const bundled = complete ? new Set(buys.filter((s) => s.ts - first <= 4_000).map((s) => s.wallet)).size : 0;
  const buyers: string[] = [];
  const seen = new Set<string>();
  for (const b of buys) if (b.wallet && !seen.has(b.wallet)) { seen.add(b.wallet); buyers.push(b.wallet); }
  return {
    flow: {
      buyers: seen.size, buys: buys.length, sells: sells.length,
      top3Share: totalBuy > 0 ? top3 / totalBuy : 0,
      accel: (b5 + 1) / (b10 + 1),
      netSol: net, bundled,
      windowMin: Math.round((now - first) / 60_000),
    },
    buyers: buyers.slice(-80),
  };
}

// ── 3. proven wallets (learned in lib/walletLearn.ts) ─────────────────────────────────────────────────────────
export const SMART_MIN_N = 3;
export function isSmart(s: { n?: number; wins?: number }): boolean {
  return (s.n ?? 0) >= SMART_MIN_N && (s.wins ?? 0) / (s.n ?? 1) >= 0.3;
}
export function isDumper(s: { n?: number; dumps?: number }): boolean {
  return (s.n ?? 0) >= 4 && (s.dumps ?? 0) / (s.n ?? 1) >= 0.75;
}

async function smartIntel(wallets: string[]): Promise<SmartIntel | null> {
  if (!wallets.length) return null;
  try {
    const db = await getDb();
    const rows = await db.collection<{ _id: string; n?: number; wins?: number; dumps?: number }>("wallet_stats")
      .find({ _id: { $in: wallets.slice(-80) } }, { projection: { n: 1, wins: 1, dumps: 1 } }).toArray();
    return { smart: rows.filter(isSmart).length, dumpers: rows.filter(isDumper).length };
  } catch { return null; }
}

// ── scoring ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Pure: how much the intel moves the score, plus tags / risks / a hard block reason. Exported for tests. */
export function scoreIntel(i: Pick<SignalIntel, "dev" | "flow" | "smart">): { adj: number; tags: string[]; risks: string[]; block?: string } {
  let adj = 0;
  const tags: string[] = [], risks: string[] = [];
  let block: string | undefined;
  const { dev, flow, smart } = i;
  if (dev) {
    if (dev.graduated >= 2) { adj += 8; tags.push(`Dev: ${dev.graduated} graduated`); }
    else if (dev.graduated === 1) { adj += 4; tags.push("Dev graduated before"); }
    if (dev.graduated === 0 && dev.dead >= 5) { adj -= 15; risks.push(`Dev: ${dev.dead} dead launches`); }
    if (dev.graduated === 0 && dev.recent7d >= 8) { block = "Serial launcher"; risks.push(`Dev launched ${dev.recent7d} in 7d`); }
  }
  if (flow) {
    if (flow.top3Share > 0.5 && flow.buys >= 10) { adj -= 6; risks.push(`Top 3 buyers ${Math.round(flow.top3Share * 100)}%`); }
    if (flow.buyers < 12 && flow.buys > 40) { adj -= 8; risks.push("Few buyers, many buys"); }
    if (flow.bundled >= 5) { adj -= 8; risks.push("Bundled launch"); }
    if (flow.accel >= 2 && flow.buyers >= 20) { adj += 6; tags.push("Buyers accelerating"); }
    if (flow.netSol > 3) { adj += 3; tags.push("Net inflow"); }
    else if (flow.netSol < -3) { adj -= 4; risks.push("Net outflow"); }
    if (flow.buyers >= 60) { adj += 3; tags.push(`${flow.buyers} buyers`); }
  }
  if (smart) {
    if (smart.smart >= 3) { adj += 12; tags.push(`${smart.smart} proven wallets in`); }
    else if (smart.smart === 2) { adj += 8; tags.push("2 proven wallets in"); }
    else if (smart.smart === 1) { adj += 4; tags.push("1 proven wallet in"); }
    if (smart.dumpers >= 5) { block = block ?? "Repeat dumper wallets"; risks.push(`${smart.dumpers} repeat-dumper wallets`); }
    else if (smart.dumpers >= 3) { adj -= 12; risks.push(`${smart.dumpers} repeat-dumper wallets`); }
  }
  return { adj, tags, risks, block };
}

// ── orchestration ───────────────────────────────────────────────────────────────────────────────────────────
export interface Enrichable {
  token: MarketToken;
  score: number;
  tags: string[];
  risks: string[];
  intel?: SignalIntel;
}

const intelCache = new Map<string, { ts: number; intel: SignalIntel }>();
const INTEL_TTL = 120_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function buildIntel(mint: string): Promise<SignalIntel> {
  const [dev, swaps] = await Promise.all([devIntel(mint), fetchTokenSwaps(mint, 2)]);
  const fl = swaps ? computeFlow(swaps) : null;
  const smart = fl ? await smartIntel(fl.buyers) : null;
  const parts = { dev: dev ?? undefined, flow: fl?.flow, smart: smart ?? undefined };
  const sc = scoreIntel(parts);
  return { ...parts, buyers: fl?.buyers, adj: sc.adj, block: sc.block, at: Date.now() };
}

function apply(s: Enrichable, intel: SignalIntel) {
  const sc = scoreIntel(intel);
  s.intel = intel;
  s.score = Math.round(clamp(s.score + intel.adj, 0, 100));
  for (const t of sc.tags) if (!s.tags.includes(t)) s.tags.push(t);
  for (const r of sc.risks) if (!s.risks.includes(r)) s.risks.push(r);
  s.tags = s.tags.slice(0, 6);
  s.risks = s.risks.slice(0, 4);
}

/**
 * Adds dev / flow / proven-wallet intel to the best Solana candidates (mutates). Helius is rate limited, so: top N only,
 * a small worker pool, a 2 minute cache, and a time budget (unfinished tokens are picked up by the next poll).
 */
export async function enrichSignals(signals: Enrichable[], opts: { max?: number; minScore?: number; concurrency?: number; budgetMs?: number } = {}): Promise<void> {
  const { max = 12, minScore = 45, concurrency = 3, budgetMs = 5_000 } = opts;
  const cands = signals
    .filter((s) => (!s.token.chain || s.token.chain === "solana") && SOLANA_MINT_RE.test(s.token.address) && s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
  const todo: Enrichable[] = [];
  for (const s of cands) {
    const c = intelCache.get(s.token.address);
    if (c && Date.now() - c.ts < INTEL_TTL) apply(s, c.intel);
    else todo.push(s);
  }
  if (!todo.length) return;
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const s = todo[i++];
      try {
        const intel = await buildIntel(s.token.address);
        intelCache.set(s.token.address, { ts: Date.now(), intel });
        apply(s, intel);
      } catch (e) { console.warn("[signalIntel]", s.token.address.slice(0, 6), e instanceof Error ? e.message : e); }
    }
  };
  await Promise.race([Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker)), sleep(budgetMs)]);
  if (intelCache.size > 500) for (const [k, v] of intelCache) if (Date.now() - v.ts > 600_000) intelCache.delete(k);
}

// ── feature snapshot (stored with every call so we can measure what actually predicts wins) ─────────────────────────
export function featuresOf(t: MarketToken, meta: ScanMeta, intel: SignalIntel | undefined, now = Date.now()): Record<string, number | null> {
  const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
  const tx = t.txns.buys + t.txns.sells;
  const buyShare = meta.buyVol1h !== undefined && meta.sellVol1h !== undefined && meta.buyVol1h + meta.sellVol1h > 0
    ? meta.buyVol1h / (meta.buyVol1h + meta.sellVol1h)
    : tx >= 20 ? t.txns.buys / tx : null;
  return {
    h1: n(t.change.h1), m5: n(t.change.m5), h6: n(t.change.h6), h24: n(t.change.h24),
    volRatio: n(t.mcap > 0 ? t.volume.h1 / t.mcap : null), buyShare: n(buyShare),
    liq: n(t.liquidity), liqRatio: n(t.mcap > 0 ? t.liquidity / t.mcap : null), mcap: n(t.mcap),
    ageMin: n(t.createdAt ? (now - t.createdAt) / 60_000 : null), curve: n(t.curveProgress), grad: t.graduated ? 1 : 0,
    holders: n(meta.holders), organic: n(meta.organicScore), topHolders: n(meta.topHoldersPct), devPct: n(meta.devPct), traders1h: n(meta.traders1h),
    flowBuyers: n(intel?.flow?.buyers), flowAccel: n(intel?.flow?.accel), top3Share: n(intel?.flow?.top3Share), bundled: n(intel?.flow?.bundled), netSol: n(intel?.flow?.netSol),
    devCreated: n(intel?.dev?.created), devGraduated: n(intel?.dev?.graduated), devDead: n(intel?.dev?.dead), devRecent7d: n(intel?.dev?.recent7d),
    smart: n(intel?.smart?.smart), dumpers: n(intel?.smart?.dumpers), intelAdj: n(intel?.adj),
  };
}
