// Parsed on-chain swaps via Helius (the RPC you already pay for). Fast, includes pump.fun curve + PumpSwap + Raydium etc.
// Used as the primary source for the Swaps tab and as an OHLCV source when GeckoTerminal / Birdeye are limited.
import { PublicKey } from "@solana/web3.js";
import { getSolUsd, resolvePool } from "@/lib/marketProviders";

export interface Swap {
  sig: string;
  ts: number; // ms
  side: "buy" | "sell";
  tokens: number;
  sol: number;
  priceSol: number;
  wallet: string;
}

const WSOL = "So11111111111111111111111111111111111111112";
export function heliusKey(): string | null {
  const urls = [process.env.SOLANA_RPC_URL, process.env.NEXT_PUBLIC_SOLANA_RPC].filter(Boolean) as string[];
  for (const u of urls) {
    try { const k = new URL(u).searchParams.get("api-key"); if (k) return k; } catch { /* next */ }
  }
  return process.env.HELIUS_API_KEY ?? null;
}
export function heliusRpcUrl(): string | null {
  const urls = [process.env.SOLANA_RPC_URL, process.env.NEXT_PUBLIC_SOLANA_RPC].filter(Boolean) as string[];
  return urls.find((u) => u.includes("helius-rpc.com")) ?? null;
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const n = (v: unknown): number => { const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN; return Number.isFinite(x) ? x : 0; };
const tokAmt = (t: Obj): number => {
  const raw = o(t.rawTokenAmount);
  if (raw.tokenAmount !== undefined) return n(raw.tokenAmount) / 10 ** n(raw.decimals);
  return n(t.tokenAmount);
};

function parse(tx: Obj, mint: string): Swap | null {
  const sw = o(o(tx.events).swap);
  const ins = a(sw.tokenInputs).map(o), outs = a(sw.tokenOutputs).map(o);
  const nIn = n(o(sw.nativeInput).amount) / 1e9, nOut = n(o(sw.nativeOutput).amount) / 1e9;
  const wIn = ins.filter((t) => t.mint === WSOL).reduce((s, t) => s + tokAmt(t), 0);
  const wOut = outs.filter((t) => t.mint === WSOL).reduce((s, t) => s + tokAmt(t), 0);
  const bought = outs.filter((t) => t.mint === mint).reduce((s, t) => s + tokAmt(t), 0);
  const sold = ins.filter((t) => t.mint === mint).reduce((s, t) => s + tokAmt(t), 0);
  const ts = n(tx.timestamp) * 1000;
  const sig = String(tx.signature ?? "");
  if (!ts || !sig) return null;
  const wallet = String(tx.feePayer ?? "");
  if (bought > 0 && sold === 0) {
    const sol = nIn || wIn;
    return sol > 0 ? { sig, ts, side: "buy", tokens: bought, sol, priceSol: sol / bought, wallet } : null;
  }
  if (sold > 0 && bought === 0) {
    const sol = nOut || wOut;
    return sol > 0 ? { sig, ts, side: "sell", tokens: sold, sol, priceSol: sol / sold, wallet } : null;
  }
  return null;
}

/** Newest-first swaps of a mint. `pages` x 100 transactions. Returns null if Helius is unavailable. */
export async function fetchSwaps(mint: string, pages = 1, address?: string | null): Promise<Swap[] | null> {
  const key = heliusKey();
  if (!key) return null;
  const out: Swap[] = [];
  let before = "";
  for (let i = 0; i < pages; i++) {
    const url = `https://api.helius.xyz/v0/addresses/${address || mint}/transactions?api-key=${key}&type=SWAP&limit=100${before ? `&before=${before}` : ""}`;
    let rows: Obj[];
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(7000), cache: "no-store" });
      if (!res.ok) { console.warn("[helius swaps]", res.status, (await res.text().catch(() => "")).slice(0, 160)); return out.length ? out : null; }
      rows = a(await res.json()).map(o);
    } catch (e) { console.warn("[helius swaps] failed:", e instanceof Error ? e.message : e); return out.length ? out : null; }
    if (!rows.length) break;
    for (const r of rows) { const s = parse(r, mint); if (s) out.push(s); }
    before = String(rows[rows.length - 1].signature ?? "");
    if (rows.length < 100 || !before) break;
  }
  return out;
}

export async function swapsToCandles(swaps: Swap[], sec: number): Promise<{ t: number; o: number; h: number; l: number; c: number; v: number }[]> {
  const solUsd = await getSolUsd();
  const step = sec * 1000;
  const sorted = [...swaps].sort((x, y) => x.ts - y.ts);
  const map = new Map<number, { t: number; o: number; h: number; l: number; c: number; v: number }>();
  for (const s of sorted) {
    const t = Math.floor(s.ts / step) * step;
    const p = s.priceSol * solUsd;
    const cur = map.get(t);
    if (!cur) map.set(t, { t, o: p, h: p, l: p, c: p, v: s.sol * solUsd });
    else { cur.h = Math.max(cur.h, p); cur.l = Math.min(cur.l, p); cur.c = p; cur.v += s.sol * solUsd; }
  }
  return [...map.values()];
}

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
function curvePda(mint: string): string | null {
  try { return PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], new PublicKey(PUMP_PROGRAM))[0].toBase58(); } catch { return null; }
}
const swapCache = new Map<string, { ts: number; swaps: Swap[] }>();

/**
 * Fast swaps for any token: asks Helius about the pump.fun bonding curve, the mint and the pool at the same time and
 * returns the first non-empty answer. No indexer (DexScreener / Gecko) sits in front of it, so a token that is 1-2
 * minutes old answers as fast as an old one.
 */
export async function fetchTokenSwaps(mint: string, pages = 2): Promise<Swap[] | null> {
  const hit = swapCache.get(mint);
  if (hit && Date.now() - hit.ts < 2500) return hit.swaps;
  const tries: Promise<Swap[]>[] = [];
  const nonEmpty = (p: Promise<Swap[] | null>) => p.then((r) => { if (!r || !r.length) throw new Error("empty"); return r; });
  const curve = mint.endsWith("pump") ? curvePda(mint) : null;
  if (curve) tries.push(nonEmpty(fetchSwaps(mint, pages, curve)));
  tries.push(nonEmpty(fetchSwaps(mint, pages)));
  tries.push(nonEmpty((async () => {
    const pool = await Promise.race([resolvePool(mint).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
    return pool ? fetchSwaps(mint, pages, pool) : null;
  })()));
  try {
    const swaps = await Promise.any(tries);
    swapCache.set(mint, { ts: Date.now(), swaps });
    if (swapCache.size > 200) swapCache.clear();
    return swaps;
  } catch { return null; }
}
