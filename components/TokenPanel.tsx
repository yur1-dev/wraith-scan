"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { MemeTrend } from "@/app/app/page";

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
function fmtPrice(n?: number): string {
  if (!n) return "—";
  if (n < 0.000001) return `$${n.toExponential(2)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

// Supply cache shared across fetches — derived once from DexScreener, used by Jupiter
const _tokenSupplyCache = new Map<string, number>();

async function fetchLiveTokenData(ca: string): Promise<LiveTokenData> {
  try {
    // ── Step 1: DexScreener for metadata + supply baseline ──
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${ca}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return {};
    const data = await res.json();
    const pairs = (data?.pairs || [])
      .filter((p: { chainId: string }) => p.chainId === "solana")
      .sort(
        (
          a: { liquidity?: { usd?: number } },
          b: { liquidity?: { usd?: number } },
        ) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0),
      );
    if (!pairs.length) return {};
    const pair = pairs[0];

    const ageMin = pair.pairCreatedAt
      ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000)
      : undefined;
    const age =
      ageMin !== undefined
        ? ageMin < 60
          ? `${ageMin}m old`
          : ageMin < 1440
            ? `${Math.floor(ageMin / 60)}h old`
            : `${Math.floor(ageMin / 1440)}d old`
        : undefined;

    // Use marketCap (circulating) not fdv (total supply, inflated for memecoins)
    const dexMcap = pair.marketCap || pair.fdv || 0;
    const dexPrice = parseFloat(pair.priceUsd || "0") || 0;

    // Cache circulating supply for Jupiter price calculation
    if (dexPrice > 0 && dexMcap > 0 && !_tokenSupplyCache.has(ca)) {
      _tokenSupplyCache.set(ca, dexMcap / dexPrice);
    }

    // ── Step 2: Jupiter Price v2 — real-time, matches what swaps execute at ──
    let liveMcap = dexMcap;
    let livePrice = dexPrice;
    try {
      const jupRes = await fetch(`https://api.jup.ag/price/v2?ids=${ca}`, {
        signal: AbortSignal.timeout(4000),
      });
      const jupData = await jupRes.json();
      const jupPrice = parseFloat(jupData?.data?.[ca]?.price ?? "0");
      if (jupPrice > 0) {
        livePrice = jupPrice;
        const supply = _tokenSupplyCache.get(ca);
        if (supply && supply > 0) {
          liveMcap = jupPrice * supply;
        } else if (dexMcap > 0 && dexPrice > 0) {
          liveMcap = (jupPrice / dexPrice) * dexMcap;
        }
      }
    } catch {
      // Jupiter unavailable — DexScreener values are still better than nothing
    }

    return {
      mcap: liveMcap,
      liquidity: pair.liquidity?.usd,
      priceChange1h: pair.priceChange?.h1,
      priceChange24h: pair.priceChange?.h24,
      volume24h: pair.volume?.h24,
      price: livePrice || undefined,
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
}) {
  const [mode, setMode] = useState<"line" | "candles">("line");
  const [tf, setTf] = useState<(typeof TIMEFRAMES)[number]["key"]>("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Pan/zoom over already-loaded candle history — drag to scroll back,
  // wheel to zoom, like DexScreener/TradingView. zoom=1 shows everything
  // that's loaded; panOffset is measured in candle-index units.
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startPan: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setZoom(1);
    setPanOffset(0);
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
    };
  }, [contractAddress, tf]);

  const W = 100; // viewBox units — scales with container
  const H = 100;
  const padTop = 8;
  const padBottom = 6;

  const visibleCandles = useMemo(() => {
    if (!candles.length) return candles;
    const visibleCount = Math.max(
      5,
      Math.min(candles.length, Math.round(candles.length / zoom)),
    );
    const maxPan = Math.max(0, candles.length - visibleCount);
    const clampedPan = Math.max(0, Math.min(panOffset, maxPan));
    return candles.slice(clampedPan, clampedPan + visibleCount);
  }, [candles, zoom, panOffset]);

  const { path, fillPath, points, min, max, up, maPath } = useMemo(() => {
    if (!visibleCandles.length) {
      return {
        path: "",
        fillPath: "",
        points: [] as { x: number; y: number; c: Candle }[],
        min: 0,
        max: 0,
        up: true,
        maPath: "",
      };
    }
    const closes = visibleCandles.map((c) => c.c);
    const highs = visibleCandles.map((c) => c.h);
    const lows = visibleCandles.map((c) => c.l);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const range = max - min || 1;
    const usableH = H - padTop - padBottom;
    const stepX =
      visibleCandles.length > 1 ? W / (visibleCandles.length - 1) : W;

    const pts = visibleCandles.map((c, i) => ({
      x: i * stepX,
      y: padTop + usableH - ((c.c - min) / range) * usableH,
      c,
    }));

    const linePath = pts
      .map(
        (p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`,
      )
      .join(" ");
    const fill =
      linePath + ` L ${pts[pts.length - 1].x.toFixed(2)} ${H} L 0 ${H} Z`;

    // Simple moving average overlay — smooths noise, shows trend direction
    // at a glance. Period auto-shrinks on short candle sets so it still
    // draws something even with only a handful of candles loaded.
    const maPeriod = Math.min(7, Math.max(2, Math.floor(closes.length / 3)));
    let maPath = "";
    if (closes.length >= maPeriod) {
      const maSegs: string[] = [];
      for (let i = maPeriod - 1; i < closes.length; i++) {
        const slice = closes.slice(i - maPeriod + 1, i + 1);
        const avg = slice.reduce((s, v) => s + v, 0) / maPeriod;
        const y = padTop + usableH - ((avg - min) / range) * usableH;
        maSegs.push(
          `${maSegs.length === 0 ? "M" : "L"} ${pts[i].x.toFixed(2)} ${y.toFixed(2)}`,
        );
      }
      maPath = maSegs.join(" ");
    }

    return {
      path: linePath,
      fillPath: fill,
      points: pts,
      min,
      max,
      up: closes[closes.length - 1] >= closes[0],
      maPath,
    };
  }, [visibleCandles]);

  const hovered = hoverIdx !== null ? points[hoverIdx] : null;
  const lineColor = C.accent; // orange, per request — stays fixed regardless of up/down
  const candleUpColor = C.green;
  const candleDownColor = C.red;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();

    if (isDragging && dragRef.current) {
      const visibleCount = Math.max(
        5,
        Math.min(candles.length, Math.round(candles.length / zoom)),
      );
      const pxPerCandle = rect.width / Math.max(1, visibleCount - 1);
      const deltaCandles = (e.clientX - dragRef.current.startX) / pxPerCandle;
      const maxPan = Math.max(0, candles.length - visibleCount);
      const nextPan = Math.round(dragRef.current.startPan - deltaCandles);
      setPanOffset(Math.max(0, Math.min(maxPan, nextPan)));
      return;
    }

    if (!points.length) return;
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let closest = 0;
    let closestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.x - relX);
      if (d < closestDist) {
        closestDist = d;
        closest = i;
      }
    });
    setHoverIdx(closest);
  };

  const handleDown = (e: React.MouseEvent<SVGSVGElement>) => {
    dragRef.current = { startX: e.clientX, startPan: panOffset };
    setIsDragging(true);
  };
  const handleUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    setZoom((z) =>
      Math.max(1, Math.min(20, e.deltaY < 0 ? z * 1.15 : z / 1.15)),
    );
  };

  const resetView = () => {
    setZoom(1);
    setPanOffset(0);
  };

  // Catches mouseup that happens outside the chart (e.g. dragged past
  // the edge and released elsewhere), so the drag doesn't get stuck on.
  useEffect(() => {
    window.addEventListener("mouseup", handleUp);
    return () => window.removeEventListener("mouseup", handleUp);
  }, []);

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
        {/* Mode toggle */}
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

        {/* Timeframe pills */}
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
          {zoom !== 1 && (
            <button
              onClick={resetView}
              style={{
                background: "transparent",
                border: `1px solid ${C.dim}33`,
                color: C.dim,
                fontSize: 7,
                ...MONO,
                padding: "3px 7px",
                borderRadius: 3,
                cursor: "pointer",
                transition: TRANSITION_FAST,
              }}
            >
              RESET
            </button>
          )}
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
        {loading && !candles.length ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.dim,
              fontSize: 9,
              ...MONO,
              letterSpacing: "0.1em",
            }}
          >
            LOADING CHART…
          </div>
        ) : !candles.length ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.dim,
              fontSize: 9,
              ...MONO,
            }}
          >
            NO CHART DATA YET
          </div>
        ) : mode === "line" ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              cursor: isDragging ? "grabbing" : "grab",
            }}
            onMouseMove={handleMove}
            onMouseDown={handleDown}
            onMouseUp={handleUp}
            onMouseLeave={() => {
              setHoverIdx(null);
              handleUp();
            }}
            onWheel={handleWheel}
          >
            <defs>
              <linearGradient id="wraith-line-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity="0.28" />
                <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* horizontal gridlines */}
            {[0.2, 0.4, 0.6, 0.8].map((f) => (
              <line
                key={f}
                x1={0}
                x2={W}
                y1={H * f}
                y2={H * f}
                stroke="#161616"
                strokeWidth={0.3}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={fillPath} fill="url(#wraith-line-fill)" stroke="none" />
            <path
              d={path}
              fill="none"
              stroke={lineColor}
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {hovered && (
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={0}
                y2={H}
                stroke="#333"
                strokeWidth={0.4}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="2 2"
              />
            )}
          </svg>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              cursor: isDragging ? "grabbing" : "grab",
            }}
            onMouseMove={handleMove}
            onMouseDown={handleDown}
            onMouseUp={handleUp}
            onMouseLeave={() => {
              setHoverIdx(null);
              handleUp();
            }}
            onWheel={handleWheel}
          >
            {[0.2, 0.4, 0.6, 0.8].map((f) => (
              <line
                key={f}
                x1={0}
                x2={W}
                y1={H * f}
                y2={H * f}
                stroke="#161616"
                strokeWidth={0.3}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {points.map((p, i) => {
              const cUp = p.c.c >= p.c.o;
              const range = max - min || 1;
              const usableH = H - padTop - padBottom;
              const yOpen =
                padTop + usableH - ((p.c.o - min) / range) * usableH;
              const yClose =
                padTop + usableH - ((p.c.c - min) / range) * usableH;
              const yHigh =
                padTop + usableH - ((p.c.h - min) / range) * usableH;
              const yLow = padTop + usableH - ((p.c.l - min) / range) * usableH;
              const bodyW = Math.max((W / points.length) * 0.6, 0.4);
              return (
                <g key={i}>
                  <line
                    x1={p.x}
                    x2={p.x}
                    y1={yHigh}
                    y2={yLow}
                    stroke={cUp ? candleUpColor : candleDownColor}
                    strokeWidth={0.3}
                    vectorEffect="non-scaling-stroke"
                  />
                  <rect
                    x={p.x - bodyW / 2}
                    y={Math.min(yOpen, yClose)}
                    width={bodyW}
                    height={Math.max(Math.abs(yClose - yOpen), 0.4)}
                    fill={cUp ? candleUpColor : candleDownColor}
                  />
                </g>
              );
            })}
            {maPath && (
              <path
                d={maPath}
                fill="none"
                stroke={C.gold}
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.85}
              />
            )}
            {hovered && (
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={0}
                y2={H}
                stroke="#333"
                strokeWidth={0.4}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="2 2"
              />
            )}
          </svg>
        )}

        {/* Circular hover marker — plain HTML div, not SVG. The chart's
            SVG viewBox is stretched non-uniformly to fill a wide
            rectangle, which turns any SVG circle into an oval. A div
            positioned by percentage stays perfectly round regardless,
            and works the same way in both line and candle mode. */}
        {hovered && (
          <div
            style={{
              position: "absolute",
              left: `${(hovered.x / W) * 100}%`,
              top: `${(hovered.y / H) * 100}%`,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: mode === "line" ? lineColor : C.gold,
              border: "1.5px solid #0a0a0a",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
              boxShadow: `0 0 6px ${mode === "line" ? lineColor : C.gold}88`,
            }}
          />
        )}

        {/* Hover tooltip — DexScreener-style: OHLC + %change + full date/time */}
        {hovered && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 10,
              background: "#0a0a0ae6",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "8px 11px",
              backdropFilter: "blur(4px)",
              pointerEvents: "none",
              minWidth: 128,
            }}
          >
            {(() => {
              const c = hovered.c;
              const candleUp = c.c >= c.o;
              const pctChange = c.o !== 0 ? ((c.c - c.o) / c.o) * 100 : 0;
              const tone =
                mode === "candles" ? (candleUp ? C.green : C.red) : lineColor;
              return (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 7,
                      marginBottom: 5,
                    }}
                  >
                    <span
                      style={{
                        color: tone,
                        fontSize: 12,
                        fontWeight: 800,
                        ...MONO,
                      }}
                    >
                      {fmtPrice(c.c)}
                    </span>
                    <span
                      style={{
                        color: candleUp ? C.green : C.red,
                        fontSize: 9,
                        fontWeight: 700,
                        ...MONO,
                      }}
                    >
                      {candleUp ? "+" : ""}
                      {pctChange.toFixed(2)}%
                    </span>
                  </div>
                  {mode === "candles" && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto auto",
                        gap: "2px 10px",
                        marginBottom: 5,
                      }}
                    >
                      <span style={{ color: C.dim, fontSize: 8, ...MONO }}>
                        O
                      </span>
                      <span style={{ color: C.body, fontSize: 8, ...MONO }}>
                        {fmtPrice(c.o)}
                      </span>
                      <span style={{ color: C.dim, fontSize: 8, ...MONO }}>
                        H
                      </span>
                      <span style={{ color: C.green, fontSize: 8, ...MONO }}>
                        {fmtPrice(c.h)}
                      </span>
                      <span style={{ color: C.dim, fontSize: 8, ...MONO }}>
                        L
                      </span>
                      <span style={{ color: C.red, fontSize: 8, ...MONO }}>
                        {fmtPrice(c.l)}
                      </span>
                      <span style={{ color: C.dim, fontSize: 8, ...MONO }}>
                        C
                      </span>
                      <span style={{ color: C.body, fontSize: 8, ...MONO }}>
                        {fmtPrice(c.c)}
                      </span>
                    </div>
                  )}
                  <div
                    style={{
                      color: C.dim,
                      fontSize: 7,
                      ...MONO,
                      borderTop: `1px solid ${C.border}`,
                      paddingTop: 4,
                    }}
                  >
                    {new Date(c.t).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Live price badge, top-right */}
        {!hovered && points.length > 0 && (
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
                color: lineColor,
                fontSize: 11,
                fontWeight: 800,
                ...MONO,
              }}
            >
              {fmtPrice(points[points.length - 1].c.c)}
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
}: {
  contractAddress: string;
  onBack: () => void;
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
        border: "1px solid #111",
        borderRadius: 10,
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
