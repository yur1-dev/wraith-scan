/**
 * Rebuilds the REAL price path after each call from candle data, so labels stop depending on when the refresh job happened to look.
 *   npx tsx scripts/relabel-paths.ts [max=100] [--all]      (resumable: results are kept in scripts/.pilot/paths.json)
 * For each call older than 26h it finds the pool (DexScreener, then GeckoTerminal) and reads 5-minute candles from 1h before the
 * call to 24h after it. From those it computes: the true peak and trough, when the price first doubled and when it first lost half,
 * whether it doubled BEFORE losing half ("clean 2x"), and the price at +1h / +6h / +24h. Read-only on the database, no Helius credits.
 * Pace: GeckoTerminal's free tier allows ~30 requests a minute, so this takes a while for thousands of calls. It is safe to stop and rerun.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "scripts/.pilot/paths.json";
// With a free CoinGecko demo key (COINGECKO_DEMO_KEY in .env.local) the limit follows the KEY (30/min), not this connection, so it is
// not shared with your dev server. Without a key it falls back to GeckoTerminal's shared, much smaller allowance.
const CG_KEY = (process.env.COINGECKO_DEMO_KEY ?? "").trim();
const GECKO = CG_KEY ? "https://api.coingecko.com/api/v3/onchain/networks/solana" : "https://api.geckoterminal.com/api/v2/networks/solana";
const H: Record<string, string> = CG_KEY ? { accept: "application/json", "x-cg-demo-api-key": CG_KEY } : { accept: "application/json;version=20230302" };
const MAX = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 100);
const GAP_MS = Number(process.env.GAP_MS ?? (CG_KEY ? 2300 : 15000)); // ~11 requests a minute: GeckoTerminal's free limit is shared with anything else on this connection (your dev server)

export interface PathRec {
  addr: string; pool: string | null; ok: boolean; n: number;
  p0: number; peak1h: number; peak6h: number; peak24h: number; trough24h: number;
  first2xMin: number | null; firstHalfMin: number | null; clean2x: boolean; clean15x: boolean;
  r1h: number | null; r6h: number | null; r24h: number | null; maxDrawBeforePeak: number;
}
type Candle = [number, number, number, number, number, number]; // t(sec), o, h, l, c, v
let nextAt = 0;
async function gecko(url: string): Promise<{ s: number; j: unknown }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = Math.max(0, nextAt - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    nextAt = Date.now() + GAP_MS;
    const res = await fetch(url, { headers: H, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!res) continue;
    if (res.status === 429) { nextAt = Date.now() + 25_000; continue; } // brief pause: this connection's allowance is shared and refills quickly
    return { s: res.status, j: await res.json().catch(() => null) };
  }
  return { s: 0, j: null };
}

async function pools(addrs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < addrs.length; i += 30) {
    const part = addrs.slice(i, i + 30);
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${part.join(",")}`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!res?.ok) continue;
    const pairs = (await res.json()) as { baseToken?: { address?: string }; pairAddress?: string; liquidity?: { usd?: number } }[];
    const best = new Map<string, { p: string; l: number }>();
    for (const p of pairs) {
      const a = p.baseToken?.address;
      if (!a || !p.pairAddress) continue;
      const l = p.liquidity?.usd ?? 0;
      if (!best.has(a) || l > best.get(a)!.l) best.set(a, { p: p.pairAddress, l });
    }
    for (const [a, v] of best) out.set(a, v.p);
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

async function candlesFor(pool: string, t0Sec: number): Promise<Candle[]> {
  const before = t0Sec + 24 * 3600 + 300;
  const u = `${GECKO}/pools/${pool}/ohlcv/minute?aggregate=5&limit=300&currency=usd&token=base&include_empty_intervals=false&before_timestamp=${before}`;
  const r = await gecko(u);
  if (r.s !== 200) return [];
  const list = (((r.j as { data?: { attributes?: { ohlcv_list?: unknown[] } } })?.data?.attributes?.ohlcv_list) ?? []) as unknown[];
  return list.filter((x): x is Candle => Array.isArray(x) && x.length >= 6).sort((a, b) => a[0] - b[0]);
}

export function pathStats(addr: string, pool: string, c: Candle[], t0Sec: number): PathRec {
  const empty: PathRec = { addr, pool, ok: false, n: c.length, p0: 0, peak1h: 0, peak6h: 0, peak24h: 0, trough24h: 0, first2xMin: null, firstHalfMin: null, clean2x: false, clean15x: false, r1h: null, r6h: null, r24h: null, maxDrawBeforePeak: 0 };
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
  return { addr, pool, ok: true, n: after.length, p0, peak1h: peak1, peak6h: peak6, peak24h: peak24, trough24h: trough, first2xMin: first2, firstHalfMin: firstHalf, clean2x: clean2, clean15x: clean15, r1h: at1(60), r6h: at1(360), r24h: at1(1440), maxDrawBeforePeak: maxDraw };
}

async function main() {
  mkdirSync("scripts/.pilot", { recursive: true });
  const done: Record<string, PathRec> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const calls = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ badData: { $ne: true }, spottedMcap: { $gt: 0 }, spottedAt: { $lt: Date.now() - 26 * 3_600_000 }, address: { $regex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ }, chain: { $in: [null, "solana"] } },
      { projection: { address: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, engine: 1, shadow: 1 } }).sort({ spottedAt: -1 }).toArray();
  await c.close();
  // public engine-2 calls first (they are what the record and the model use), then shadow calls
  const todo = calls.filter((x) => !done[x.address as string]).sort((a, b) => Number(b.engine === 2 && !b.shadow) - Number(a.engine === 2 && !a.shadow) || (b.spottedAt as number) - (a.spottedAt as number)).slice(0, MAX);
  console.log(`${calls.length} eligible calls, ${Object.keys(done).length} already done, doing ${todo.length}`);
  const poolMap = await pools(todo.map((x) => x.address as string));
  console.log(`pools found by DexScreener for ${poolMap.size}/${todo.length}`);
  let n = 0, noPool = 0, bad = 0;
  const cmp: { rec: number; truth: number }[] = [];
  for (const t of todo) {
    const addr = t.address as string;
    let pool = poolMap.get(addr) ?? null;
    // no pair on DexScreener usually means the token is dead (pool gone): do not spend a scarce GeckoTerminal request on it
    if (!pool) { done[addr] = { addr, pool: null, ok: false, n: 0, p0: 0, peak1h: 0, peak6h: 0, peak24h: 0, trough24h: 0, first2xMin: null, firstHalfMin: null, clean2x: false, clean15x: false, r1h: null, r6h: null, r24h: null, maxDrawBeforePeak: 0 }; noPool++; continue; }
    const candles = await candlesFor(pool, Math.floor((t.spottedAt as number) / 1000));
    const t0s = Math.floor((t.spottedAt as number) / 1000);
    const rec = pathStats(addr, pool, candles, t0s);
    done[addr] = rec;
    if (rec.ok && rec.p0 > 0) {
      // the series after the call, as price ratios to the call price: [minutes after, open, high, low, close]. Used by scripts/optimize-exits.ts
      const series = candles.filter((k) => k[0] >= t0s - 300 && k[0] <= t0s + 24 * 3600).map((k) => [Math.round((k[0] - t0s) / 60), +(k[1] / rec.p0).toFixed(4), +(k[2] / rec.p0).toFixed(4), +(k[3] / rec.p0).toFixed(4), +(k[4] / rec.p0).toFixed(4)]);
      appendFileSync("scripts/.pilot/candles.jsonl", JSON.stringify({ addr, at: t.spottedAt, engine: t.engine ?? null, shadow: !!t.shadow, s: series }) + "\n");
    }
    if (!rec.ok) bad++; else cmp.push({ rec: Math.max(t.peakMcap as number, t.lastMcap as number) / (t.spottedMcap as number), truth: rec.peak24h });
    n++;
    if (n % 20 === 0) {
      writeFileSync(OUT, JSON.stringify(done));
      const miss = cmp.filter((x) => x.rec < 2 && x.truth >= 2).length, tw = cmp.filter((x) => x.truth >= 2).length, rw = cmp.filter((x) => x.rec >= 2).length;
      console.log(`  ${n}/${todo.length} done (${noPool} without a pool, ${bad} too few candles) | recorded winners ${rw}, true winners ${tw}, missed by the refresh job ${miss}`);
    }
  }
  writeFileSync(OUT, JSON.stringify(done));
  console.log(`\nfinished: ${n} with candles, ${noPool} without a pool, ${bad} too few candles. Total stored ${Object.keys(done).length}`);
  if (cmp.length >= 10) {
    const recWin = cmp.filter((x) => x.rec >= 2).length, truthWin = cmp.filter((x) => x.truth >= 2).length;
    const missed = cmp.filter((x) => x.rec < 2 && x.truth >= 2).length, phantom = cmp.filter((x) => x.rec >= 2 && x.truth < 2).length;
    console.log(`\nLABEL CHECK on ${cmp.length} calls: recorded as 2x winners ${recWin}, true 2x winners (peak within 24h from candles) ${truthWin}`);
    console.log(`  winners the refresh job MISSED (really doubled, recorded below 2x): ${missed}`);
    console.log(`  recorded as winners but the candles do not show 2x in the first 24h: ${phantom}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
