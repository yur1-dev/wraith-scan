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
import type { SmartWallet } from "@/lib/getWalletStats";

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
  tokenImageUrl?: string;
  rugRisk?: "low" | "medium" | "high" | "unknown";
  rugDetails?: string;
  topHolderPct?: number;
  smartMoneyScore?: number;
  smartWallets?: SmartWallet[];
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

// ── Palette — refreshed for lore.trade-style clarity, orange accent kept ────
// Same variable names as before (nothing downstream needs to change), just
// tuned values: hairline borders instead of solid dark-gray ones, softer
// label/sub contrast steps, and a true near-black card surface instead of
// pure #0a0a0a which read a little flat next to the app's #060b14 base.
const C = {
  label: "rgba(255,255,255,0.5)",
  sub: "rgba(255,255,255,0.45)",
  body: "rgba(255,255,255,0.75)",
  dim: "rgba(255,255,255,0.32)",
  accent: "#e8490f",
  green: "#22c55e",
  gold: "#ffd700",
  purple: "#a855f7",
  blue: "#00b4d8",
  red: "#f04141",
  border: "rgba(255,255,255,0.06)",
  borderHover: "rgba(255,255,255,0.12)",
  bg: "#0a0a0a",
  bgDark: "#060606",
};

// ── Shared motion / surface tokens ───────────────────────────────────────────
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const TRANSITION_FAST = `all 0.15s ${EASE}`;
const TRANSITION = `all 0.25s ${EASE}`;
const RADIUS = 16; // rounded-2xl equivalent, consistent everywhere now

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
// Base card surface used across the whole app. Hairline border, generous
// radius, a very subtle lift on hover instead of the old harder border-swap
// — this is the single change that does the most to make everything feel
// like one consistent system instead of a pile of separately-styled boxes.
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
        border: `1px solid ${hover ? C.borderHover : C.border}`,
        borderRadius: RADIUS,
        transition: TRANSITION_FAST,
        transform: hover ? "translateY(-1px)" : "none",
        boxShadow: hover ? "0 8px 24px -12px rgba(0,0,0,0.5)" : "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Skeleton block — used by StatCard's loading state and reusable anywhere
// else a panel needs a "data incoming" placeholder instead of a blank card.
function Skeleton({ w, h }: { w: number | string; h: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 4,
        background:
          "linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 37%, rgba(255,255,255,0.04) 63%)",
        backgroundSize: "400% 100%",
        animation: "wraith-skeleton 1.4s ease infinite",
      }}
    />
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
    <Card hoverable style={{ padding: "14px 16px" }}>
      <div
        style={{
          color: C.label,
          fontSize: 10,
          ...MONO,
          letterSpacing: "0.1em",
          marginBottom: 8,
          textTransform: "uppercase" as const,
        }}
      >
        {label}
      </div>
      {loading ? (
        <Skeleton w="70%" h={18} />
      ) : (
        <div
          style={{
            color: color || "#f2f2f2",
            fontSize: 18,
            fontWeight: 700,
            ...MONO,
            letterSpacing: "-0.01em",
            fontVariantNumeric: "tabular-nums",
            transition: TRANSITION_FAST,
          }}
        >
          {value}
        </div>
      )}
      {sub && !loading && (
        <div style={{ color: C.sub, fontSize: 10, ...MONO, marginTop: 5 }}>
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
}: {
  contractAddress: string;
  onOpenFull: () => void;
  height?: number;
  liveMcap?: number; // kept in the prop signature so call sites don't need
  livePrice?: number; // edits — no longer used now that MCAP mode is gone.
}) {
  // ── SIMPLIFIED CHART — rebuilt from scratch after the old version's
  // MCAP-mode manual autoscale clamp was silently squashing candles to an
  // invisible sliver. Dropped: MCAP value mode, the shift-drag measure
  // tool, and the multi-stage outlier "rescue" filtering. What's left is
  // close to what pump.fun/poocoin actually run: fetch candles, sanity
  // check them, hand them to lightweight-charts, let its own autoscale do
  // the work. Less code to fight with. ──
  const [mode, setMode] = useState<"line" | "candles">("candles");
  const [tf, setTf] = useState<(typeof TIMEFRAMES)[number]["key"]>("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastPrice, setLastPrice] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<
    ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null
  >(null);
  const hasFitRef = useRef(false);
  const fetchIdRef = useRef(0);

  // Fetch + poll candle data
  useEffect(() => {
    let alive = true;
    const currentFetchId = ++fetchIdRef.current;
    setLoading(true);
    hasFitRef.current = false;

    fetchCandles(contractAddress, tf).then((c) => {
      if (!alive || fetchIdRef.current !== currentFetchId) return;
      if (c.length) setCandles(c);
      setLoading(false);
    });

    const poll = setInterval(() => {
      fetchCandles(contractAddress, tf).then((c) => {
        if (!alive || fetchIdRef.current !== currentFetchId) return;
        if (c.length) setCandles(c);
      });
    }, 10000);

    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [contractAddress, tf]);

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
      crosshair: { mode: CrosshairMode.Normal },
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

    // ResizeObserver instead of window "resize" — dragging the panel
    // divider in page.tsx only changes a div's width via React state, it
    // never fires a window resize event, so the chart never knew to
    // repaint at its new width. ResizeObserver watches the container
    // element directly and catches that case too.
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
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
      minMove: 0.00000001,
      formatter: (p: number) => fmtPrice(p),
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
  }, [mode]);

  // Push data into the active series — minimal validation only: drop
  // candles with non-finite or non-positive OHLC values (these crash
  // lightweight-charts' setData hard, for the whole array, with no visible
  // error). Everything else — scaling, ranging, fitting — is left to the
  // library's own autoscale instead of a manual clamp.
  useEffect(() => {
    if (!seriesRef.current) return;

    if (!candles.length) {
      seriesRef.current.setData([]);
      return;
    }

    const sortedRaw = [...candles].sort((a, b) => a.t - b.t);
    const deduped = Array.from(
      new Map(sortedRaw.map((c) => [c.t, c])).values(),
    );
    const perCandleValid = deduped.filter((c) => {
      const nums = [c.o, c.h, c.l, c.c];
      return nums.every(
        (n) => typeof n === "number" && Number.isFinite(n) && n > 0,
      );
    });

    // One extra check, kept narrow on purpose: reject candles whose close
    // is wildly off from the median close of the set (e.g. 1e-20 next to
    // real $0.00003 prices — a known pump.fun forward-fill artifact, not a
    // real trade). This is NOT the old MCAP autoscale clamp — it doesn't
    // touch chart ranging or scaling, it just stops a single garbage data
    // point from being handed to lightweight-charts at all.
    const closes = perCandleValid.map((c) => c.c).sort((a, b) => a - b);
    const medianClose = closes.length
      ? closes[Math.floor(closes.length / 2)]
      : 0;
    // Check ALL of o/h/l/c against the median, not just close — a candle's
    // close can be perfectly normal while its high/low still carries the
    // 1e-20 forward-fill artifact, and lightweight-charts' autoscale reads
    // high/low too, so a bad low/high alone is enough to blow out the axis.
    const valid =
      medianClose > 0
        ? perCandleValid.filter((c) =>
            [c.o, c.h, c.l, c.c].every(
              (v) => v / medianClose > 0.01 && v / medianClose < 100,
            ),
          )
        : perCandleValid;

    if (!valid.length) {
      seriesRef.current.setData([]);
      return;
    }

    setLastPrice(valid[valid.length - 1].c);

    if (mode === "candles") {
      const data: CandlestickData<Time>[] = valid.map((c) => ({
        time: (c.t / 1000) as Time,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      }));
      (seriesRef.current as ISeriesApi<"Candlestick">).setData(data);
    } else {
      const data: LineData<Time>[] = valid.map((c) => ({
        time: (c.t / 1000) as Time,
        value: c.c,
      }));
      (seriesRef.current as ISeriesApi<"Line">).setData(data);
    }

    if (!hasFitRef.current) {
      chartRef.current?.timeScale().fitContent();
      hasFitRef.current = true;
    }
  }, [candles, mode]);

  const up =
    candles.length > 1 ? candles[candles.length - 1].c >= candles[0].c : true;

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
            <style>{`
              @keyframes tp-spin { to { transform: rotate(360deg); } }
            `}</style>
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
        {loading && candles.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "#0a0a0acc",
              border: `1px solid #222`,
              borderRadius: 5,
              padding: "4px 8px",
              backdropFilter: "blur(2px)",
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: `2px solid #222`,
                borderTopColor: C.accent,
                animation: "tp-spin 0.7s linear infinite",
              }}
            />
            <span
              style={{
                color: C.sub,
                fontSize: 8,
                ...MONO,
                letterSpacing: "0.08em",
              }}
            >
              UPDATING…
            </span>
            <style>{`
              @keyframes tp-spin { to { transform: rotate(360deg); } }
            `}</style>
          </div>
        )}
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
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
              {fmtPrice(lastPrice)}
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
  const [liveDataAddress, setLiveDataAddress] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "overview" | "evidence" | "safety"
  >("overview");
  const [fullChart, setFullChart] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [copiedCA, setCopiedCA] = useState(false);

  const liveFetchId = useRef(0);
  const evidenceFetchId = useRef(0);

  useEffect(() => {
    if (!publicKey) return;
    connection
      .getBalance(publicKey)
      .then((l) => setSolBalance(l / LAMPORTS_PER_SOL))
      .catch(() => {});
  }, [publicKey, connection, selectedMeme]);

  useEffect(() => {
    const currentId = ++liveFetchId.current;
    if (!selectedMeme) {
      setLiveData({});
      setLiveDataAddress(null);
      setLiveLoading(false);
      return;
    }
    if (!selectedMeme.contractAddress) {
      setLiveData({});
      setLiveDataAddress(null);
      setLiveLoading(false);
      return;
    }
    setLiveLoading(true);
    // DO NOT clear setLiveData({}) here — it causes the UI to flicker to blank.
    // Instead, we let the new data overwrite the old one when it arrives.
    // The Header already uses selectedMeme for initial display.
    fetchLiveTokenData(selectedMeme.contractAddress).then((d) => {
      if (liveFetchId.current !== currentId) return;
      if (d && Object.keys(d).length) {
        setLiveData(d);
        setLiveDataAddress(selectedMeme.contractAddress!);
      }
      setLiveLoading(false);
    });
    // Poll every 8s — Jupiter Price v2 is fast enough, matches chart update cadence
    const t = setInterval(() => {
      const contractAddress = selectedMeme?.contractAddress;
      if (contractAddress) {
        const pollId = liveFetchId.current;
        fetchLiveTokenData(contractAddress).then((d) => {
          if (liveFetchId.current !== pollId) return;
          if (d && Object.keys(d).length) {
            setLiveData(d);
            setLiveDataAddress(contractAddress);
          }
        });
      }
    }, 8000);
    return () => clearInterval(t);
  }, [selectedMeme]);

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
    if (!selectedMeme) {
      setEvidence(null);
      setActiveTab("overview");
      setFullChart(false);
      return;
    }

    const currentId = ++evidenceFetchId.current;
    setEvidence(null);
    setActiveTab("overview");
    setFullChart(false);
    fetchEvidence(selectedMeme).then(() => {
      if (evidenceFetchId.current !== currentId) return;
    });
  }, [selectedMeme, fetchEvidence]);

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

  // Keep the no-flicker behavior, but never use a quote belonging to a
  // different contract while the newly selected token is loading.
  const currentLiveData =
    liveDataAddress === selectedMeme.contractAddress ? liveData : {};
  const displayMcap = currentLiveData.mcap ?? selectedMeme.mcap;
  const displayLiq = currentLiveData.liquidity || selectedMeme.liquidity;
  const displayCh1h =
    currentLiveData.priceChange1h ?? selectedMeme.priceChange1h;
  const displayCh24h =
    currentLiveData.priceChange24h ?? selectedMeme.priceChange24h;
  const displayAge = currentLiveData.age || selectedMeme.ageLabel;
  const displayPrice = currentLiveData.price;
  const displayVolume = currentLiveData.volume24h || selectedMeme.volume;
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
              {selectedMeme.tokenImageUrl ? (
                <img
                  src={selectedMeme.tokenImageUrl}
                  alt=""
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    objectFit: "cover" as const,
                    flexShrink: 0,
                    border: `1px solid ${C.border}`,
                  }}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display =
                      "none";
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: "#1a1a1a",
                    border: `1px solid ${C.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: C.dim,
                    fontSize: 11,
                    fontWeight: 800,
                    ...MONO,
                    flexShrink: 0,
                  }}
                >
                  {selectedMeme.keyword.charAt(0).toUpperCase()}
                </div>
              )}
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
              {selectedMeme.contractAddress && (
                <CopyButton value={selectedMeme.contractAddress} />
              )}
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
                borderTop: "none",
                borderLeft: "none",
                borderRight: "none",
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

            {/* Smart money — wallets buying in with a confirmed win rate on
                this token. Net worth alone isn't shown as a signal by itself;
                only wallets we actually have win-rate data for are listed,
                since a rich wallet with no track record isn't "smart money,"
                it's just a big wallet. */}
            {selectedMeme.smartWallets &&
              selectedMeme.smartWallets.length > 0 && (
                <Card style={{ padding: "10px 12px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        color: C.label,
                        fontSize: 8,
                        ...MONO,
                        letterSpacing: "0.14em",
                      }}
                    >
                      🧠 SMART MONEY
                    </div>
                    {selectedMeme.smartMoneyScore !== undefined && (
                      <span
                        style={{
                          color:
                            selectedMeme.smartMoneyScore >= 60
                              ? C.green
                              : selectedMeme.smartMoneyScore >= 30
                                ? "#ffaa00"
                                : C.dim,
                          fontSize: 9,
                          ...MONO,
                          fontWeight: 700,
                        }}
                      >
                        {selectedMeme.smartMoneyScore}/100
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column" as const,
                      gap: 6,
                    }}
                  >
                    {selectedMeme.smartWallets
                      .filter(
                        (w) =>
                          w.winRatePct !== undefined &&
                          (w.tradeCount ?? 0) >= 2,
                      )
                      .sort((a, b) => (b.winRatePct ?? 0) - (a.winRatePct ?? 0))
                      .slice(0, 5)
                      .map((w) => (
                        <div
                          key={w.address}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            fontSize: 9,
                            ...MONO,
                          }}
                        >
                          <span style={{ color: C.body }}>
                            {w.address.slice(0, 4)}…{w.address.slice(-4)}
                          </span>
                          <span style={{ display: "flex", gap: 8 }}>
                            {w.netWorthUsd !== undefined && (
                              <span style={{ color: C.sub }}>
                                {fmtMcap(w.netWorthUsd)} net worth
                              </span>
                            )}
                            {w.winRatePct !== undefined && (
                              <span
                                style={{
                                  color:
                                    w.winRatePct >= 75
                                      ? C.green
                                      : w.winRatePct >= 55
                                        ? "#ffaa00"
                                        : C.red,
                                  fontWeight: 700,
                                }}
                              >
                                {w.winRatePct.toFixed(0)}% win
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    {selectedMeme.smartWallets.filter(
                      (w) =>
                        w.winRatePct !== undefined && (w.tradeCount ?? 0) >= 2,
                    ).length === 0 && (
                      <div style={{ color: C.dim, fontSize: 9, ...MONO }}>
                        No confirmed win-rate data on top holders yet
                      </div>
                    )}
                  </div>
                </Card>
              )}

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
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      title={value}
      style={{
        background: "transparent",
        border: `1px solid ${C.border}`,
        color: copied ? C.green : C.dim,
        fontSize: 10,
        ...MONO,
        padding: "4px 9px",
        borderRadius: 8,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 4,
        transition: TRANSITION_FAST,
      }}
    >
      {copied ? "✓ COPIED" : `${value.slice(0, 4)}…${value.slice(-4)} ⧉`}
    </button>
  );
}

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
        fontSize: 10,
        color,
        border: `1px solid ${color}33`,
        background: bg ?? `${color}14`,
        padding: "4px 9px",
        borderRadius: 8,
        ...MONO,
        fontWeight: bold ? 700 : 500,
        letterSpacing: "0.02em",
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
          background: "rgba(255,255,255,0.03)",
          border: `1px solid ${color}2a`,
          color,
          fontSize: 10,
          ...MONO,
          padding: "7px 12px",
          borderRadius: 10,
          cursor: "pointer",
          transition: TRANSITION_FAST,
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLElement).style.background =
            "rgba(255,255,255,0.06)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLElement).style.background =
            "rgba(255,255,255,0.03)")
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
