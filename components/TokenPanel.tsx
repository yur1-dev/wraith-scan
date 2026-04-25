"use client";

import { useState, useEffect, useCallback } from "react";
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

async function fetchLiveTokenData(ca: string): Promise<LiveTokenData> {
  try {
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
    return {
      mcap: pair.fdv || pair.marketCap,
      liquidity: pair.liquidity?.usd,
      priceChange1h: pair.priceChange?.h1,
      priceChange24h: pair.priceChange?.h24,
      volume24h: pair.volume?.h24,
      price: parseFloat(pair.priceUsd || "0") || undefined,
      age,
    };
  } catch {
    return {};
  }
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
    <div
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 5,
        padding: "9px 11px",
      }}
    >
      <div
        style={{
          color: C.label,
          fontSize: 8,
          ...MONO,
          letterSpacing: "0.14em",
          marginBottom: 5,
          textTransform: "uppercase" as const,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: loading ? "#222" : color || "#d8d8d8",
          fontSize: 15,
          fontWeight: 800,
          ...MONO,
        }}
      >
        {loading ? "···" : value}
      </div>
      {sub && !loading && (
        <div style={{ color: C.sub, fontSize: 8, ...MONO, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Inline chart — TALL version ────────────────────────────────────────────────
function InlineChart({
  contractAddress,
  onOpenFull,
}: {
  contractAddress: string;
  onOpenFull: () => void;
}) {
  const src = `https://dexscreener.com/solana/${contractAddress}?embed=1&theme=dark&trades=0&info=0&chart=1&chartLeftToolbar=0&chartDefaultOnMobile=1&chartTheme=dark&chartStyle=1&chartType=usd&interval=15`;
  return (
    <div
      style={{
        position: "relative",
        // ── KEY CHANGE: was 220, now 420 ──────────────────────────────────────
        height: 420,
        borderRadius: 5,
        overflow: "hidden",
        border: `1px solid ${C.border}`,
        marginBottom: 12,
      }}
    >
      <iframe
        key={contractAddress}
        src={src}
        style={{
          width: "100%",
          // cover the dexscreener footer bar (36px) by extending height
          height: "calc(100% + 36px)",
          border: "none",
          display: "block",
          background: "#060606",
        }}
        title="chart"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
      {/* Overlay that covers dexscreener branding at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 36,
          background: "#060606",
          borderTop: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          padding: "0 10px",
          gap: 6,
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: C.green,
            display: "inline-block",
          }}
        />
        <span
          style={{
            color: C.accent,
            fontSize: 7,
            fontWeight: 800,
            letterSpacing: "0.14em",
            ...MONO,
          }}
        >
          ⚡ LIVE CHART
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
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
                padding: "2px 6px",
                borderRadius: 2,
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
                padding: "2px 6px",
                borderRadius: 2,
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
              padding: "2px 6px",
              borderRadius: 2,
              cursor: "pointer",
            }}
          >
            EXPAND ↗
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Full chart view (replaces content) ─────────────────────────────────────────
function FullChart({
  contractAddress,
  onBack,
}: {
  contractAddress: string;
  onBack: () => void;
}) {
  const src = `https://dexscreener.com/solana/${contractAddress}?embed=1&theme=dark&trades=0&info=0&chart=1&chartLeftToolbar=0&chartDefaultOnMobile=1&chartTheme=dark&chartStyle=0&chartType=usd&interval=15`;
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
          gap: 6,
          padding: "6px 12px",
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
            padding: "3px 9px",
            borderRadius: 2,
            cursor: "pointer",
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
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <a
            href={`https://dexscreener.com/solana/${contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "none" }}
          >
            <span
              style={{
                fontSize: 8,
                color: C.blue,
                border: `1px solid ${C.blue}33`,
                padding: "2px 7px",
                borderRadius: 2,
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
                fontSize: 8,
                color: C.purple,
                border: `1px solid ${C.purple}33`,
                padding: "2px 7px",
                borderRadius: 2,
                ...MONO,
              }}
            >
              PUMP ↗
            </span>
          </a>
        </div>
      </div>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <iframe
          key={contractAddress}
          src={src}
          style={{
            width: "100%",
            height: "calc(100% + 36px)",
            border: "none",
            background: "#060606",
            display: "block",
          }}
          title="chart"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 36,
            background: "#060606",
            zIndex: 10,
            borderTop: `1px solid ${C.border}`,
          }}
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
    const t = setInterval(() => {
      if (selectedMeme?.contractAddress)
        fetchLiveTokenData(selectedMeme.contractAddress).then(setLiveData);
    }, 30000);
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
          borderRadius: 8,
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

  const displayMcap = liveData.mcap || selectedMeme.mcap;
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
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          padding: "12px 14px 0",
          borderBottom: "1px solid #1a1a1a",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Token name + badges */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                marginBottom: 5,
                flexWrap: "wrap" as const,
              }}
            >
              <span
                style={{
                  color: isCeleb ? C.gold : "#fff",
                  fontSize: 22,
                  fontWeight: 900,
                  ...MONO,
                  letterSpacing: "0.04em",
                }}
              >
                ${selectedMeme.keyword.toUpperCase()}
              </span>
              {isCeleb && (
                <span
                  style={{
                    fontSize: 9,
                    color: C.gold,
                    border: `1px solid ${C.gold}44`,
                    padding: "2px 6px",
                    borderRadius: 3,
                    ...MONO,
                    background: "#ffd7000d",
                    fontWeight: 700,
                  }}
                >
                  ⭐ {selectedMeme.celebMention?.toUpperCase() || "CELEB"}
                </span>
              )}
              {selectedMeme.isNewCoin && (
                <span
                  style={{
                    fontSize: 9,
                    color: C.purple,
                    border: `1px solid ${C.purple}44`,
                    padding: "2px 6px",
                    borderRadius: 3,
                    ...MONO,
                  }}
                >
                  NEW COIN
                </span>
              )}
              {selectedMeme.isViralTrend && !selectedMeme.isNewCoin && (
                <span
                  style={{
                    fontSize: 9,
                    color: "#ffaa00",
                    border: "1px solid #ffaa0044",
                    padding: "2px 6px",
                    borderRadius: 3,
                    ...MONO,
                  }}
                >
                  VIRAL TREND
                </span>
              )}
              {prediction && !evidence?.loading && (
                <span
                  style={{
                    fontSize: 9,
                    color: PRED_COLOR[prediction],
                    border: `1px solid ${PRED_COLOR[prediction]}44`,
                    background: `${PRED_COLOR[prediction]}0d`,
                    padding: "2px 6px",
                    borderRadius: 3,
                    ...MONO,
                    fontWeight: 700,
                  }}
                >
                  {PRED_LABEL[prediction]}
                </span>
              )}
            </div>

            {/* Price row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
              }}
            >
              {displayPrice && (
                <span
                  style={{
                    color: C.accent,
                    fontSize: 14,
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
                  }}
                  title="Live · 30s"
                />
              )}
            </div>

            {/* AI narrative */}
            {selectedMeme.aiContext && (
              <div
                style={{
                  background: isCeleb ? "#0d0a00" : "#0a0a0d",
                  border: `1px solid ${isCeleb ? "#ffd70022" : "#e8490f22"}`,
                  borderRadius: 4,
                  padding: "7px 10px",
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
                gap: 3,
                flexShrink: 0,
                marginLeft: 10,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  border: `2px solid ${safetyColor}`,
                  display: "flex",
                  flexDirection: "column" as const,
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: `0 0 12px ${safetyColor}44`,
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
        <div style={{ display: "flex" }}>
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
                padding: "5px 11px",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {/* ════ OVERVIEW ════ */}
        {activeTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* CHART FIRST — always at top, now tall */}
            {selectedMeme.contractAddress ? (
              <InlineChart
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
                  borderRadius: 5,
                  marginBottom: 10,
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
                gap: 7,
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
              <div
                style={{
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 5,
                  padding: "9px 11px",
                }}
              >
                <div
                  style={{
                    color: C.label,
                    fontSize: 8,
                    ...MONO,
                    letterSpacing: "0.14em",
                    marginBottom: 5,
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
                      padding: "4px 10px",
                      borderRadius: 3,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {copiedCA ? "COPIED!" : "COPY"}
                  </button>
                </div>
              </div>
            )}

            {/* Quick links */}
            {selectedMeme.contractAddress && (
              <div
                style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}
              >
                {[
                  {
                    label: "DexScreener",
                    url: `https://dexscreener.com/solana/${selectedMeme.contractAddress}`,
                    color: C.blue,
                  },
                  {
                    label: "Pump.fun",
                    url: `https://pump.fun/${selectedMeme.contractAddress}`,
                    color: C.purple,
                  },
                  {
                    label: "Rugcheck",
                    url: `https://rugcheck.xyz/tokens/${selectedMeme.contractAddress}`,
                    color: C.green,
                  },
                  {
                    label: "Solscan",
                    url: `https://solscan.io/token/${selectedMeme.contractAddress}`,
                    color: C.accent,
                  },
                ].map(({ label, url, color }) => (
                  <a
                    key={label}
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
                        padding: "5px 10px",
                        borderRadius: 3,
                        cursor: "pointer",
                      }}
                    >
                      ↗ {label}
                    </div>
                  </a>
                ))}
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
                  marginBottom: 6,
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
                        padding: "3px 8px",
                        borderRadius: 3,
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
                  borderRadius: 5,
                  padding: "10px 12px",
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
              <div
                style={{
                  color: C.dim,
                  fontSize: 10,
                  ...MONO,
                  padding: "24px 0",
                  textAlign: "center",
                }}
              >
                FETCHING VIRAL EVIDENCE...
              </div>
            ) : (
              <>
                {evidence?.aiAnalysis && (
                  <div
                    style={{
                      background: "#050505",
                      border: "1px solid #1a1a1a",
                      borderRadius: 5,
                      padding: "12px",
                    }}
                  >
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
                  </div>
                )}
                {selectedMeme.contractAddress && (
                  <div
                    style={{
                      display: "flex",
                      gap: 7,
                      flexWrap: "wrap" as const,
                    }}
                  >
                    {[
                      {
                        label: "DexScreener",
                        url: `https://dexscreener.com/solana/${selectedMeme.contractAddress}`,
                        color: C.blue,
                      },
                      {
                        label: "Pump.fun",
                        url: `https://pump.fun/${selectedMeme.contractAddress}`,
                        color: C.purple,
                      },
                      {
                        label: "Rugcheck",
                        url: `https://rugcheck.xyz/tokens/${selectedMeme.contractAddress}`,
                        color: C.green,
                      },
                    ].map(({ label, url, color }) => (
                      <a
                        key={label}
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
                            padding: "5px 10px",
                            borderRadius: 3,
                          }}
                        >
                          ↗ {label}
                        </div>
                      </a>
                    ))}
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
                          <div
                            style={{
                              background: C.bg,
                              border: `1px solid ${C.border}`,
                              borderRadius: 5,
                              padding: "10px 12px",
                              cursor: "pointer",
                            }}
                            onMouseEnter={(e) =>
                              ((
                                e.currentTarget as HTMLElement
                              ).style.borderColor = "#e8490f44")
                            }
                            onMouseLeave={(e) =>
                              ((
                                e.currentTarget as HTMLElement
                              ).style.borderColor = C.border)
                            }
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
                          </div>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {evidence?.loading ? (
              <div
                style={{
                  color: C.dim,
                  fontSize: 10,
                  ...MONO,
                  padding: "24px 0",
                  textAlign: "center",
                }}
              >
                RUNNING SAFETY ANALYSIS...
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: "50%",
                      border: `3px solid ${safetyColor}`,
                      display: "flex",
                      flexDirection: "column" as const,
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: `0 0 20px ${safetyColor}33`,
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
                    gap: 6,
                  }}
                >
                  {(
                    evidence?.safetyBreakdown ||
                    defaultSafetyBreakdown(selectedMeme)
                  ).map((item, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        background: C.bg,
                        border: `1px solid ${item.pass ? "#00c47a11" : "#ff222211"}`,
                        borderRadius: 5,
                        padding: "8px 11px",
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
                    </div>
                  ))}
                </div>
                {selectedMeme.rugRisk === "high" && (
                  <div
                    style={{
                      background: "#1a0000",
                      border: "1px solid #ff222233",
                      borderRadius: 5,
                      padding: "10px 12px",
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
