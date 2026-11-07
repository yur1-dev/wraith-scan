/**
 * Model research harness. Compares ideas ONLY on calls the model never saw, the same way every time:
 *   - walk-forward: train on the past, score the next block, repeat over 6 blocks (starting at 40% of the history)
 *   - a 24h gap between the end of training and the start of each test block, so no training label is still "in flight"
 *   - every idea is scored on identical blocks, so differences are paired; a bootstrap gives a 95% range for the change vs baseline
 *   npx tsx scripts/research-model2.ts [groups]       groups: base,tune,feat,target,ens (default: all)
 * Read-only (database reads only). Takes a while: it fits a few hundred small models.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { existsSync, readFileSync } from "node:fs";
import { auc, fitTrees, rawVector, scoreTrees, TREE_DEFAULTS, type Features, type TreeOpts } from "../lib/signalModel";

interface Call { address: string; symbol: string; name: string; at: number; f: Features; ratioPeak: number; legacyPeak: number; hasPath: boolean; ratioLast: number; score: number | null; tier: string }
const H = 3_600_000;
const PATHS = process.argv.includes("--paths"); // use REAL price paths (candles / on-chain trades) to correct each call's peak
const GROUPS = new Set((process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "base,tune,feat,target,ens").split(","));

// ── data ─────────────────────────────────────────────────────────────────────────────────────
async function load(): Promise<Call[]> {
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const docs = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, features: { $exists: true }, spottedAt: { $lt: Date.now() - 24 * H } },
      { projection: { address: 1, symbol: 1, name: 1, features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, score: 1, tier: 1 } }).sort({ spottedAt: 1 }).toArray();
  await c.close();
  // real paths: GeckoTerminal candles, and the on-chain-trade rebuild; for each call keep the one covering more of the day
  const load = (f: string) => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, { ok: boolean; peak24h: number; coverMin?: number }>) : {});
  const g = load("scripts/.pilot/paths.json"), h = load("scripts/.pilot/paths-helius.json");
  const pathOf = (a: string) => { const x = g[a], y = h[a]; if (x?.ok && (!y?.ok || (x.coverMin ?? 1440) >= (y.coverMin ?? 1440))) return x; return y?.ok ? y : null; };
  return docs.map((d) => {
    const legacy = Math.max(d.peakMcap as number, d.lastMcap as number) / (d.spottedMcap as number);
    const p = PATHS ? pathOf(d.address as string) : null;
    return {
      address: d.address as string, symbol: String(d.symbol ?? ""), name: String(d.name ?? ""), at: d.spottedAt as number, f: (d.features ?? {}) as Features,
      ratioPeak: p ? Math.max(legacy, p.peak24h) : legacy, legacyPeak: legacy, hasPath: !!p, ratioLast: (d.lastMcap as number) / (d.spottedMcap as number),
      score: typeof d.score === "number" ? d.score : null, tier: String(d.tier ?? ""),
    };
  });
}

// ── regime / rank / theme features, each computed from calls BEFORE the one being described ─────
const STOP = new Set(["the", "coin", "token", "of", "and", "for", "inu", "sol", "solana", "pump", "fun", "meme", "official", "new"]);
const words = (c: Call) => new Set(`${c.symbol} ${c.name}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));
const RANK: [string, string][] = [["rkVol", "volRatio"], ["rkLiq", "liq"], ["rkH1", "h1"], ["rkM5", "m5"], ["rkTraders", "traders1h"], ["rkBuy", "buyShare"], ["rkMcap", "mcap"], ["rkHolders", "holders"], ["rkAge", "ageMin"]];

function withContext(calls: Call[]): Call[] {
  const win = (c: Call) => c.ratioPeak >= 2, col = (c: Call) => c.ratioLast <= 0.2;
  const gw = calls.filter(win).length / calls.length, gc = calls.filter(col).length / calls.length;
  const W = calls.map(words);
  const out: Call[] = [];
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const f: Features = { ...c.f };
    // regime: only calls that had matured (4h+) by the time of this one
    const reg = (lo: number) => { let n = 0, w = 0, k = 0; for (let j = i - 1; j >= 0; j--) { const d = calls[j]; if (d.at < c.at - lo * H) break; if (d.at > c.at - 4 * H) continue; n++; if (win(d)) w++; if (col(d)) k++; } return { n, w, k }; };
    const r12 = reg(16), r36 = reg(40);
    f.regWin12 = (r12.w + 10 * gw) / (r12.n + 10); f.regCol12 = (r12.k + 10 * gc) / (r12.n + 10); f.regN12 = r12.n; f.regWin36 = (r36.w + 10 * gw) / (r36.n + 10);
    // rank vs the previous 24h of calls (features are known at call time, no outcome needed)
    for (const [key, src] of RANK) {
      const v = c.f[src];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      let below = 0, tot = 0;
      for (let j = i - 1; j >= 0; j--) { const d = calls[j]; if (d.at < c.at - 24 * H) break; const x = d.f[src]; if (typeof x !== "number" || !Number.isFinite(x)) continue; tot++; if (x < v) below++; }
      if (tot >= 15) f[key] = below / tot;
    }
    // theme: how did calls with a shared word in the last 48h (matured) turn out
    let tn = 0, tw = 0;
    if (W[i].size) for (let j = i - 1; j >= 0; j--) { const d = calls[j]; if (d.at < c.at - 48 * H) break; if (d.at > c.at - 4 * H) continue; let hit = false; for (const w of W[i]) if (W[j].has(w)) { hit = true; break; } if (hit) { tn++; if (win(d)) tw++; } }
    f.thN = tn; f.thWin = (tw + 4 * gw) / (tn + 4);
    out.push({ ...c, f });
  }
  return out;
}

// ── walk-forward ────────────────────────────────────────────────────────────────────────────
interface Fold { a: number; b: number }
function folds(n: number, k = 6): Fold[] {
  const start = Math.floor(n * 0.4), block = Math.floor((n - start) / k);
  return Array.from({ length: k }, (_, i) => ({ a: start + i * block, b: i === k - 1 ? n : start + (i + 1) * block }));
}
type Labeler = (c: Call) => number;
interface Result { name: string; scores: number[]; labels: number[]; foldAuc: number[]; idx: number[] }

function runConfig(name: string, calls: Call[], label: Labeler, o: TreeOpts, opts?: { cols?: number[]; w?: (c: Call) => number }): Result {
  const X = calls.map((c) => rawVector(c.f));
  const cols = opts?.cols;
  const Xs = cols ? X.map((r) => cols.map((j) => r[j])) : X;
  const y = calls.map(label);
  const scores: number[] = [], labels: number[] = [], idx: number[] = [], foldAuc: number[] = [];
  for (const { a, b } of folds(calls.length)) {
    const cut = calls[a].at - 24 * H;
    let m = 0; while (m < a && calls[m].at <= cut) m++; // 24h gap
    if (m < 200) continue;
    const w = opts?.w ? calls.slice(0, m).map(opts.w) : undefined;
    const { f0, trees } = fitTrees(Xs.slice(0, m), y.slice(0, m), o, w);
    const sc: number[] = [], yt: number[] = [];
    for (let i = a; i < b; i++) { const s = scoreTrees(f0, trees, Xs[i], o.lr); sc.push(s); yt.push(y[i]); scores.push(s); labels.push(y[i]); idx.push(i); }
    foldAuc.push(auc(sc, yt));
  }
  return { name, scores, labels, foldAuc, idx };
}
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

/** AUC of a result against ANY label set (e.g. a model trained on 1.5x, judged on 2x) */
function aucAgainst(r: Result, calls: Call[], label: Labeler): number { return auc(r.scores, r.idx.map((i) => label(calls[i]))); }
function boot(base: Result, r: Result, calls: Call[], label: Labeler, n = 300): [number, number] {
  const y = r.idx.map((i) => label(calls[i]));
  const d: number[] = [];
  for (let b = 0; b < n; b++) {
    const k = Array.from({ length: y.length }, () => Math.floor(Math.random() * y.length));
    const lab = k.map((i) => y[i]);
    if (!lab.some((v) => v) || !lab.some((v) => !v)) continue;
    d.push(auc(k.map((i) => r.scores[i]), lab) - auc(k.map((i) => base.scores[i]), lab));
  }
  d.sort((p, q) => p - q);
  return [d[Math.floor(d.length * 0.025)], d[Math.floor(d.length * 0.975)]];
}
function topRate(r: Result, calls: Call[], label: Labeler, frac: number): number {
  const order = r.idx.map((_, k) => k).sort((p, q) => r.scores[q] - r.scores[p]).slice(0, Math.max(10, Math.floor(r.idx.length * frac)));
  return mean(order.map((k) => label(calls[r.idx[k]])));
}
function report(base: Result | null, r: Result, calls: Call[], judge: Labeler) {
  const a = aucAgainst(r, calls, judge);
  const delta = base ? ` | change ${(a - aucAgainst(base, calls, judge) >= 0 ? "+" : "")}${(a - aucAgainst(base, calls, judge)).toFixed(3)} [${boot(base, r, calls, judge).map((v) => v.toFixed(3)).join(", ")}]` : "";
  const verdict = base ? (boot(base, r, calls, judge)[0] > 0 ? " <- REAL gain" : boot(base, r, calls, judge)[1] < 0 ? " <- worse" : " <- not proven") : "";
  console.log(`${r.name.padEnd(34)} AUC ${a.toFixed(3)} | folds ${mean(r.foldAuc).toFixed(3)}±${sd(r.foldAuc).toFixed(3)} | top10% hit ${(topRate(r, calls, judge, 0.1) * 100).toFixed(1)}%${delta}${verdict}`);
}

async function main() {
  let raw = await load();
  if (PATHS) {
    const n0 = raw.length;
    raw = raw.filter((c) => c.hasPath);
    console.log(`PATH MODE: ${raw.length} of ${n0} calls have a real price path; using only those, with the 24h peak taken from the path`);
    if (raw.length < 400) { console.log("Fewer than 400 calls with paths: results below are only a preview. Let the path jobs run longer for firm answers."); }
    if (raw.length < 150) return;
  }
  console.log(`${raw.length} calls (engine 2, older than 24h), ${new Date(raw[0].at).toISOString().slice(0, 10)} to ${new Date(raw[raw.length - 1].at).toISOString().slice(0, 10)}`);
  const L2: Labeler = (c) => (c.ratioPeak >= 2 ? 1 : 0);
  console.log(`2x winners ${raw.filter((c) => L2(c)).length} (${(mean(raw.map(L2)) * 100).toFixed(1)}%), collapsed ${raw.filter((c) => c.ratioLast <= 0.2).length}`);
  const ctx = withContext(raw);
  const t0 = Date.now();

  console.log("\n== BASELINE ==");
  const base = runConfig("baseline (live settings)", raw, L2, TREE_DEFAULTS);
  report(null, base, raw, L2);
  if (PATHS) {
    // the same model trained on the OLD sparse labels, but judged against the corrected ones: how much did the label noise cost?
    const Lold: Labeler = (c) => (c.legacyPeak >= 2 ? 1 : 0);
    report(base, runConfig("trained on OLD (sparse) labels", raw, Lold, TREE_DEFAULTS), raw, L2);
    console.log(`  (2x winners by the old labels ${raw.filter((c) => c.legacyPeak >= 2).length}, by the corrected labels ${raw.filter((c) => c.ratioPeak >= 2).length}, of ${raw.length} calls)`);
  }
  if (raw.some((c) => c.score !== null)) {
    const sc: Result = { name: "scanner score alone", scores: base.idx.map((i) => raw[i].score ?? 0), labels: base.labels, foldAuc: [], idx: base.idx };
    report(null, sc, raw, L2);
  }

  if (GROUPS.has("tune")) {
    console.log("\n== SETTINGS (same features, other tree settings) ==");
    const variants: [string, Partial<TreeOpts>][] = [
      ["depth 2", { depth: 2 }], ["depth 4", { depth: 4 }], ["minLeaf 20", { minLeaf: 20 }], ["minLeaf 80", { minLeaf: 80 }],
      ["lr .02 x400", { lr: 0.02, rounds: 400 }], ["lr .05 x120", { lr: 0.05, rounds: 120 }], ["lambda 30", { lambda: 30 }], ["lambda 60", { lambda: 60 }],
      ["subsample .5", { subsample: 0.5 }], ["depth 2, minLeaf 60, x400", { depth: 2, minLeaf: 60, rounds: 400, lr: 0.03 }], ["depth 3, minLeaf 80, lambda 30", { minLeaf: 80, lambda: 30 }], ["rounds 120", { rounds: 120 }],
    ];
    for (const [name, v] of variants) report(base, runConfig(name, raw, L2, { ...TREE_DEFAULTS, ...v }), raw, L2);
  }

  if (GROUPS.has("feat")) {
    console.log("\n== FEATURES (live settings) ==");
    const names = ctx[0] ? Object.keys(ctx[0].f) : [];
    void names;
    report(base, runConfig("+ market regime", ctx.map((c) => ({ ...c, f: Object.fromEntries(Object.entries(c.f).filter(([k]) => !/^(rk|th)/.test(k))) })), L2, TREE_DEFAULTS), raw, L2);
    report(base, runConfig("+ ranks vs last 24h", ctx.map((c) => ({ ...c, f: Object.fromEntries(Object.entries(c.f).filter(([k]) => !/^(reg|th)/.test(k))) })), L2, TREE_DEFAULTS), raw, L2);
    report(base, runConfig("+ name/theme history", ctx.map((c) => ({ ...c, f: Object.fromEntries(Object.entries(c.f).filter(([k]) => !/^(reg|rk)/.test(k))) })), L2, TREE_DEFAULTS), raw, L2);
    report(base, runConfig("+ all three", ctx, L2, TREE_DEFAULTS), raw, L2);
  }

  if (GROUPS.has("target")) {
    console.log("\n== WHAT TO LEARN (all judged against real 2x winners) ==");
    const L15: Labeler = (c) => (c.ratioPeak >= 1.5 ? 1 : 0);
    const Ldur: Labeler = (c) => (c.ratioPeak >= 2 && c.ratioLast >= 0.7 ? 1 : 0);
    const Lnc: Labeler = (c) => (c.ratioLast > 0.2 ? 1 : 0);
    report(base, runConfig("learn 1.5x (judged on 2x)", raw, L15, TREE_DEFAULTS), raw, L2);
    report(base, runConfig("learn 2x that held 70% (judged 2x)", raw, Ldur, TREE_DEFAULTS), raw, L2);
    report(base, runConfig("learn NOT-collapsing (judged 2x)", raw, Lnc, TREE_DEFAULTS), raw, L2);
    const wpos: (c: Call) => number = (c) => (L2(c) ? 2 : 1);
    report(base, runConfig("weight winners x2", raw, L2, TREE_DEFAULTS, { w: wpos }), raw, L2);
  }

  if (GROUPS.has("ens")) {
    console.log("\n== ENSEMBLE (average of several models) ==");
    const parts = [TREE_DEFAULTS, { ...TREE_DEFAULTS, depth: 2, rounds: 300 }, { ...TREE_DEFAULTS, subsample: 0.5, minLeaf: 60 }, { ...TREE_DEFAULTS, lambda: 30, rounds: 200 }].map((o, i) => runConfig(`part ${i}`, raw, L2, o));
    const z = (v: number[]) => { const m = mean(v), s = sd(v) || 1; return v.map((x) => (x - m) / s); };
    const zs = parts.map((p) => z(p.scores));
    const ens: Result = { name: "average of 4 tree models", scores: zs[0].map((_, i) => mean(zs.map((q) => q[i]))), labels: parts[0].labels, foldAuc: parts[0].foldAuc, idx: parts[0].idx };
    report(base, ens, raw, L2);
  }
  console.log(`\nfinished in ${Math.round((Date.now() - t0) / 1000)}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
