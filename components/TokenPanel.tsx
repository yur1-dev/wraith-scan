"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createChart,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  Time,
  CandlestickSeries,
  LineSeries,
} from "lightweight-charts";
import { MemeTrend } from "@/app/app/page";
import { getTokenPrice } from "@/lib/getTokenPrice";

interface ScanResult extends MemeTrend {
  platforms?: string[];
  isNewCoin?: boolean;
  ageLabel?: string;
  mcap?: number;
  volume?: number;
  liquidity?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  contractAddress?: string;
  rugRisk?: "low" | "medium" | "high" | "unknown";
  rugDetails?: string;
  aiContext?: string;
  isViralTrend?: boolean;
  onDex?: boolean;
  onAI?: boolean;
  onCeleb?: boolean;
  onTwitter?: boolean;
  onTelegram?: boolean;
  celebMention?: string;
  crossPlatforms?: number;
}

interface LiveTokenData {
  mcap?: number;
  liquidity?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  volume24h?: number;
  price?: number;
  age?: string;
}

interface ViralEvidence {
  links: { url: string; platform: string; title: string }[];
  aiAnalysis: string;
  safetyScore: number;
  safetyBreakdown: { label: string; pass: boolean; detail: string }[];
  prediction: "strong" | "moderate" | "weak" | "avoid";
  predictionReason: string;
  loading: boolean;
  error?: string;
}

interface Props {
  selectedMeme: ScanResult | null;
}

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};

const RUG_COLOR: Record<string, string> = {
  low: "#00c47a",
  medium: "#ffaa00",
  high: "#ff2222",
  unknown: "#666",
};
const PRED_COLOR = {
  strong: "#00c47a",
  moderate: "#ffaa00",
  weak: "#ff6600",
  avoid: "#ff2222",
};
const PRED_LABEL = {
  strong: "✓ STRONG SIGNAL",
  moderate: "◈ MODERATE",
  weak: "△ WEAK SIGNAL",
  avoid: "✗ AVOID",
};

const PLATFORM_ICON: Record<string, string> = {
  twitter: "𝕏",
  tiktok: "♪",
  youtube: "▶",
  reddit: "●",
  telegram: "✈",
  pumpfun: "⚡",
  dexscreener: "◈",
  coingecko: "🦎",
  "google-trends": "📈",
  "google-news": "📰",
  youtube_trending: "▶",
  kym: "🐸",
  ai: "✦",
  celebrity: "⭐",
  hackernews: "🔶",
};

// ── Palette — untouched, exactly as before ──────────────────────────────────
const C = {
  label: "#666",
  sub: "#888",
  body: "#aaa",
  dim: "#555",
  accent: "#e8490f",
  green: "#00c47a",
  gold: "#ffd700",
  purple: "#a855f7",
  blue: "#00b4d8",
  red: "#ff4444",
  border: "#1a1a1a",
  bg: "#0a0a0a",
  bgDark: "#060606",
};

// ── Shared motion / surface tokens (new — purely structural, no new colors) ─
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const TRANSITION_FAST = `all 0.15s ${EASE}`;
const TRANSITION = `all 0.25s ${EASE}`;

function fmtMcap(n?: number): string {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtPct(n?: number): string | null {
  if (n === undefined || n === null) return null;
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}
function fmtSpan(sec: number): string {
  const s = Math.abs(sec);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}
function fmtPrice(n?: number): string {
  if (!n) return "—";
  if (n < 0.000001) return `$${n.toExponential(2)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

// Now delegates to the shared getTokenPrice() module (lib/getTokenPrice.ts)
// so TokenPanel, WinsPanel, and PaperTrader all read the exact same number
// for the exact same token — instead of each running its own independent
// fetch with its own fallback order and cache.
async function fetchLiveTokenData(ca: string): Promise<LiveTokenData> {
  try {
    const d = await getTokenPrice(ca);
    if (d.source === "none") return {};

    const age =
      d.ageMinutes !== undefined
        ? d.ageMinutes < 60
          ? `${d.ageMinutes}m old`
          : d.ageMinutes < 1440
            ? `${Math.floor(d.ageMinutes / 60)}h old`
            : `${Math.floor(d.ageMinutes / 1440)}d old`
        : undefined;

    return {
      mcap: d.mcap,
      liquidity: d.liquidity,
      priceChange1h: d.priceChange1h,
      priceChange24h: d.priceChange24h,
      volume24h: d.volume24h,
      price: d.price,
      age,
    };
  } catch {
    return {};
  }
}

// ── Candle history (for the built-in chart) — proxied through your own API
// route so the Birdeye key never touches the client. See /api/token-chart.
interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

async function fetchCandles(ca: string, tf: string): Promise<Candle[]> {
  try {
    const res = await fetch(`/api/token-chart?address=${ca}&tf=${tf}`, {
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.candles) ? data.candles : [];
  } catch {
    return [];
  }
}

// ── Small reusable surfaces ─────────────────────────────────────────────────
function Card({
  children,
  style,
  hoverable,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  hoverable?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => hoverable && setHover(true)}
      onMouseLeave={() => hoverable && setHover(false)}
      style={{
        background: C.bg,
        border: `1px solid ${hover ? "#2a2a2a" : C.border}`,
        borderRadius: 8,
        transition: TRANSITION_FAST,
        transform: hover ? "translateY(-1px)" : "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  loading,
  sub,
}: {
  label: string;
  value: string;
  color?: string;
  loading?: boolean;
  sub?: string;
}) {
  return (
    <Card hoverable style={{ padding: "10px 12px" }}>
      <div
        style={{
          color: C.label,
          fontSize: 8,
          ...MONO,
          letterSpacing: "0.14em",
          marginBottom: 6,
          textTransform: "uppercase" as const,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: loading ? "#222" : color || "#e2e2e2",
          fontSize: 16,
          fontWeight: 800,
          ...MONO,
          letterSpacing: "-0.01em",
          transition: TRANSITION_FAST,
        }}
      >
        {loading ? "···" : value}
      </div>
      {sub && !loading && (
        <div style={{ color: C.sub, fontSize: 8, ...MONO, marginTop: 3 }}>
          {sub}
        </div>
      )}
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// ── Built-in chart — orange line (Robinhood/Coinbase style) + candlesticks,
//    switchable, with timeframe pills. Renders as SVG so we fully control
//    color/fill/hover — no iframe branding to fight with.
// ═════════════════════════════════════════════════════════════════════════

const TIMEFRAMES = [
  { key: "1m", label: "1M" },
  { key: "5m", label: "5M" },
  { key: "15m", label: "15M" },
  { key: "1h", label: "1H" },
  { key: "4h", label: "4H" },
  { key: "1d", label: "1D" },
] as const;

function TokenChart({
  contractAddress,
  onOpenFull,
  height = 280,
  liveMcap,
  livePrice,
}: {
  contractAddress: string;
  onOpenFull: () => void;
  height?: number;
  liveMcap?: number; // current mcap from liveData, used to derive implied supply
  livePrice?: number; // current price from liveData, paired with liveMcap
}) {
  const [mode, setMode] = useState<"line" | "candles">("line");
  const [valueMode, setValueMode] = useState<"price" | "mcap">("price");
  const [tf, setTf] = useState<(typeof TIMEFRAMES)[number]["key"]>("15m");

  // candles only ever carry price — mcap = price * supply, and we don't
  // have supply directly, so back it out from the live price/mcap pair
  // you're already fetching elsewhere (liveData). Ratio holds roughly
  // constant since supply doesn't change, so it's safe to apply across
  // every historical candle even though liveMcap/livePrice are "now" values.
  const mcapMultiplier =
    liveMcap && livePrice && livePrice > 0 ? liveMcap / livePrice : null;
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [loadingMs, setLoadingMs] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<
    ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null
  >(null);
  const hasFitRef = useRef(false); // only auto-fit once per token/tf, not on every poll tick
  const candlesRef = useRef<Candle[]>([]); // mirror of `candles` state, read inside native mouse handlers so they're never stale
  const [measureBox, setMeasureBox] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    price1: number;
    price2: number;
    t1: number;
    t2: number;
  } | null>(null);
  const measuringRef = useRef(false);
  const measureStartRef = useRef<{ x: number; y: number } | null>(null);
  const measurePhaseRef = useRef<"idle" | "placing">("idle"); // click-to-start, move freely, click again to lock

  // Fetch + poll candle data
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadingMs(0);
    setCandles([]); // clear stale chart from previous token immediately
    setLastPrice(null);

    const startedAt = Date.now();
    const tick = setInterval(() => {
      if (alive) setLoadingMs(Date.now() - startedAt);
    }, 500);

    hasFitRef.current = false; // new token/timeframe — allow one fresh auto-fit
    measurePhaseRef.current = "idle";
    measureStartRef.current = null;
    setMeasureBox(null); // stale box from the previous token was staying on screen
    fetchCandles(contractAddress, tf).then((c) => {
      if (!alive) return;
      setCandles(c);
      setLoading(false);
    });
    const t = setInterval(() => {
      fetchCandles(contractAddress, tf).then((c) => {
        if (alive && c.length) setCandles(c);
      });
    }, 10000);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(tick);
    };
  }, [contractAddress, tf]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  // Create chart once per mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: C.bgDark },
        textColor: C.dim,
        fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "#161616" },
        horzLines: { color: "#161616" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "#555",
          width: 1,
          style: 2,
          labelBackgroundColor: "#0a0a0a",
          visible: true,
          labelVisible: true,
        },
        horzLine: {
          color: "#555",
          width: 1,
          style: 2,
          labelBackgroundColor: "#0a0a0a",
          visible: true,
          labelVisible: true,
        },
      },
      rightPriceScale: {
        borderColor: "#1a1a1a",
        scaleMargins: { top: 0.1, bottom: 0.15 },
      },
      timeScale: {
        borderColor: "#1a1a1a",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 8,
      },
      handleScroll: true,
      handleScale: true,
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();

    // ── Shift+drag measure tool ──────────────────────────────────────────
    // lightweight-charts has NO built-in measure tool (that's TradingView's
    // paid charting_library, a different product). Building it manually:
    // shift+mousedown starts a drag, mousemove tracks it converting pixel
    // coords to price/time via the chart's own coordinate APIs, mouseup
    // ends the drag but leaves the box on screen until dismissed.
    const el = containerRef.current;

    const handleClick = (e: MouseEvent) => {
      if (!el || !seriesRef.current) return;

      // idle → shift+click drops the first point and starts placing
      if (measurePhaseRef.current === "idle") {
        if (!e.shiftKey) {
          setMeasureBox(null); // plain click with nothing active — clears any leftover box
          return;
        }
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        measureStartRef.current = { x, y };
        measurePhaseRef.current = "placing";
        chart.applyOptions({ handleScroll: false, handleScale: false });
        setMeasureBox({
          x1: x,
          y1: y,
          x2: x,
          y2: y,
          price1: 0,
          price2: 0,
          t1: 0,
          t2: 0,
        });
        return;
      }

      // placing → any click locks the second point wherever it currently is
      if (measurePhaseRef.current === "placing") {
        measurePhaseRef.current = "idle";
        measureStartRef.current = null;
        chart.applyOptions({ handleScroll: true, handleScale: true });
        // measureBox already holds the latest position from the last mousemove
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (
        measurePhaseRef.current !== "placing" ||
        !measureStartRef.current ||
        !el ||
        !seriesRef.current
      )
        return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const { x: x1, y: y1 } = measureStartRef.current;

      const price1 = seriesRef.current.coordinateToPrice(y1);
      const price2 = seriesRef.current.coordinateToPrice(y);
      const t1 = chart.timeScale().coordinateToTime(x1);
      const t2 = chart.timeScale().coordinateToTime(x);

      setMeasureBox({
        x1,
        y1,
        x2: x,
        y2: y,
        price1: price1 ?? 0,
        price2: price2 ?? 0,
        t1: (t1 as number) ?? 0,
        t2: (t2 as number) ?? 0,
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        measurePhaseRef.current = "idle";
        measureStartRef.current = null;
        chart.applyOptions({ handleScroll: true, handleScale: true });
        setMeasureBox(null);
      }
    };

    el?.addEventListener("click", handleClick);
    // Capture phase, and on the element itself — lightweight-charts' own
    // crosshair handler sits on the internal canvas and stops mousemove
    // from bubbling to window, so a window-level listener never fires
    // while the cursor is actually over the chart. Capture-phase on `el`
    // runs before that internal handler gets a chance to stop it.
    el?.addEventListener("mousemove", handleMouseMove, { capture: true });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", handleResize);
      el?.removeEventListener("click", handleClick);
      el?.removeEventListener("mousemove", handleMouseMove, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Rebuild series when mode changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    const priceFormat = {
      type: "custom" as const,
      // minMove has to scale with the actual magnitude of the values being
      // plotted. 0.00000001 works for sub-cent token prices but is 19
      // orders of magnitude too fine for mcap values (~$10K-$1M+), which
      // was making the autoscale/tick generator produce garbage padded
      // ranges (e.g. axis running down to $-100000) on sparse data.
      minMove: valueMode === "mcap" ? 1 : 0.00000001,
      formatter: (p: number) =>
        valueMode === "mcap" ? fmtMcap(p) : fmtPrice(p),
    };

    if (mode === "candles") {
      seriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: C.green,
        downColor: C.red,
        borderVisible: false,
        wickUpColor: C.green,
        wickDownColor: C.red,
        priceFormat,
      });
    } else {
      seriesRef.current = chart.addSeries(LineSeries, {
        color: C.accent,
        lineWidth: 2,
        priceFormat,
      });
    }
  }, [mode, valueMode]);

  // Push data into the active series
  useEffect(() => {
    if (!seriesRef.current) return;

    if (!candles.length) {
      seriesRef.current.setData([]); // clear stale series when switching tokens
      chartRef.current?.applyOptions({
        rightPriceScale: { visible: false }, // hide axis instead of rendering garbage ticks on empty data
      });
      return;
    }

    chartRef.current?.applyOptions({ rightPriceScale: { visible: true } });

    const sortedRaw = [...candles].sort((a, b) => a.t - b.t);
    // Dedupe by timestamp — lightweight-charts throws a hard, uncatchable
    // assertion error if two candles share the same time value.
    const deduped = Array.from(
      new Map(sortedRaw.map((c) => [c.t, c])).values(),
    );

    // Sanitize: lightweight-charts also throws hard on NaN/Infinity/zero
    // values or on low > min(open,close) / high < max(open,close). A single
    // bad candle from an upstream source (pump.fun forward-fill, a $0 tick,
    // a negative price during a bad extraction) crashes setData() for the
    // WHOLE array with no visible error — that's the "just goes black"
    // symptom. Drop only the bad candle(s), keep the rest.
    // Reject candles where any OHLC value is more than 1000x smaller than
    // this candle's own high — that's a forward-fill/rounding artifact
    // (e.g. 3.39e-21 next to a real $0.00003 price), not a real trade.
    // A plain `n <= 0` check lets these through since they're still
    // technically positive, which blows up lightweight-charts' autoscale.
    const perCandleValid = deduped.filter((c) => {
      const nums = [c.o, c.h, c.l, c.c];
      if (
        nums.some((n) => typeof n !== "number" || !Number.isFinite(n) || n <= 0)
      )
        return false;
      if (c.l > Math.min(c.o, c.c) || c.h < Math.max(c.o, c.c)) return false;
      const maxVal = Math.max(...nums);
      const minVal = Math.min(...nums);
      if (maxVal / minVal > 1000) return false; // degenerate spread within one candle
      return true;
    });

    // Cross-candle check — a candle can be internally consistent (passes
    // the check above) but still be a forward-fill artifact sitting orders
    // of magnitude away from every other candle. That single outlier drags
    // the whole autoscale down toward zero (and even negative, via chart
    // padding), which is the "jumps back to near-zero" symptom. Compare
    // each candle's close against the MEDIAN close of the whole set —
    // median instead of mean so one existing outlier can't skew the
    // baseline it's being checked against.
    const closes = [...perCandleValid.map((c) => c.c)].sort((a, b) => a - b);
    const medianClose = closes.length
      ? closes[Math.floor(closes.length / 2)]
      : 0;
    const sorted =
      medianClose > 0
        ? perCandleValid.filter(
            (c) => c.c / medianClose > 0.02 && c.c / medianClose < 50,
          )
        : perCandleValid;

    if (!sorted.length) {
      setRenderError(
        `all ${deduped.length} candles failed validation — check console`,
      );
      console.error(
        "[TokenChart] every candle was invalid, raw sample:",
        deduped.slice(0, 3),
      );
      return;
    }
    if (sorted.length < deduped.length) {
      console.warn(
        `[TokenChart] dropped ${deduped.length - sorted.length} invalid candle(s)`,
        deduped.filter((c) => !sorted.includes(c)),
      );
    }

    setLastPrice(sorted[sorted.length - 1].c);

    const mult = valueMode === "mcap" && mcapMultiplier ? mcapMultiplier : 1;

    try {
      let plottedValues: number[] = [];

      if (mode === "candles") {
        const data: CandlestickData<Time>[] = sorted.map((c) => ({
          time: (c.t / 1000) as Time,
          open: c.o * mult,
          high: c.h * mult,
          low: c.l * mult,
          close: c.c * mult,
        }));
        (seriesRef.current as ISeriesApi<"Candlestick">).setData(data);
        plottedValues = data.flatMap((d) => [d.open, d.high, d.low, d.close]);
      } else {
        const data: LineData<Time>[] = sorted.map((c) => ({
          time: (c.t / 1000) as Time,
          value: c.c * mult,
        }));
        (seriesRef.current as ISeriesApi<"Line">).setData(data);
        plottedValues = data.map((d) => d.value);
      }

      // MCAP mode: don't trust lightweight-charts' autoscale. It's fine on
      // clean price data, but MCAP values are price candles multiplied by
      // a large static ratio, so any single upstream artifact (which the
      // filters above don't catch 100% of, since the source data itself
      // is inconsistent poll-to-poll) gets amplified into a huge outlier
      // that drags the whole axis toward zero/negative. Clamp the visible
      // range manually off the ACTUAL plotted min/max instead, so one bad
      // point can only ever push the range to its own value, never beyond.
      const priceScale = chartRef.current?.priceScale("right");
      if (valueMode === "mcap" && plottedValues.length && priceScale) {
        const lo = Math.min(...plottedValues);
        const hi = Math.max(...plottedValues);
        const pad = (hi - lo) * 0.1 || hi * 0.1 || 1;
        priceScale.applyOptions({
          autoScale: false,
        });
        chartRef.current?.applyOptions({
          rightPriceScale: {
            autoScale: false,
          },
        });
        seriesRef.current.applyOptions({
          autoscaleInfoProvider: () => ({
            priceRange: {
              minValue: Math.max(0, lo - pad),
              maxValue: hi + pad,
            },
          }),
        });
      } else if (priceScale) {
        priceScale.applyOptions({ autoScale: true });
        chartRef.current?.applyOptions({
          rightPriceScale: { autoScale: true },
        });
        seriesRef.current.applyOptions({ autoscaleInfoProvider: undefined });
      }

      if (!hasFitRef.current) {
        chartRef.current?.timeScale().fitContent();
        hasFitRef.current = true;
      }
      setRenderError(null);
    } catch (e) {
      console.error(
        "[TokenChart] setData threw",
        e,
        "sample:",
        sorted.slice(0, 5),
      );
      setRenderError(e instanceof Error ? e.message : "chart render failed");
    }
  }, [candles, mode, valueMode, mcapMultiplier]);

  const up =
    candles.length > 1 ? candles[candles.length - 1].c >= candles[0].c : true;

  const measureStats = measureBox
    ? (() => {
        const pctChange =
          measureBox.price1 !== 0
            ? ((measureBox.price2 - measureBox.price1) / measureBox.price1) *
              100
            : 0;
        const priceDelta = measureBox.price2 - measureBox.price1;
        const tLo = Math.min(measureBox.t1, measureBox.t2);
        const tHi = Math.max(measureBox.t1, measureBox.t2);
        const barsCount = candlesRef.current.filter(
          (c) => c.t / 1000 >= tLo && c.t / 1000 <= tHi,
        ).length;
        return { pctChange, priceDelta, barsCount, span: fmtSpan(tHi - tLo) };
      })()
    : null;

  return (
    <Card style={{ overflow: "hidden", marginBottom: 12 }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 11px",
          borderBottom: `1px solid ${C.border}`,
          flexWrap: "wrap" as const,
        }}
      >
        <div
          style={{
            display: "flex",
            background: "#050505",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: 2,
            gap: 2,
          }}
        >
          {(
            [
              { key: "line", label: "LINE" },
              { key: "candles", label: "CANDLES" },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              style={{
                background: mode === m.key ? C.accent : "transparent",
                color: mode === m.key ? "#0a0a0a" : C.dim,
                border: "none",
                borderRadius: 4,
                fontSize: 8,
                fontWeight: 800,
                ...MONO,
                letterSpacing: "0.08em",
                padding: "4px 9px",
                cursor: "pointer",
                transition: TRANSITION_FAST,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            background: "#050505",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: 2,
            gap: 2,
          }}
        >
          {(
            [
              { key: "price", label: "PRICE" },
              { key: "mcap", label: "MCAP" },
            ] as const
          ).map((v) => (
            <button
              key={v.key}
              onClick={() => setValueMode(v.key)}
              disabled={v.key === "mcap" && !mcapMultiplier}
              title={
                v.key === "mcap" && !mcapMultiplier
                  ? "mcap unavailable — no live supply data yet"
                  : undefined
              }
              style={{
                background: valueMode === v.key ? "#e8490f14" : "transparent",
                color:
                  v.key === "mcap" && !mcapMultiplier
                    ? "#333"
                    : valueMode === v.key
                      ? C.accent
                      : C.dim,
                border: `1px solid ${valueMode === v.key ? "#e8490f33" : "transparent"}`,
                borderRadius: 4,
                fontSize: 8,
                fontWeight: 800,
                ...MONO,
                letterSpacing: "0.08em",
                padding: "4px 9px",
                cursor:
                  v.key === "mcap" && !mcapMultiplier
                    ? "not-allowed"
                    : "pointer",
                transition: TRANSITION_FAST,
              }}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 3 }}>
          {TIMEFRAMES.map((t) => (
            <button
              key={t.key}
              onClick={() => setTf(t.key)}
              style={{
                background: tf === t.key ? "#e8490f14" : "transparent",
                color: tf === t.key ? C.accent : C.dim,
                border: `1px solid ${tf === t.key ? "#e8490f33" : "transparent"}`,
                borderRadius: 4,
                fontSize: 8,
                fontWeight: 700,
                ...MONO,
                padding: "3px 7px",
                cursor: "pointer",
                transition: TRANSITION_FAST,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: loading ? "#ffaa00" : `${C.green}aa`,
              display: "inline-block",
              transition: TRANSITION_FAST,
            }}
          />
          <a
            href={`https://dexscreener.com/solana/${contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "none" }}
          >
            <span
              style={{
                fontSize: 7,
                color: C.blue,
                border: `1px solid ${C.blue}33`,
                padding: "3px 7px",
                borderRadius: 3,
                ...MONO,
              }}
            >
              DEX ↗
            </span>
          </a>
          <a
            href={`https://pump.fun/${contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "none" }}
          >
            <span
              style={{
                fontSize: 7,
                color: C.purple,
                border: `1px solid ${C.purple}33`,
                padding: "3px 7px",
                borderRadius: 3,
                ...MONO,
              }}
            >
              PUMP ↗
            </span>
          </a>
          <button
            onClick={onOpenFull}
            style={{
              background: "transparent",
              border: `1px solid ${C.accent}33`,
              color: C.accent,
              fontSize: 7,
              ...MONO,
              padding: "3px 7px",
              borderRadius: 3,
              cursor: "pointer",
              transition: TRANSITION_FAST,
            }}
          >
            EXPAND ↗
          </button>
        </div>
      </div>

      {/* Chart body */}
      <div style={{ position: "relative", height, background: C.bgDark }}>
        {loading && !candles.length && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column" as const,
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              zIndex: 1,
              background: C.bgDark,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                border: `2px solid #222`,
                borderTopColor: C.accent,
                animation: "tp-spin 0.7s linear infinite",
              }}
            />
            <div
              style={{
                color: "#ccc",
                fontSize: 10,
                ...MONO,
                letterSpacing: "0.1em",
                fontWeight: 700,
              }}
            >
              LOADING CHART…
            </div>
            <div
              style={{
                color: C.sub,
                fontSize: 8,
                ...MONO,
              }}
            >
              {loadingMs < 4000
                ? "fetching candles"
                : loadingMs < 9000
                  ? "still fetching — on-chain fallback can be slow"
                  : "taking longer than usual, hang tight"}
            </div>
            <style>{`
              @keyframes tp-spin { to { transform: rotate(360deg); } }
            `}</style>
          </div>
        )}
        {!loading && candles.length > 0 && candles.length < 3 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              color: C.dim,
              fontSize: 9,
              ...MONO,
              zIndex: 1,
              background: C.bgDark,
              textAlign: "center",
              padding: 16,
            }}
          >
            <span>TOO NEW — NOT ENOUGH TRADE HISTORY YET</span>
            <span style={{ fontSize: 8, opacity: 0.6 }}>
              chart fills in as trades come through
            </span>
          </div>
        )}
        {!loading && !candles.length && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              color: C.dim,
              fontSize: 9,
              ...MONO,
              zIndex: 1,
              background: C.bgDark,
              textAlign: "center",
              padding: 16,
            }}
          >
            <span>NO CHART DATA YET</span>
            <span style={{ fontSize: 8, opacity: 0.6 }}>
              coin may be too fresh — no pool or trade history recorded yet
            </span>
          </div>
        )}
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%", cursor: "crosshair" }}
        />
        {measureBox && measureStats && (
          <>
            {(() => {
              const bx1 = Math.min(measureBox.x1, measureBox.x2);
              const by1 = Math.min(measureBox.y1, measureBox.y2);
              const bw = Math.abs(measureBox.x2 - measureBox.x1);
              const bh = Math.abs(measureBox.y2 - measureBox.y1);
              const cx = bx1 + bw / 2;
              const cy = by1 + bh / 2;
              const up = measureStats.pctChange >= 0;
              const boxColor = C.accent;
              return (
                <>
                  <div
                    style={{
                      position: "absolute",
                      left: bx1,
                      top: by1,
                      width: bw,
                      height: bh,
                      background: `${boxColor}4d`,
                      border: `1px solid ${boxColor}`,
                      pointerEvents: "none" as const,
                      zIndex: 3,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: bx1,
                      top: cy - 0.5,
                      width: bw,
                      height: 1,
                      background: "#fff",
                      opacity: 0.8,
                      pointerEvents: "none" as const,
                      zIndex: 4,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: cx - 0.5,
                      top: by1,
                      width: 1,
                      height: bh,
                      background: "#fff",
                      opacity: 0.8,
                      pointerEvents: "none" as const,
                      zIndex: 4,
                    }}
                  />
                  {[
                    { l: bx1 - 5, t: cy - 4, rot: 270 },
                    { l: bx1 + bw - 3, t: cy - 4, rot: 90 },
                    { l: cx - 4, t: by1 - 5, rot: 0 },
                    { l: cx - 4, t: by1 + bh - 3, rot: 180 },
                  ].map((a, i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: a.l,
                        top: a.t,
                        width: 0,
                        height: 0,
                        borderLeft: "4px solid transparent",
                        borderRight: "4px solid transparent",
                        borderBottom: "6px solid #fff",
                        opacity: 0.8,
                        transform: `rotate(${a.rot}deg)`,
                        pointerEvents: "none" as const,
                        zIndex: 4,
                      }}
                    />
                  ))}
                  <div
                    style={{
                      position: "absolute",
                      left: cx,
                      top: by1 - 6,
                      transform: "translate(-50%, -100%)",
                      background: boxColor,
                      color: "#fff",
                      fontSize: 10,
                      ...MONO,
                      fontWeight: 700,
                      padding: "6px 10px",
                      borderRadius: 4,
                      pointerEvents: "none" as const,
                      zIndex: 5,
                      whiteSpace: "nowrap" as const,
                      lineHeight: 1.6,
                      textAlign: "center" as const,
                    }}
                  >
                    <div>
                      {fmtPrice(Math.abs(measureStats.priceDelta))} (
                      {up ? "+" : ""}
                      {measureStats.pctChange.toFixed(2)}%)
                    </div>
                    <div style={{ opacity: 0.9, fontWeight: 500 }}>
                      {measureStats.barsCount} bars, {measureStats.span}
                    </div>
                  </div>
                </>
              );
            })()}
          </>
        )}
        {renderError && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column" as const,
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              color: C.red,
              fontSize: 9,
              ...MONO,
              zIndex: 2,
              background: C.bgDark,
              textAlign: "center" as const,
              padding: 16,
            }}
          >
            <span>CHART RENDER ERROR</span>
            <span style={{ fontSize: 8, color: C.sub, opacity: 0.8 }}>
              {renderError}
            </span>
          </div>
        )}

        {lastPrice !== null && candles.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 10,
              textAlign: "right" as const,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                color: up ? C.green : C.red,
                fontSize: 11,
                fontWeight: 800,
                ...MONO,
              }}
            >
              {valueMode === "mcap" && mcapMultiplier
                ? fmtMcap(lastPrice * mcapMultiplier)
                : fmtPrice(lastPrice)}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Full-screen chart takeover ──────────────────────────────────────────────
function FullChart({
  contractAddress,
  onBack,
  liveMcap,
  livePrice,
}: {
  contractAddress: string;
  onBack: () => void;
  liveMcap?: number;
  livePrice?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: C.bgDark,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: `1px solid ${C.border}`,
          background: "#030303",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "transparent",
            border: `1px solid ${C.border}`,
            color: C.dim,
            fontSize: 8,
            ...MONO,
            padding: "4px 10px",
            borderRadius: 4,
            cursor: "pointer",
            transition: TRANSITION_FAST,
          }}
        >
          ← BACK
        </button>
        <span
          style={{
            color: C.accent,
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: "0.16em",
            ...MONO,
          }}
        >
          ⚡ WRAITH LIVE
        </span>
        <span style={{ color: C.dim, fontSize: 7, ...MONO }}>
          · {contractAddress.slice(0, 6)}…{contractAddress.slice(-4)}
        </span>
      </div>
      <div style={{ flex: 1, padding: 12, overflow: "hidden" }}>
        <TokenChart
          contractAddress={contractAddress}
          onOpenFull={onBack}
          height={
            typeof window !== "undefined" ? window.innerHeight - 140 : 500
          }
          liveMcap={liveMcap}
          livePrice={livePrice}
        />
      </div>
    </div>
  );
}

export default function TokenPanel({ selectedMeme }: Props) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [evidence, setEvidence] = useState<ViralEvidence | null>(null);
  const [liveData, setLiveData] = useState<LiveTokenData>({});
  const [liveLoading, setLiveLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "overview" | "evidence" | "safety"
  >("overview");
  const [fullChart, setFullChart] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [copiedCA, setCopiedCA] = useState(false);

  useEffect(() => {
    if (!publicKey) return;
    connection
      .getBalance(publicKey)
      .then((l) => setSolBalance(l / LAMPORTS_PER_SOL))
      .catch(() => {});
  }, [publicKey, connection, selectedMeme]);

  useEffect(() => {
    if (!selectedMeme?.contractAddress) {
      setLiveData({});
      return;
    }
    setLiveLoading(true);
    setLiveData({}); // clear stale stats from previous token immediately
    fetchLiveTokenData(selectedMeme.contractAddress).then((d) => {
      setLiveData(d);
      setLiveLoading(false);
    });
    // Poll every 8s — Jupiter Price v2 is fast enough, matches chart update cadence
    const t = setInterval(() => {
      if (selectedMeme?.contractAddress)
        fetchLiveTokenData(selectedMeme.contractAddress).then((d) => {
          if (d && Object.keys(d).length) setLiveData(d);
        });
    }, 8000);
    return () => clearInterval(t);
  }, [selectedMeme?.contractAddress]);

  const fetchEvidence = useCallback(async (meme: ScanResult) => {
    setEvidence({
      links: [],
      aiAnalysis: "",
      safetyScore: 0,
      safetyBreakdown: [],
      prediction: "weak",
      predictionReason: "",
      loading: true,
    });
    try {
      const params = new URLSearchParams({
        keyword: meme.keyword,
        contract: meme.contractAddress || "",
        platforms: (meme.platforms || []).join(","),
        context: meme.aiContext || "",
        mcap: String(meme.mcap || 0),
        liquidity: String(meme.liquidity || 0),
        rugRisk: meme.rugRisk || "unknown",
        priceChange1h: String(meme.priceChange1h || 0),
        celebMention: meme.celebMention || "",
      });
      const res = await fetch(`/api/analyze?${params.toString()}`);
      const data = await res.json();
      setEvidence({ ...data, loading: false });
    } catch (e) {
      setEvidence((prev) =>
        prev ? { ...prev, loading: false, error: String(e) } : null,
      );
    }
  }, []);

  useEffect(() => {
    if (selectedMeme) {
      setEvidence(null);
      setActiveTab("overview");
      setFullChart(false);
      fetchEvidence(selectedMeme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMeme?.contractAddress ?? selectedMeme?.keyword]);

  const copyCA = () => {
    if (!selectedMeme?.contractAddress) return;
    navigator.clipboard.writeText(selectedMeme.contractAddress);
    setCopiedCA(true);
    setTimeout(() => setCopiedCA(false), 2000);
  };

  if (!selectedMeme) {
    return (
      <div
        style={{
          background: C.bgDark,
          border: "1px solid #111",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: 12,
        }}
      >
        <div
          style={{
            color: "#181818",
            fontSize: 32,
            letterSpacing: "0.3em",
            ...MONO,
          }}
        >
          WRAITH
        </div>
        <div
          style={{
            color: "#242424",
            fontSize: 10,
            letterSpacing: "0.2em",
            ...MONO,
          }}
        >
          SELECT A SIGNAL TO ANALYZE
        </div>
      </div>
    );
  }

  // Full chart mode — takes over entire panel
  if (fullChart && selectedMeme.contractAddress) {
    return (
      <FullChart
        contractAddress={selectedMeme.contractAddress}
        onBack={() => setFullChart(false)}
        liveMcap={liveData.mcap}
        livePrice={liveData.price}
      />
    );
  }

  // liveData.mcap comes from Jupiter (real-time) — never fall back to selectedMeme.mcap
  // which was captured at scan time and is always stale
  const displayMcap = liveData.mcap ?? undefined;
  const displayLiq = liveData.liquidity || selectedMeme.liquidity;
  const displayCh1h = liveData.priceChange1h ?? selectedMeme.priceChange1h;
  const displayCh24h = liveData.priceChange24h ?? selectedMeme.priceChange24h;
  const displayAge = liveData.age || selectedMeme.ageLabel;
  const displayPrice = liveData.price;
  const displayVolume = liveData.volume24h || selectedMeme.volume;
  const safetyScore = evidence?.safetyScore ?? null;
  const prediction = evidence?.prediction ?? null;
  const safetyColor =
    safetyScore !== null
      ? safetyScore >= 70
        ? C.green
        : safetyScore >= 40
          ? "#ffaa00"
          : "#ff2222"
      : "#444";
  const isCeleb =
    selectedMeme.onCeleb ||
    (selectedMeme.platforms || []).includes("celebrity");

  const PLAT_COLOR: Record<string, string> = {
    celebrity: C.gold,
    ai: C.accent,
    pumpfun: C.purple,
    dexscreener: C.blue,
    twitter: "#c8d0dc",
    coingecko: "#8dc63f",
    reddit: "#ff6644",
    "google-trends": "#5a9af4",
    "google-news": "#5a9af4",
    youtube: "#ff4444",
    kym: "#44cc44",
    hackernews: "#ff8833",
    telegram: "#36b5f4",
  };

  const tabs = [
    { key: "overview", label: "OVERVIEW" },
    { key: "evidence", label: "EVIDENCE" },
    { key: "safety", label: "SAFETY" },
  ] as const;

  return (
    <div
      style={{
        background: C.bgDark,
        border: "none",
        borderRadius: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          padding: "14px 16px 0",
          borderBottom: "1px solid #1a1a1a",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 12,
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Token name + badges */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                marginBottom: 6,
                flexWrap: "wrap" as const,
              }}
            >
              <span
                style={{
                  color: isCeleb ? C.gold : "#fff",
                  fontSize: 23,
                  fontWeight: 900,
                  ...MONO,
                  letterSpacing: "0.03em",
                }}
              >
                ${selectedMeme.keyword.toUpperCase()}
              </span>
              {isCeleb && (
                <Badge color={C.gold} bg="#ffd7000d">
                  ⭐ {selectedMeme.celebMention?.toUpperCase() || "CELEB"}
                </Badge>
              )}
              {selectedMeme.isNewCoin && (
                <Badge color={C.purple}>NEW COIN</Badge>
              )}
              {selectedMeme.isViralTrend && !selectedMeme.isNewCoin && (
                <Badge color="#ffaa00">VIRAL TREND</Badge>
              )}
              {prediction && !evidence?.loading && (
                <Badge
                  color={PRED_COLOR[prediction]}
                  bg={`${PRED_COLOR[prediction]}0d`}
                  bold
                >
                  {PRED_LABEL[prediction]}
                </Badge>
              )}
            </div>

            {/* Price row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginBottom: 7,
              }}
            >
              {displayPrice && (
                <span
                  style={{
                    color: C.accent,
                    fontSize: 15,
                    fontWeight: 700,
                    ...MONO,
                  }}
                >
                  {fmtPrice(displayPrice)}
                </span>
              )}
              {displayCh1h !== undefined && displayCh1h !== null && (
                <span
                  style={{
                    color: (displayCh1h ?? 0) >= 0 ? C.green : C.red,
                    fontSize: 12,
                    fontWeight: 700,
                    ...MONO,
                  }}
                >
                  {fmtPct(displayCh1h)}{" "}
                  <span style={{ color: C.dim, fontSize: 8 }}>1h</span>
                </span>
              )}
              {displayCh24h !== undefined && displayCh24h !== null && (
                <span
                  style={{
                    color: (displayCh24h ?? 0) >= 0 ? C.green : C.red,
                    fontSize: 11,
                    ...MONO,
                    opacity: 0.8,
                  }}
                >
                  {fmtPct(displayCh24h)}{" "}
                  <span style={{ color: C.dim, fontSize: 8 }}>24h</span>
                </span>
              )}
              {selectedMeme.contractAddress && (
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: liveLoading ? "#ffaa00" : "#00c47a55",
                    display: "inline-block",
                    transition: TRANSITION_FAST,
                  }}
                  title="Live · 8s"
                />
              )}
            </div>

            {/* AI narrative */}
            {selectedMeme.aiContext && (
              <div
                style={{
                  background: isCeleb ? "#0d0a00" : "#0a0a0d",
                  border: `1px solid ${isCeleb ? "#ffd70022" : "#e8490f22"}`,
                  borderRadius: 6,
                  padding: "8px 11px",
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    color: isCeleb ? C.gold : C.accent,
                    fontSize: 8,
                    ...MONO,
                    letterSpacing: "0.14em",
                    marginBottom: 4,
                  }}
                >
                  {isCeleb
                    ? `⭐ ${selectedMeme.celebMention?.toUpperCase() || "CELEBRITY"} TRIGGER`
                    : "✦ NARRATIVE ORIGIN"}
                </div>
                <div
                  style={{
                    color: C.body,
                    fontSize: 9,
                    ...MONO,
                    lineHeight: 1.7,
                  }}
                >
                  {selectedMeme.aiContext}
                </div>
              </div>
            )}
          </div>

          {/* Safety circle */}
          {safetyScore !== null && !evidence?.loading && (
            <div
              style={{
                display: "flex",
                flexDirection: "column" as const,
                alignItems: "center",
                gap: 4,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: "50%",
                  border: `2px solid ${safetyColor}`,
                  display: "flex",
                  flexDirection: "column" as const,
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: `0 0 14px ${safetyColor}44`,
                  transition: TRANSITION,
                }}
              >
                <span
                  style={{
                    color: safetyColor,
                    fontSize: 14,
                    fontWeight: 900,
                    ...MONO,
                    lineHeight: 1,
                  }}
                >
                  {safetyScore}
                </span>
                <span
                  style={{
                    color: safetyColor,
                    fontSize: 6,
                    ...MONO,
                    opacity: 0.6,
                  }}
                >
                  /100
                </span>
              </div>
              <span
                style={{
                  color: safetyColor,
                  fontSize: 7,
                  ...MONO,
                  letterSpacing: "0.1em",
                }}
              >
                SAFETY
              </span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2 }}>
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                background: "transparent",
                border: "none",
                borderBottom:
                  activeTab === key
                    ? `2px solid ${C.accent}`
                    : "2px solid transparent",
                color: activeTab === key ? C.accent : C.dim,
                fontSize: 9,
                ...MONO,
                letterSpacing: "0.12em",
                padding: "6px 12px",
                cursor: "pointer",
                transition: TRANSITION_FAST,
              }}
              onMouseEnter={(e) => {
                if (activeTab !== key)
                  (e.currentTarget as HTMLElement).style.color = C.sub;
              }}
              onMouseLeave={(e) => {
                if (activeTab !== key)
                  (e.currentTarget as HTMLElement).style.color = C.dim;
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        {/* ════ OVERVIEW ════ */}
        {activeTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {selectedMeme.contractAddress ? (
              <TokenChart
                contractAddress={selectedMeme.contractAddress}
                onOpenFull={() => setFullChart(true)}
                liveMcap={displayMcap}
                livePrice={displayPrice}
              />
            ) : (
              <div
                style={{
                  height: 100,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                }}
              >
                <span style={{ color: C.label, fontSize: 9, ...MONO }}>
                  NO CONTRACT — CHART UNAVAILABLE
                </span>
              </div>
            )}

            {/* Stats grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <StatCard
                label="Market Cap"
                value={fmtMcap(displayMcap)}
                loading={liveLoading && !displayMcap}
              />
              <StatCard
                label="Liquidity"
                value={fmtMcap(displayLiq)}
                color={
                  !displayLiq
                    ? C.dim
                    : displayLiq >= 50000
                      ? C.green
                      : displayLiq >= 10000
                        ? "#ffaa00"
                        : "#ff4444"
                }
                loading={liveLoading && !displayLiq}
                sub={
                  displayLiq && displayLiq < 10000 ? "⚠ Very low" : undefined
                }
              />
              <StatCard
                label="1H Change"
                value={fmtPct(displayCh1h) || "—"}
                color={(displayCh1h ?? 0) >= 0 ? C.green : C.red}
                loading={liveLoading && displayCh1h === undefined}
              />
              <StatCard
                label="24H Change"
                value={fmtPct(displayCh24h) || "—"}
                color={(displayCh24h ?? 0) >= 0 ? C.green : C.red}
                loading={liveLoading && displayCh24h === undefined}
              />
              <StatCard label="Age" value={displayAge || "—"} />
              <StatCard
                label="24H Volume"
                value={fmtMcap(displayVolume)}
                color={displayVolume ? C.accent : undefined}
              />
            </div>

            {/* Contract address */}
            {selectedMeme.contractAddress && (
              <Card style={{ padding: "10px 12px" }}>
                <div
                  style={{
                    color: C.label,
                    fontSize: 8,
                    ...MONO,
                    letterSpacing: "0.14em",
                    marginBottom: 6,
                  }}
                >
                  CONTRACT ADDRESS
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      color: C.sub,
                      fontSize: 8,
                      ...MONO,
                      wordBreak: "break-all" as const,
                      flex: 1,
                    }}
                  >
                    {selectedMeme.contractAddress}
                  </span>
                  <button
                    onClick={copyCA}
                    style={{
                      background: copiedCA ? "#001a0a" : "#1a1a1a",
                      border: `1px solid ${copiedCA ? "#00c47a33" : "#2a2a2a"}`,
                      color: copiedCA ? C.green : C.sub,
                      fontSize: 8,
                      ...MONO,
                      padding: "5px 11px",
                      borderRadius: 4,
                      cursor: "pointer",
                      flexShrink: 0,
                      transition: TRANSITION_FAST,
                    }}
                  >
                    {copiedCA ? "COPIED!" : "COPY"}
                  </button>
                </div>
              </Card>
            )}

            {/* Quick links */}
            {selectedMeme.contractAddress && (
              <div
                style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}
              >
                <LinkPill
                  label="DexScreener"
                  url={`https://dexscreener.com/solana/${selectedMeme.contractAddress}`}
                  color={C.blue}
                />
                <LinkPill
                  label="Pump.fun"
                  url={`https://pump.fun/${selectedMeme.contractAddress}`}
                  color={C.purple}
                />
                <LinkPill
                  label="Rugcheck"
                  url={`https://rugcheck.xyz/tokens/${selectedMeme.contractAddress}`}
                  color={C.green}
                />
                <LinkPill
                  label="Solscan"
                  url={`https://solscan.io/token/${selectedMeme.contractAddress}`}
                  color={C.accent}
                />
              </div>
            )}

            {/* Platforms */}
            <div>
              <div
                style={{
                  color: C.label,
                  fontSize: 8,
                  ...MONO,
                  letterSpacing: "0.12em",
                  marginBottom: 7,
                }}
              >
                DETECTED ON
              </div>
              <div
                style={{ display: "flex", flexWrap: "wrap" as const, gap: 5 }}
              >
                {(selectedMeme.platforms || []).map((plat) => {
                  const col = PLAT_COLOR[plat] || C.sub;
                  return (
                    <span
                      key={plat}
                      style={{
                        fontSize: 9,
                        ...MONO,
                        color: col,
                        background: "#0d0d0d",
                        border: `1px solid ${col}22`,
                        padding: "4px 9px",
                        borderRadius: 4,
                        transition: TRANSITION_FAST,
                      }}
                    >
                      {PLATFORM_ICON[plat] || "·"}{" "}
                      {plat.toUpperCase().replace(/-/g, " ")}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* AI Prediction */}
            {evidence?.predictionReason && !evidence.loading && (
              <div
                style={{
                  background:
                    prediction === "strong"
                      ? "#001a0a"
                      : prediction === "avoid"
                        ? "#1a0000"
                        : "#0d0d00",
                  border: `1px solid ${PRED_COLOR[prediction!]}22`,
                  borderRadius: 8,
                  padding: "11px 13px",
                }}
              >
                <div
                  style={{
                    color: PRED_COLOR[prediction!],
                    fontSize: 8,
                    ...MONO,
                    letterSpacing: "0.12em",
                    marginBottom: 5,
                  }}
                >
                  AI PREDICTION
                </div>
                <div
                  style={{
                    color: C.body,
                    fontSize: 9,
                    ...MONO,
                    lineHeight: 1.7,
                  }}
                >
                  {evidence.predictionReason}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ EVIDENCE ════ */}
        {activeTab === "evidence" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {evidence?.loading ? (
              <LoadingLine text="FETCHING VIRAL EVIDENCE…" />
            ) : (
              <>
                {evidence?.aiAnalysis && (
                  <Card style={{ padding: 13 }}>
                    <div
                      style={{
                        color: C.accent,
                        fontSize: 8,
                        ...MONO,
                        letterSpacing: "0.15em",
                        marginBottom: 8,
                      }}
                    >
                      ✦ AI ANALYSIS
                    </div>
                    <div
                      style={{
                        color: C.body,
                        fontSize: 10,
                        ...MONO,
                        lineHeight: 1.8,
                        whiteSpace: "pre-wrap" as const,
                      }}
                    >
                      {evidence.aiAnalysis}
                    </div>
                  </Card>
                )}
                {selectedMeme.contractAddress && (
                  <div
                    style={{
                      display: "flex",
                      gap: 7,
                      flexWrap: "wrap" as const,
                    }}
                  >
                    <LinkPill
                      label="DexScreener"
                      url={`https://dexscreener.com/solana/${selectedMeme.contractAddress}`}
                      color={C.blue}
                    />
                    <LinkPill
                      label="Pump.fun"
                      url={`https://pump.fun/${selectedMeme.contractAddress}`}
                      color={C.purple}
                    />
                    <LinkPill
                      label="Rugcheck"
                      url={`https://rugcheck.xyz/tokens/${selectedMeme.contractAddress}`}
                      color={C.green}
                    />
                  </div>
                )}
                <div>
                  <div
                    style={{
                      color: C.label,
                      fontSize: 8,
                      ...MONO,
                      letterSpacing: "0.12em",
                      marginBottom: 8,
                    }}
                  >
                    VIRAL SOURCES & PROOF
                  </div>
                  {!evidence?.links?.length ? (
                    <div style={{ color: C.dim, fontSize: 10, ...MONO }}>
                      No direct links found — trend may be too new
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column" as const,
                        gap: 7,
                      }}
                    >
                      {evidence.links.map((link, i) => (
                        <a
                          key={i}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: "none", display: "block" }}
                        >
                          <Card
                            hoverable
                            style={{ padding: "11px 13px", cursor: "pointer" }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                marginBottom: 4,
                              }}
                            >
                              <span style={{ fontSize: 10 }}>
                                {PLATFORM_ICON[link.platform] || "🔗"}
                              </span>
                              <span
                                style={{
                                  color: C.sub,
                                  fontSize: 8,
                                  ...MONO,
                                  letterSpacing: "0.1em",
                                  textTransform: "uppercase" as const,
                                }}
                              >
                                {link.platform}
                              </span>
                              <span
                                style={{
                                  color: C.dim,
                                  fontSize: 8,
                                  ...MONO,
                                  marginLeft: "auto",
                                }}
                              >
                                ↗ OPEN
                              </span>
                            </div>
                            <div
                              style={{
                                color: C.body,
                                fontSize: 10,
                                ...MONO,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap" as const,
                              }}
                            >
                              {link.title}
                            </div>
                          </Card>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ════ SAFETY ════ */}
        {activeTab === "safety" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {evidence?.loading ? (
              <LoadingLine text="RUNNING SAFETY ANALYSIS…" />
            ) : (
              <>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div
                    style={{
                      width: 74,
                      height: 74,
                      borderRadius: "50%",
                      border: `3px solid ${safetyColor}`,
                      display: "flex",
                      flexDirection: "column" as const,
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: `0 0 22px ${safetyColor}33`,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        color: safetyColor,
                        fontSize: 22,
                        fontWeight: 900,
                        ...MONO,
                      }}
                    >
                      {safetyScore ?? "?"}
                    </span>
                    <span
                      style={{
                        color: safetyColor,
                        fontSize: 7,
                        ...MONO,
                        opacity: 0.6,
                      }}
                    >
                      /100
                    </span>
                  </div>
                  <div>
                    <div
                      style={{
                        color: safetyColor,
                        fontSize: 13,
                        fontWeight: 700,
                        ...MONO,
                        marginBottom: 5,
                      }}
                    >
                      {(safetyScore ?? 0) >= 70
                        ? "✓ LOOKS SAFE"
                        : (safetyScore ?? 0) >= 40
                          ? "⚠ USE CAUTION"
                          : "✗ HIGH RISK"}
                    </div>
                    <div
                      style={{
                        color: C.sub,
                        fontSize: 9,
                        ...MONO,
                        lineHeight: 1.7,
                      }}
                    >
                      Rug check:{" "}
                      <span
                        style={{
                          color: RUG_COLOR[selectedMeme.rugRisk || "unknown"],
                          fontWeight: 700,
                        }}
                      >
                        {(selectedMeme.rugRisk || "unknown").toUpperCase()}
                      </span>
                      {selectedMeme.rugDetails && (
                        <span style={{ color: C.dim }}>
                          {" "}
                          — {selectedMeme.rugDetails}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column" as const,
                    gap: 7,
                  }}
                >
                  {(
                    evidence?.safetyBreakdown ||
                    defaultSafetyBreakdown(selectedMeme)
                  ).map((item, i) => (
                    <Card
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        borderColor: item.pass ? "#00c47a11" : "#ff222211",
                        padding: "9px 12px",
                      }}
                    >
                      <span
                        style={{
                          color: item.pass ? C.green : "#ff2222",
                          fontSize: 12,
                          flexShrink: 0,
                          marginTop: -1,
                        }}
                      >
                        {item.pass ? "✓" : "✗"}
                      </span>
                      <div>
                        <div
                          style={{
                            color: item.pass ? C.green : "#ff4444",
                            fontSize: 9,
                            ...MONO,
                            fontWeight: 700,
                            marginBottom: 3,
                          }}
                        >
                          {item.label}
                        </div>
                        <div
                          style={{
                            color: C.sub,
                            fontSize: 9,
                            ...MONO,
                            lineHeight: 1.6,
                          }}
                        >
                          {item.detail}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
                {selectedMeme.rugRisk === "high" && (
                  <div
                    style={{
                      background: "#1a0000",
                      border: "1px solid #ff222233",
                      borderRadius: 8,
                      padding: "11px 13px",
                    }}
                  >
                    <div
                      style={{
                        color: "#ff2222",
                        fontSize: 10,
                        ...MONO,
                        fontWeight: 700,
                        marginBottom: 4,
                      }}
                    >
                      ⚠ DO NOT BUY
                    </div>
                    <div
                      style={{
                        color: "#cc6666",
                        fontSize: 9,
                        ...MONO,
                        lineHeight: 1.7,
                      }}
                    >
                      This token has been flagged as high risk by Rugcheck. Mint
                      or freeze authority may still be active.
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small presentational helpers ────────────────────────────────────────────
function Badge({
  children,
  color,
  bg,
  bold,
}: {
  children: React.ReactNode;
  color: string;
  bg?: string;
  bold?: boolean;
}) {
  return (
    <span
      style={{
        fontSize: 9,
        color,
        border: `1px solid ${color}44`,
        background: bg,
        padding: "3px 7px",
        borderRadius: 4,
        ...MONO,
        fontWeight: bold ? 700 : 400,
      }}
    >
      {children}
    </span>
  );
}

function LinkPill({
  label,
  url,
  color,
}: {
  label: string;
  url: string;
  color: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: "none" }}
    >
      <div
        style={{
          background: "#0d0d0d",
          border: `1px solid ${color}33`,
          color,
          fontSize: 9,
          ...MONO,
          padding: "6px 11px",
          borderRadius: 5,
          cursor: "pointer",
          transition: TRANSITION_FAST,
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLElement).style.background = "#141414")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLElement).style.background = "#0d0d0d")
        }
      >
        ↗ {label}
      </div>
    </a>
  );
}

function LoadingLine({ text }: { text: string }) {
  return (
    <div
      style={{
        color: C.dim,
        fontSize: 10,
        ...MONO,
        padding: "26px 0",
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

function defaultSafetyBreakdown(meme: ScanResult) {
  return [
    {
      label: "RUGCHECK SCAN",
      pass: meme.rugRisk === "low",
      detail:
        meme.rugRisk === "low"
          ? "Passed Rugcheck.xyz analysis"
          : meme.rugRisk === "medium"
            ? `Medium risk: ${meme.rugDetails || "some warnings"}`
            : meme.rugRisk === "high"
              ? `HIGH RISK: ${meme.rugDetails}`
              : "Not checked yet",
    },
    {
      label: "LIQUIDITY",
      pass: (meme.liquidity || 0) >= 10000,
      detail: meme.liquidity
        ? `$${(meme.liquidity / 1000).toFixed(1)}K — ${(meme.liquidity || 0) >= 10000 ? "adequate" : "very low, easy to drain"}`
        : "No liquidity data",
    },
    {
      label: "MARKET CAP",
      pass: (meme.mcap || 0) < 5_000_000 && (meme.mcap || 0) > 0,
      detail: meme.mcap
        ? `$${(meme.mcap / 1000).toFixed(0)}K — ${(meme.mcap || 0) < 1_000_000 ? "micro cap, high upside" : "already pumped"}`
        : "No mcap data",
    },
    {
      label: "PRICE ACTION",
      pass: (meme.priceChange1h || 0) < 300 && (meme.priceChange1h || 0) > -50,
      detail:
        meme.priceChange1h !== undefined
          ? `1h: ${meme.priceChange1h > 0 ? "+" : ""}${meme.priceChange1h.toFixed(0)}% — ${Math.abs(meme.priceChange1h) > 300 ? "suspicious spike" : "normal range"}`
          : "No price data yet",
    },
    {
      label: "CROSS-PLATFORM",
      pass: (meme.crossPlatforms || 0) >= 2,
      detail: `Found on ${meme.crossPlatforms || meme.platforms?.length || 1} platform(s) — ${(meme.crossPlatforms || 0) >= 3 ? "strong confirmation" : (meme.crossPlatforms || 0) >= 2 ? "moderate confirmation" : "single source only"}`,
    },
    {
      label: "VIRAL BACKING",
      pass: !!(meme.aiContext || meme.isViralTrend),
      detail: meme.aiContext
        ? meme.aiContext.slice(0, 80)
        : meme.isViralTrend
          ? "Detected as viral internet trend"
          : "No viral backing detected",
    },
  ];
}
