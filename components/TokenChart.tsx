"use client";

// components/TokenChart.tsx
// Pump.fun / Fomo style chart: candles or orange area, volume histogram,
// MCap/Price toggle, live tick merged into the current candle, proper
// loading / empty / error states. Data comes from /api/token-chart.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { RefreshCw, Ruler } from "lucide-react";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/market";
import { peekCandles } from "@/lib/candleCache";

export interface ChartCandle {
  t: number; // bucket start, ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const TIMEFRAMES = [
  { key: "1m", label: "1m", sec: 60 },
  { key: "5m", label: "5m", sec: 300 },
  { key: "15m", label: "15m", sec: 900 },
  { key: "1h", label: "1h", sec: 3600 },
  { key: "4h", label: "4h", sec: 14400 },
  { key: "1d", label: "1D", sec: 86400 },
] as const;
type TfKey = (typeof TIMEFRAMES)[number]["key"];
type Metric = "mcap" | "price";
type Style = "candles" | "line";

const ACCENT = "#ff7b3d";
const UP = "#22c55e";
const DOWN = "#ef4444";
const POLL_MS = 10_000;
const rowCache = new Map<string, ChartCandle[]>(); // last good series per token+timeframe: instant repaint on switch/revisit
const EMPTY_POLL_MS = 2_500;
const FINER_TF: Record<string, string[]> = { "5m": ["1m"], "15m": ["5m", "1m"], "1h": ["15m", "5m", "1m"], "4h": ["1h", "15m", "5m"], "1d": ["4h", "1h", "15m"] };
/** Build `tf` from any finer series already cached for this token, so switching timeframe never starts from blank. */
function deriveLocal(mint: string, chain: string | undefined, tf: string, sec: number): ChartCandle[] {
  for (const fk of FINER_TF[tf] ?? []) {
    const src = rowCache.get(`${mint}:${chain ?? ""}:${fk}`);
    if (!src || src.length < 3) continue;
    const step = sec * 1000;
    const out = new Map<number, ChartCandle>();
    for (const r of src) {
      const t = Math.floor(r.t / step) * step;
      const cur = out.get(t);
      if (!cur) out.set(t, { ...r, t });
      else { cur.h = Math.max(cur.h, r.h); cur.l = Math.min(cur.l, r.l); cur.c = r.c; cur.v += r.v; }
    }
    const list = [...out.values()].sort((a, b) => a.t - b.t);
    if (list.length >= 3) return list;
  }
  return [];
}

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

// lightweight-charts renders UTC; shift into the viewer's local time.
function chartTime(tMs: number): UTCTimestamp {
  return (tMs / 1000 - new Date(tMs).getTimezoneOffset() * 60) as UTCTimestamp;
}

type Status = "loading" | "ready" | "empty" | "error";

export default function TokenChart({
  mint,
  livePrice,
  supply,
  spottedMcap,
  spottedAt,
  spotCard,
  trades,
  onCurve,
  chain,
}: {
  mint: string;
  /** EVM chain key (e.g. "base"); omit for Solana */
  chain?: string;
  /** still on the pump.fun bonding curve (lets the server rebuild candles on-chain) */
  onCurve?: boolean;
  /** latest spot price in USD, merged into the current candle */
  livePrice?: number | null;
  /** circulating supply (mcap / price) — enables the MCap view */
  supply?: number | null;
  /** market cap when Wraith flagged this token: drawn as a "Spotted" line */
  spottedMcap?: number | null;
  /** when Wraith flagged it (ms epoch): draws the Wraith marker on that candle in every timeframe */
  spottedAt?: number | null;
  /** hover card for the Wraith marker */
  spotCard?: ReactNode;
  /** recent swaps, drawn as buy/sell dots on their candles */
  trades?: { id: string; ts: number; side: "buy" | "sell"; usd: number; priceUsd: number; wallet: string }[];
}) {
  const onCurveRef = useRef(Boolean(onCurve));
  onCurveRef.current = Boolean(onCurve);
  const [tf, setTf] = useState<TfKey>("15m");
  const [metric, setMetric] = useState<Metric>("mcap");
  const [style, setStyle] = useState<Style>("candles");
  const [status, setStatus] = useState<Status>("loading");
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [source, setSource] = useState<string>("");
  const [stale, setStale] = useState(false);
  const [legend, setLegend] = useState<ChartCandle | null>(null);
  const [away, setAway] = useState(false);
  const pushedRef = useRef<{ key: string; first: number; len: number } | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const candlesRef = useRef<ChartCandle[]>([]);
  const needFitRef = useRef(true);
  const reqRef = useRef(0);
  const lastTickRef = useRef<number>(0);

  // ── measure tool (Shift+click to start, click again to lock) ───────────
  type MPt = { logical: number; value: number };
  type Measure = { a: MPt; b: MPt; locked: boolean };
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [, setViewTick] = useState(0);
  const [spotTick, setSpotTick] = useState(0);
  const [spotHover, setSpotHover] = useState(false);
  const [showTrades, setShowTrades] = useState(true);
  const [dots, setDots] = useState<{ key: string; x: number; y: number; side: "buy" | "sell"; usd: number; n: number }[]>([]);
  const [spotPos, setSpotPos] = useState<{ x: number; y: number } | null>(null);
  const measureRef = useRef<Measure | null>(null);
  measureRef.current = measure;
  const measureModeRef = useRef(false);
  measureModeRef.current = measureMode;

  const supplyKey = supply && supply > 0 ? Math.round(supply) : 0;
  const effectiveMetric: Metric = metric === "mcap" && supplyKey ? "mcap" : "price";
  const mult = effectiveMetric === "mcap" ? supplyKey : 1;
  const tfSec = TIMEFRAMES.find((x) => x.key === tf)?.sec ?? 900;

  // ── persisted prefs (after mount: avoids hydration mismatch) ───────────
  useEffect(() => {
    setTf(readPref("wraith_chart_tf", TIMEFRAMES.map((x) => x.key), "15m"));
    setMetric(readPref("wraith_chart_metric", ["mcap", "price"] as const, "mcap"));
    setStyle(readPref("wraith_chart_style", ["candles", "line"] as const, "candles"));
  }, []);

  // ── create chart once ──────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b8b92",
        fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.045)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(255,123,61,0.45)", labelBackgroundColor: ACCENT },
        horzLine: { color: "rgba(255,123,61,0.45)", labelBackgroundColor: ACCENT },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.08)",
        scaleMargins: { top: 0.08, bottom: 0.24 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 9,
        minBarSpacing: 1.5,
        rightBarStaysOnScroll: true,
        lockVisibleTimeRangeOnResize: true,
        shiftVisibleRangeOnNewBar: true,
      },
      kineticScroll: { mouse: true, touch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });
    chartRef.current = chart;

    const applyMove = (param: MouseEventParams<Time>) => {
      if (!param.time || !mainRef.current) {
        setLegend(null);
        return;
      }
      const data = param.seriesData.get(mainRef.current) as
        | { open?: number; high?: number; low?: number; close?: number; value?: number }
        | undefined;
      const vol = volRef.current ? (param.seriesData.get(volRef.current) as { value?: number } | undefined) : undefined;
      if (!data) {
        setLegend(null);
        return;
      }
      const m = metricMultRef.current;
      const c = (data.close ?? data.value ?? 0) / m;
      setLegend({
        t: 0,
        o: (data.open ?? data.value ?? 0) / m,
        h: (data.high ?? data.value ?? 0) / m,
        l: (data.low ?? data.value ?? 0) / m,
        c,
        v: vol?.value ?? 0,
      });
    };
    // one legend update per frame: React no longer re-renders on every mouse-move event
    let raf = 0;
    let pending: MouseEventParams<Time> | null = null;
    const onMove = (param: MouseEventParams<Time>) => {
      pending = param;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (pending) applyMove(pending);
      });
    };
    chart.subscribeCrosshairMove(onMove);
    // "Latest" button appears when you've scrolled into history
    const onRange = () => {
      const away = chart.timeScale().scrollPosition() < -2;
      setAway((prev) => (prev === away ? prev : away));
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      volRef.current = null;
    };
  }, []);

  // crosshair handler needs the current multiplier without re-subscribing
  const metricMultRef = useRef(1);
  metricMultRef.current = mult;

  // measure tool: pointer handling on the chart surface
  useEffect(() => {
    const host = hostRef.current;
    const chart = chartRef.current;
    if (!host || !chart) return;
    const toPt = (e: MouseEvent): MPt | null => {
      const main = mainRef.current;
      if (!main) return null;
      const r = host.getBoundingClientRect();
      const logical = chart.timeScale().coordinateToLogical(e.clientX - r.left);
      const value = main.coordinateToPrice(e.clientY - r.top);
      if (logical === null || value === null) return null;
      return { logical: logical as number, value: value as number };
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const m = measureRef.current;
      if (m && !m.locked) {
        // second click: stop here
        e.stopPropagation();
        e.preventDefault();
        setMeasure({ a: m.a, b: toPt(e) ?? m.b, locked: true });
        setMeasureMode(false);
        return;
      }
      if (e.shiftKey || measureModeRef.current) {
        e.stopPropagation();
        e.preventDefault();
        const p = toPt(e);
        if (p) setMeasure({ a: p, b: p, locked: false });
        return;
      }
      if (m && m.locked) setMeasure(null); // plain click clears a finished measurement
    };
    const onMove = (e: MouseEvent) => {
      const m = measureRef.current;
      if (!m || m.locked) return;
      const p = toPt(e);
      if (p) setMeasure({ a: m.a, b: p, locked: false });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMeasure(null);
        setMeasureMode(false);
      }
    };
    const bump = () => { if (measureRef.current) setViewTick((t) => t + 1); };
    host.addEventListener("mousedown", onDown, true);
    host.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onKey);
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);
    chart.subscribeCrosshairMove(bump);
    return () => {
      host.removeEventListener("mousedown", onDown, true);
      host.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(bump);
      chart.unsubscribeCrosshairMove(bump);
    };
  }, []);

  // a measurement only makes sense for the series it was drawn on
  useEffect(() => {
    setMeasure(null);
  }, [tf, effectiveMetric, style]);

  // ── (re)build series when style / metric changes ──────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (mainRef.current) chart.removeSeries(mainRef.current);
    if (volRef.current) chart.removeSeries(volRef.current);

    const formatter = effectiveMetric === "mcap" ? (p: number) => fmtUsd(p, { decimals: 2 }).replace("—", "$0") : (p: number) => fmtPrice(p);
    const priceFormat = {
      type: "custom" as const,
      minMove: effectiveMetric === "mcap" ? 1 : 1e-12,
      formatter,
    };

    mainRef.current =
      style === "candles"
        ? chart.addSeries(CandlestickSeries, {
            upColor: UP,
            downColor: DOWN,
            borderUpColor: UP,
            borderDownColor: DOWN,
            wickUpColor: UP,
            wickDownColor: DOWN,
            priceFormat,
            priceLineColor: ACCENT,
          })
        : chart.addSeries(AreaSeries, {
            lineColor: ACCENT,
            topColor: "rgba(255,123,61,0.28)",
            bottomColor: "rgba(255,123,61,0.0)",
            lineWidth: 2,
            priceFormat,
            priceLineColor: ACCENT,
          });

    volRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    pushedRef.current = null;
    needFitRef.current = true;
  }, [style, effectiveMetric]);

  // ── "Spotted" marker line ─────────────────────────────────────────────
  useEffect(() => {
    const main = mainRef.current;
    if (!main || !spottedMcap || !(spottedMcap > 0)) return;
    const value = effectiveMetric === "mcap" ? spottedMcap : supplyKey ? spottedMcap / supplyKey : 0;
    if (!(value > 0)) return;
    const line = main.createPriceLine({
      price: value,
      color: "#facc15",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "Spotted",
    });
    return () => {
      try { main.removePriceLine(line); } catch { /* series already replaced */ }
    };
  }, [style, effectiveMetric, spottedMcap, supplyKey]);

  // ── Wraith marker: where it spotted the token, on whatever timeframe is showing ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const bump = () => setSpotTick((t) => t + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);
    chart.timeScale().subscribeSizeChange(bump);
    return () => {
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(bump); chart.timeScale().unsubscribeSizeChange(bump); } catch { /* chart gone */ }
    };
  }, []);
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!chart || !main || !spottedAt || !candles.length) { setSpotPos(null); return; }
    const step = tfSec * 1000;
    const bucket = Math.floor(spottedAt / step) * step;
    const c = candles.find((k) => k.t === bucket);
    if (!c) { setSpotPos(null); return; } // spotted before the first candle we have
    const x = chart.timeScale().timeToCoordinate(chartTime(bucket));
    const y = main.priceToCoordinate(c.h * mult);
    setSpotPos(x == null || y == null ? null : { x, y });
  }, [spottedAt, candles, tfSec, mult, spotTick, style, effectiveMetric]);

  // ── buy / sell dots from recent swaps ──
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!chart || !main || !showTrades || !trades?.length || !candles.length) { setDots([]); return; }
    const step = tfSec * 1000;
    const first = candles[0].t;
    const groups = new Map<string, { bucket: number; side: "buy" | "sell"; usd: number; n: number; px: number }>();
    for (const t of trades) {
      const bucket = Math.floor(t.ts / step) * step;
      if (bucket < first || !(t.priceUsd > 0)) continue;
      const k = `${bucket}:${t.side}`;
      const g = groups.get(k) ?? { bucket, side: t.side, usd: 0, n: 0, px: 0 };
      g.usd += t.usd; g.n += 1; g.px += t.priceUsd;
      groups.set(k, g);
    }
    const out: typeof dots = [];
    for (const [key, g] of groups) {
      const x = chart.timeScale().timeToCoordinate(chartTime(g.bucket));
      const y = main.priceToCoordinate((g.px / g.n) * mult);
      if (x == null || y == null) continue;
      out.push({ key, x, y, side: g.side, usd: g.usd, n: g.n });
    }
    setDots(out.slice(0, 80));
  }, [trades, candles, tfSec, mult, spotTick, showTrades, style]);

  // ── push candles into series ──────────────────────────────────────────
  useEffect(() => {
    const main = mainRef.current;
    const vol = volRef.current;
    const chart = chartRef.current;
    if (!main || !vol || !chart) return;

    candlesRef.current = candles.map((c) => ({ ...c }));
    if (!candles.length) {
      main.setData([]);
      vol.setData([]);
      pushedRef.current = null;
      return;
    }

    const mkMain = (c: ChartCandle) =>
      style === "candles"
        ? { time: chartTime(c.t), open: c.o * mult, high: c.h * mult, low: c.l * mult, close: c.c * mult }
        : { time: chartTime(c.t), value: c.c * mult };
    const mkVol = (c: ChartCandle) => ({ time: chartTime(c.t), value: c.v, color: c.c >= c.o ? "rgba(34,197,94,0.38)" : "rgba(239,68,68,0.38)" });

    // Same series, only the tail changed (the 10s poll): update the last bars in place.
    // No full redraw, no flicker, and the viewport and any measure box stay put.
    const key = `${mint}|${chain ?? ""}|${tf}|${style}|${mult}`;
    const prev = pushedRef.current;
    if (prev && prev.key === key && prev.first === candles[0].t && candles.length >= prev.len && candles.length - prev.len <= 4) {
      try {
        for (let i = Math.max(0, prev.len - 2); i < candles.length; i++) {
          (main as ISeriesApi<"Candlestick">).update(mkMain(candles[i]) as never);
          vol.update(mkVol(candles[i]));
        }
        pushedRef.current = { key, first: candles[0].t, len: candles.length };
        return;
      } catch {
        // chart already holds a newer live bar than this poll (or similar): fall through to a full redraw
      }
    }

    const seen = new Set<number>();
    const mainData: unknown[] = [];
    const volData: { time: UTCTimestamp; value: number; color: string }[] = [];
    for (const c of candles) {
      const time = chartTime(c.t);
      if (seen.has(time)) continue;
      seen.add(time);
      mainData.push(mkMain(c));
      volData.push(mkVol(c));
    }
    (main as ISeriesApi<"Candlestick">).setData(mainData as never);
    vol.setData(volData);
    pushedRef.current = { key, first: candles[0].t, len: candles.length };

    if (needFitRef.current) {
      needFitRef.current = false;
      const n = mainData.length;
      // Always the same comfortable framing: ~60-90 bars across, newest bar near the right edge.
      // A young token with 8 candles therefore sits at the right with normal-width candles, not stretched wide.
      const span = Math.max(60, Math.min(n, 90));
      chart.timeScale().setVisibleLogicalRange({ from: n - span, to: n + 6 });
    }
  }, [candles, style, mult, mint, chain, tf]);

  // ── merge live price into the running candle ──────────────────────────
  useEffect(() => {
    const main = mainRef.current;
    const list = candlesRef.current;
    if (!main || !livePrice || !(livePrice > 0)) return;
    if (livePrice === lastTickRef.current) return;
    lastTickRef.current = livePrice;

    const step = tfSec * 1000;
    const bucket = Math.floor(Date.now() / step) * step;
    // No history yet (new token / provider slow): start the chart from live trades.
    if (!list.length) list.push({ t: bucket, o: livePrice, h: livePrice, l: livePrice, c: livePrice, v: 0 });
    let last = list[list.length - 1];
    // Ignore ticks wildly off the series (stale provider glitch).
    if (livePrice > last.c * 20 || livePrice < last.c / 20) return;

    if (last.t < bucket) {
      const next: ChartCandle = { t: bucket, o: last.c, h: Math.max(last.c, livePrice), l: Math.min(last.c, livePrice), c: livePrice, v: 0 };
      list.push(next);
      last = next;
    } else {
      last.c = livePrice;
      last.h = Math.max(last.h, livePrice);
      last.l = Math.min(last.l, livePrice);
    }
    const time = chartTime(last.t);
    if (statusRef.current !== "ready" && list.length >= 3) setStatus("ready"); // a lone live bar is not a chart: wait for history (or 3+ live bars)
    if (style === "candles") {
      (main as ISeriesApi<"Candlestick">).update({
        time,
        open: last.o * mult,
        high: last.h * mult,
        low: last.l * mult,
        close: last.c * mult,
      });
    } else {
      (main as ISeriesApi<"Area">).update({ time, value: last.c * mult });
    }
  }, [livePrice, style, mult, tfSec]);

  // ── fetch + poll ──────────────────────────────────────────────────────
  const load = useCallback(
    async (initial: boolean) => {
      const id = ++reqRef.current;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25_000);
      try {
        const res = await fetch(chain ? `/api/evm-chart?address=${encodeURIComponent(mint)}&chain=${encodeURIComponent(chain)}&tf=${tf}` : `/api/token-chart?address=${encodeURIComponent(mint)}&tf=${tf}${onCurveRef.current ? "&curve=1" : ""}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (id !== reqRef.current) return;
        if (!res.ok) throw new Error(String(res.status));
        const data: { candles?: ChartCandle[]; source?: string; stale?: boolean } = await res.json();
        if (id !== reqRef.current) return;
        const rows = Array.isArray(data.candles) ? data.candles : [];
        setSource(data.source ?? "");
        setStale(Boolean(data.stale));
        if (rows.length) {
          rowCache.set(`${mint}:${chain ?? ""}:${tf}`, rows);
          setCandles(rows);
          setStatus("ready");
        } else if (initial || candlesRef.current.length === 0) {
          setCandles([]);
          setStatus("empty");
        }
      } catch {
        if (id !== reqRef.current) return;
        if (candlesRef.current.length === 0) setStatus("error");
      } finally {
        clearTimeout(timer);
      }
    },
    [mint, tf, chain],
  );

  const statusRef = useRef<Status>("loading");
  statusRef.current = status;

  useEffect(() => {
    needFitRef.current = true;
    lastTickRef.current = 0;
    setLegend(null);

    // Instant first paint from the client cache (populated by MemeScanner
    // hover-prefetch or a prior visit). Falls back to the shimmer overlay if
    // the cache is cold — the background load() below fills it either way.
    const mem = rowCache.get(`${mint}:${chain ?? ""}:${tf}`);
    let cached: Partial<ChartCandle>[] = mem ?? peekCandles(mint, tf);
    if (!cached.length) cached = deriveLocal(mint, chain, tf, TIMEFRAMES.find((x) => x.key === tf)?.sec ?? 900);
    if (cached.length) {
      const withVol: ChartCandle[] = (cached as Partial<ChartCandle>[]).map((c) => ({ v: 0, ...c } as ChartCandle));
      candlesRef.current = withVol.map((c) => ({ ...c }));
      setCandles(withVol);
      setStatus("ready");
    } else {
      candlesRef.current = [];
      setCandles([]);
      setStatus("loading");
    }

    void load(true);

    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(
        () => {
          if (!document.hidden) void load(false);
          tick();
        },
        statusRef.current === "ready" ? POLL_MS : EMPTY_POLL_MS,
      );
    };
    tick();
    return () => {
      reqRef.current++;
      clearTimeout(timer);
    };
  // mint and tf are also captured via peekCandles — adding them is redundant
  // (load already re-creates when they change) but keeps exhaustive-deps happy.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, mint, tf]);

  const last = candles[candles.length - 1];
  const shown = legend ?? last ?? null;
  const first = candles[0];
  const rangeChange = first && last ? ((last.c - first.o) / first.o) * 100 : null;
  const fmtVal = (n: number) => (effectiveMetric === "mcap" ? fmtUsd(n * mult, { decimals: 2 }) : fmtPrice(n));

  // measure overlay geometry (recomputed every render so it follows pan/zoom)
  const measureView = (() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!measure || !chart || !main) return null;
    const ts = chart.timeScale();
    const x1 = ts.logicalToCoordinate(measure.a.logical as Logical);
    const x2 = ts.logicalToCoordinate(measure.b.logical as Logical);
    const y1 = main.priceToCoordinate(measure.a.value);
    const y2 = main.priceToCoordinate(measure.b.value);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return null;
    const delta = measure.b.value - measure.a.value;
    const pct = measure.a.value > 0 ? (delta / measure.a.value) * 100 : 0;
    const bars = Math.round(measure.b.logical - measure.a.logical);
    const secs = Math.abs(bars) * tfSec;
    const dur = secs < 3600 ? `${Math.round(secs / 60)}m` : secs < 86400 ? `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m` : `${Math.floor(secs / 86400)}d ${Math.round((secs % 86400) / 3600)}h`;
    const absDelta = Math.abs(delta);
    return {
      left: Math.min(x1, x2), top: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
      x1, x2, y1, y2, up: delta >= 0, pct, bars,
      line1: `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(2)}%  (${delta >= 0 ? "+" : "-"}${effectiveMetric === "mcap" ? fmtUsd(absDelta, { decimals: 2 }) : fmtPrice(absDelta)})`,
      line2: `${bars >= 0 ? "" : "-"}${Math.abs(bars)} bars, ${dur}`,
    };
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* toolbar */}
      <div className="wx-chart-toolbar">
        <div className="wx-seg" role="tablist" aria-label="Timeframe">
          {TIMEFRAMES.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tf === x.key}
              className={tf === x.key ? "on" : ""}
              onClick={() => {
                setTf(x.key);
                writePref("wraith_chart_tf", x.key);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div className="wx-seg" aria-label="Chart value">
          {(["mcap", "price"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={effectiveMetric === m ? "on" : ""}
              disabled={m === "mcap" && !supplyKey}
              title={m === "mcap" && !supplyKey ? "Market cap unavailable for this token" : undefined}
              onClick={() => {
                setMetric(m);
                writePref("wraith_chart_metric", m);
              }}
            >
              {m === "mcap" ? "MCap" : "Price"}
            </button>
          ))}
        </div>
        <div className="wx-seg" aria-label="Chart style">
          {(["candles", "line"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={style === s ? "on" : ""}
              onClick={() => {
                setStyle(s);
                writePref("wraith_chart_style", s);
              }}
            >
              {s === "candles" ? "Candles" : "Line"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`wx-icon-btn${measureMode || (measure && !measure.locked) ? " on" : ""}`}
          onClick={() => { setMeasure(null); setMeasureMode((v) => !v); }}
          aria-label="Measure"
          aria-pressed={measureMode}
          title="Measure: Shift+click (or tap this), then click again to lock. Esc clears."
        >
          <Ruler size={13} />
        </button>
        {trades && (
          <button type="button" className={`wx-icon-btn${showTrades ? " on" : ""}`} onClick={() => setShowTrades((v) => !v)} aria-pressed={showTrades} aria-label="Show buys and sells" title="Buys / sells on the chart" style={{ width: "auto", padding: "0 9px", fontSize: 10, fontWeight: 700 }}>
            B/S
          </button>
        )}
        <button type="button" className="wx-icon-btn" onClick={() => void load(true)} aria-label="Refresh chart" title="Refresh">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* OHLC legend */}
      <div className="wx-legend">
        {shown ? (
          <>
            <span>O <b>{fmtVal(shown.o)}</b></span>
            <span>H <b>{fmtVal(shown.h)}</b></span>
            <span>L <b>{fmtVal(shown.l)}</b></span>
            <span>C <b style={{ color: shown.c >= shown.o ? UP : DOWN }}>{fmtVal(shown.c)}</b></span>
            {shown.v > 0 && <span>Vol <b>{fmtUsd(shown.v)}</b></span>}
            {rangeChange !== null && !legend && (
              <span style={{ color: rangeChange >= 0 ? UP : DOWN }}>{fmtPct(rangeChange)}</span>
            )}
          </>
        ) : (
          <span style={{ opacity: 0.6 }}>—</span>
        )}
        <span style={{ flex: 1 }} />
        {source && (
          <span className="wx-src" title={stale ? "Showing last known data; provider is slow" : `Source: ${source}`}>
            {stale ? "stale · " : ""}
            {source.replace("geckoterminal", "gecko").replace("pumpfun-onchain", "on-chain")}
          </span>
        )}
      </div>

      {/* chart surface */}
      <div style={{ position: "relative", flex: 1, minHeight: 260 }}>
        <div ref={hostRef} style={{ position: "absolute", inset: 0, cursor: measureMode || (measure && !measure.locked) ? "crosshair" : undefined }} />

        {status === "ready" && dots.map((d) => (
          <span
            key={d.key}
            title={`${d.n} ${d.side}${d.n > 1 ? "s" : ""} · ${fmtUsd(d.usd)}`}
            style={{ position: "absolute", left: d.x, top: d.y, width: Math.min(16, 7 + Math.log10(Math.max(10, d.usd)) * 1.6), height: Math.min(16, 7 + Math.log10(Math.max(10, d.usd)) * 1.6), transform: "translate(-50%,-50%)", borderRadius: "50%", background: d.side === "buy" ? "rgba(34,197,94,.85)" : "rgba(239,68,68,.85)", border: "1px solid rgba(255,255,255,.55)", pointerEvents: "auto", zIndex: 2, display: "grid", placeItems: "center", color: "#fff", fontSize: 7, fontWeight: 800 }}
          >{d.n > 1 ? d.n : d.side === "buy" ? "B" : "S"}</span>
        ))}

        {spotPos && status === "ready" && (
          <div
            onMouseEnter={() => setSpotHover(true)}
            onMouseLeave={() => setSpotHover(false)}
            style={{ position: "absolute", left: spotPos.x, top: Math.max(4, spotPos.y - 34), transform: "translateX(-50%)", pointerEvents: "auto", cursor: "help", display: "flex", flexDirection: "column", alignItems: "center", zIndex: 5 }}
          >
            {spotHover && spotCard && (
              <div style={{ position: "absolute", bottom: "100%", marginBottom: 8, left: "50%", transform: `translateX(${spotPos.x < 190 ? "-12%" : spotPos.x > ((hostRef.current?.clientWidth ?? 0) - 190) ? "-88%" : "-50%"})`, zIndex: 10 }}>{spotCard}</div>
            )}
            <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#0c0c10", border: "1.5px solid #ff7b3d", boxShadow: "0 0 12px rgba(255,123,61,.65)", display: "grid", placeItems: "center", overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="" width={15} height={17} style={{ objectFit: "contain" }} />
            </span>
            <span style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: "6px solid #ff7b3d", marginTop: -1 }} />
          </div>
        )}

        {measureView && (
          <div className="wx-measure" aria-hidden="true">
            <div
              className={`wx-measure-box ${measureView.up ? "up" : "down"}${measure?.locked ? " locked" : ""}`}
              style={{ left: measureView.left, top: measureView.top, width: measureView.w, height: measureView.h }}
            />
            <svg className="wx-measure-svg" width="100%" height="100%">
              <defs>
                <marker id="wxm-arrow" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                  <path d="M1 1.5 L9 5 L1 8.5z" fill={measureView.up ? "#4f7cff" : "#ff5b5b"} />
                </marker>
              </defs>
              <line x1={measureView.x1} y1={(measureView.y1 + measureView.y2) / 2} x2={measureView.x2} y2={(measureView.y1 + measureView.y2) / 2} stroke={measureView.up ? "#4f7cff" : "#ff5b5b"} strokeWidth="1" markerEnd="url(#wxm-arrow)" />
              <line x1={(measureView.x1 + measureView.x2) / 2} y1={measureView.y1} x2={(measureView.x1 + measureView.x2) / 2} y2={measureView.y2} stroke={measureView.up ? "#4f7cff" : "#ff5b5b"} strokeWidth="1" markerEnd="url(#wxm-arrow)" />
            </svg>
            <div
              className={`wx-measure-label ${measureView.up ? "up" : "down"}`}
              style={
                measureView.top > 64
                  ? { left: measureView.left + measureView.w / 2, top: measureView.top - 8, transform: "translate(-50%, -100%)" }
                  : { left: measureView.left + measureView.w / 2, top: measureView.top + measureView.h + 8, transform: "translate(-50%, 0)" }
              }
            >
              <b>{measureView.line1}</b>
              <span>{measureView.line2}</span>
            </div>
          </div>
        )}

        {away && status === "ready" && (
          <button type="button" className="wx-chart-latest" onClick={() => chartRef.current?.timeScale().scrollToRealTime()} aria-label="Jump to latest candle">
            Latest ›
          </button>
        )}

        {status === "loading" && (
          <div className="wx-chart-overlay">
            <div className="wx-skel" style={{ width: "100%", height: "100%", borderRadius: 0, opacity: 0.55 }} />
            <span className="wx-chart-msg">Loading chart…</span>
          </div>
        )}
        {status === "empty" && (
          <div className="wx-chart-overlay">
            <div className="wx-chart-msg-box">
              <strong>No candles yet</strong>
              <span>Checking for first trades — this retries automatically.</span>
              <button type="button" className="wx-btn" onClick={() => void load(true)}>
                <RefreshCw size={12} /> Retry now
              </button>
            </div>
          </div>
        )}
        {status === "error" && (
          <div className="wx-chart-overlay">
            <div className="wx-chart-msg-box">
              <strong>Couldn&apos;t load the chart</strong>
              <span>The data providers didn&apos;t respond. Try again in a moment.</span>
              <button type="button" className="wx-btn" onClick={() => void load(true)}>
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
