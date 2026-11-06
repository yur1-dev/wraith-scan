// lib/signalModel.ts  (pure math + pattern library, no network; server only in practice)
// Wraith learns from its own track record. Every tracked call stores ~30 indicators at call time (featuresOf) and later
// an outcome (did it reach 2x?). This file turns that history into:
//   1. a logistic-regression model: P(reaches 2x) from the indicators, validated on NEWER calls than it trained on
//   2. a pattern library: named setups (rules over the indicators) with their real historical hit rate
// The model is only allowed to influence scores when it beats chance on the held-out calls.

export type Features = Record<string, number | null | undefined>;

/** Indicators the model reads, in a fixed order. Heavy-tailed ones are log-scaled. */
const NUMERIC: { key: string; log?: boolean }[] = [
  { key: "h1" }, { key: "m5" }, { key: "h6" }, { key: "h24" },
  { key: "volRatio", log: true }, { key: "buyShare" },
  { key: "liq", log: true }, { key: "liqRatio" }, { key: "mcap", log: true },
  { key: "ageMin", log: true }, { key: "curve" }, { key: "grad" },
  { key: "holders", log: true }, { key: "organic" }, { key: "topHolders" }, { key: "devPct" }, { key: "traders1h", log: true },
  { key: "flowBuyers", log: true }, { key: "flowAccel" }, { key: "top3Share" }, { key: "bundled" }, { key: "netSol" },
  { key: "devCreated", log: true }, { key: "devGraduated" }, { key: "devDead" }, { key: "devRecent7d" },
  { key: "smart" }, { key: "dumpers" }, { key: "intelAdj" },
];
/** "was this indicator available at all" flags: availability itself carries information (e.g. Solana + vetted) */
const HAS = ["holders", "organic", "flowBuyers", "smart", "devCreated", "buyShare"];

export const FEATURE_NAMES = [...NUMERIC.map((n) => n.key), ...HAS.map((k) => `has:${k}`)];

const slog = (x: number) => Math.sign(x) * Math.log1p(Math.abs(x));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Raw (unstandardised) vector; missing numeric values become NaN and are filled with the mean later. */
export function rawVector(f: Features): number[] {
  const out: number[] = [];
  for (const n of NUMERIC) {
    const v = num(f[n.key]);
    out.push(v === null ? NaN : n.log ? slog(v) : v);
  }
  for (const k of HAS) out.push(num(f[k]) === null ? 0 : 1);
  return out;
}

export interface SignalModel {
  v: 1;
  names: string[];
  mean: number[];
  std: number[];
  w: number[];
  b: number;
  base: number; // share of calls that reached 2x in the training data
  n: number; // training calls
  wins: number;
  trainedAt: number;
  /** held-out performance on the NEWEST 25% of calls (never trained on) */
  holdout: { n: number; auc: number; baseRate: number; topQuartileRate: number; bottomQuartileRate: number };
  /** the model may only move scores when it clearly beats chance on held-out calls */
  active: boolean;
  /** strongest learned effects, for the UI: positive = predicts winners */
  top: { name: string; w: number }[];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function standardise(rows: number[][], mean: number[], std: number[]): number[][] {
  return rows.map((r) => r.map((v, j) => (Number.isFinite(v) ? (v - mean[j]) / std[j] : 0)));
}

/** Area under the ROC curve (probability a random winner is ranked above a random non-winner). */
export function auc(scores: number[], labels: number[]): number {
  const idx = scores.map((s, i) => [s, labels[i]] as const).sort((a, b) => a[0] - b[0]);
  let rank = 1, sumPos = 0, pos = 0, neg = 0;
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j < idx.length && idx[j][0] === idx[i][0]) j++;
    const avg = (rank + (rank + (j - i) - 1)) / 2;
    for (let k = i; k < j; k++) if (idx[k][1] === 1) { sumPos += avg; pos++; } else neg++;
    rank += j - i;
    i = j;
  }
  return pos && neg ? (sumPos - (pos * (pos + 1)) / 2) / (pos * neg) : 0.5;
}

function fit(X: number[][], y: number[], lambda: number, iters: number, lr: number): { w: number[]; b: number } {
  const n = X.length, d = X[0].length;
  const w = new Array(d).fill(0);
  let b = Math.log(Math.max(1e-3, y.reduce((a, v) => a + v, 0) / n) / (1 - y.reduce((a, v) => a + v, 0) / n));
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const e = sigmoid(z) - y[i];
      gb += e;
      for (let j = 0; j < d; j++) gw[j] += e * X[i][j];
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * w[j]);
    b -= lr * (gb / n);
  }
  return { w, b };
}

export interface TrainRow { features: Features; win: boolean; at: number }

/** Trains on the older 75% of calls, measures on the newest 25%, then refits on everything for live use. */
export function trainModel(rows: TrainRow[], now = Date.now()): SignalModel | null {
  const usable = rows.filter((r) => r.features && Object.keys(r.features).length).sort((a, b) => a.at - b.at);
  if (usable.length < 150) return null;
  const raw = usable.map((r) => rawVector(r.features));
  const y = usable.map((r) => (r.win ? 1 : 0));
  const d = raw[0].length;

  const stats = (idx: number[]) => {
    const mean = new Array(d).fill(0), std = new Array(d).fill(1);
    for (let j = 0; j < d; j++) {
      const vals = idx.map((i) => raw[i][j]).filter(Number.isFinite);
      if (!vals.length) { mean[j] = 0; std[j] = 1; continue; }
      const m = vals.reduce((a, v) => a + v, 0) / vals.length;
      const v = vals.reduce((a, x) => a + (x - m) ** 2, 0) / vals.length;
      mean[j] = m;
      std[j] = Math.sqrt(v) || 1;
    }
    return { mean, std };
  };

  // 1) honest test: train on the older 75%, score the newest 25%
  const cut = Math.floor(usable.length * 0.75);
  const trainIdx = usable.slice(0, cut).map((_, i) => i);
  const testIdx = usable.slice(cut).map((_, i) => i + cut);
  const s1 = stats(trainIdx);
  const m1 = fit(standardise(trainIdx.map((i) => raw[i]), s1.mean, s1.std), trainIdx.map((i) => y[i]), 0.05, 400, 0.15);
  const Xt = standardise(testIdx.map((i) => raw[i]), s1.mean, s1.std);
  const pt = Xt.map((r) => sigmoid(m1.b + r.reduce((a, v, j) => a + v * m1.w[j], 0)));
  const yt = testIdx.map((i) => y[i]);
  const order = pt.map((p, i) => [p, yt[i]] as const).sort((a, b) => b[0] - a[0]);
  const q = Math.max(5, Math.floor(order.length / 4));
  const rate = (arr: readonly (readonly [number, number])[]) => (arr.length ? arr.reduce((a, v) => a + v[1], 0) / arr.length : 0);
  const holdout = {
    n: testIdx.length,
    auc: Math.round(auc(pt, yt) * 1000) / 1000,
    baseRate: Math.round(rate(order) * 1000) / 1000,
    topQuartileRate: Math.round(rate(order.slice(0, q)) * 1000) / 1000,
    bottomQuartileRate: Math.round(rate(order.slice(-q)) * 1000) / 1000,
  };

  // 2) live model: refit on every call
  const all = usable.map((_, i) => i);
  const s2 = stats(all);
  const m2 = fit(standardise(raw, s2.mean, s2.std), y, 0.05, 400, 0.15);
  const wins = y.reduce<number>((a, v) => a + v, 0);
  const top = FEATURE_NAMES.map((name, j) => ({ name, w: Math.round(m2.w[j] * 1000) / 1000 }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .slice(0, 8);

  return {
    v: 1,
    names: FEATURE_NAMES,
    mean: s2.mean,
    std: s2.std,
    w: m2.w,
    b: m2.b,
    base: wins / usable.length,
    n: usable.length,
    wins,
    trainedAt: now,
    holdout,
    // must separate winners from losers on unseen newer calls, and the top quartile must clearly beat the bottom one
    active: holdout.auc >= 0.58 && holdout.topQuartileRate >= holdout.bottomQuartileRate * 1.3,
    top,
  };
}

/** P(reaches 2x) for one token's indicators. */
export function predict(model: SignalModel, f: Features): number {
  const r = rawVector(f);
  let z = model.b;
  for (let j = 0; j < r.length; j++) z += model.w[j] * (Number.isFinite(r[j]) ? (r[j] - model.mean[j]) / model.std[j] : 0);
  return sigmoid(z);
}

// ── pattern library ───────────────────────────────────────────────────────────
// Named setups over the same indicators. Their hit rates are measured from history, never assumed.
export interface PatternDef { id: string; label: string; hint: string; test: (f: Features) => boolean }
const g = (f: Features, k: string) => num(f[k]);
const inR = (v: number | null, lo: number, hi: number) => v !== null && v >= lo && v <= hi;

export const PATTERNS: PatternDef[] = [
  { id: "early-accum", label: "Early accumulation", hint: "Young token, buyers outnumber sellers, price still quiet",
    test: (f) => inR(g(f, "ageMin"), 0, 360) && inR(g(f, "buyShare"), 0.55, 0.85) && inR(g(f, "h1"), -5, 40) },
  { id: "vol-breakout", label: "Breakout on volume", hint: "Hourly volume jumps against market cap while price starts to climb",
    test: (f) => (g(f, "volRatio") ?? 0) >= 0.12 && inR(g(f, "h1"), 10, 90) && (g(f, "m5") ?? 0) > 0 },
  { id: "accelerating", label: "Pace picking up", hint: "5-minute pace is faster than the hourly trend",
    test: (f) => (g(f, "h1") ?? 0) > 5 && (g(f, "m5") ?? 0) > 0 && (g(f, "m5") ?? 0) * 12 > (g(f, "h1") ?? 0) },
  { id: "smart-money", label: "Smart-money entry", hint: "Wallets with a winning record are buying and no known dumpers are in",
    test: (f) => (g(f, "smart") ?? 0) >= 1 && (g(f, "dumpers") ?? 0) === 0 },
  { id: "fresh-flow", label: "Fresh buyer flow", hint: "Many distinct new buyers with accelerating flow",
    test: (f) => (g(f, "flowBuyers") ?? 0) >= 25 && (g(f, "flowAccel") ?? 0) > 0 },
  { id: "graduation", label: "Graduation run", hint: "Just left the bonding curve with live momentum",
    test: (f) => (g(f, "grad") ?? 0) === 1 && inR(g(f, "ageMin"), 0, 720) && (g(f, "h1") ?? 0) > 0 },
  { id: "curve-push", label: "Curve push", hint: "Bonding curve more than 60% filled, getting close to graduating",
    test: (f) => (g(f, "curve") ?? 0) >= 0.6 && (g(f, "curve") ?? 0) < 1 },
  { id: "clean-dev", label: "Clean dev + holders", hint: "Developer has no dead launches, wide holder base, low concentration",
    test: (f) => (g(f, "devDead") ?? 1) === 0 && (g(f, "holders") ?? 0) >= 300 && (g(f, "topHolders") ?? 100) < 35 },
  { id: "reclaim", label: "Dip reclaim", hint: "Pulled back over 6 hours but is turning up again",
    test: (f) => (g(f, "h6") ?? 0) < -10 && (g(f, "h1") ?? 0) > 3 && (g(f, "m5") ?? 0) > 0 },
  // traps: patterns that tend to lose, shown as warnings
  { id: "trap-late", label: "Late chase", hint: "Already ran hard in the last hour",
    test: (f) => (g(f, "h1") ?? 0) > 150 },
  { id: "trap-bundled", label: "Bundled / concentrated", hint: "A few wallets hold or drive most of the flow",
    test: (f) => (g(f, "bundled") ?? 0) >= 1 || (g(f, "top3Share") ?? 0) >= 0.6 },
  { id: "trap-wash", label: "Wash volume", hint: "Big volume from very few traders",
    test: (f) => (g(f, "traders1h") ?? 999) < 15 && (g(f, "volRatio") ?? 0) > 1.5 },
];

export interface PatternStat { id: string; label: string; hint: string; trap: boolean; calls: number; wins: number; rate: number | null; lift: number | null }

export function patternStats(rows: TrainRow[]): PatternStat[] {
  const base = rows.length ? rows.filter((r) => r.win).length / rows.length : 0;
  return PATTERNS.map((p) => {
    const hit = rows.filter((r) => p.test(r.features));
    const wins = hit.filter((r) => r.win).length;
    const rate = hit.length >= 15 ? wins / hit.length : null;
    return {
      id: p.id, label: p.label, hint: p.hint, trap: p.id.startsWith("trap-"),
      calls: hit.length, wins, rate: rate === null ? null : Math.round(rate * 1000) / 1000,
      lift: rate === null || !base ? null : Math.round((rate / base) * 100) / 100,
    };
  });
}

export function detectPatterns(f: Features): string[] {
  const out: string[] = [];
  for (const p of PATTERNS) { try { if (p.test(f)) out.push(p.id); } catch { /* ignore */ } }
  return out;
}
