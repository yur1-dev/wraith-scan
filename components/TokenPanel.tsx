"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { MemeTrend } from "@/app/page";

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

// ── READABLE color palette for labels/sub-text
// OLD dark grays (#2a2a2a, #3a3a3a) → NEW readable grays (#888, #999, #aaa)
const C = {
  label: "#777", // section labels, stat card labels
  sub: "#888", // secondary text
  body: "#aaa", // body text, descriptions
  dim: "#666", // dimmer secondary
  accent: "#e8490f", // primary accent
  green: "#00c47a",
  gold: "#ffd700",
  purple: "#a855f7",
  blue: "#00b4d8",
  red: "#ff4444",
  border: "#1e1e1e",
  bg: "#0a0a0a",
  bgDark: "#060606",
};

function fmtMcap(n?: number): string {
  if (!n || n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n?: number): string | null {
  if (n === undefined || n === null) return null;
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtPrice(n?: number): string {
  if (!n || n === 0) return "—";
  if (n < 0.000001) return `$${n.toExponential(2)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

async function fetchLiveTokenData(
  contractAddress: string,
): Promise<LiveTokenData> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return {};
    const data = await res.json();
    const solanaPairs = (data?.pairs || [])
      .filter((p: { chainId: string }) => p.chainId === "solana")
      .sort(
        (
          a: { liquidity?: { usd?: number } },
          b: { liquidity?: { usd?: number } },
        ) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0),
      );
    if (!solanaPairs.length) return {};
    const pair = solanaPairs[0];
    const ageMinutes = pair.pairCreatedAt
      ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000)
      : undefined;
    let age: string | undefined;
    if (ageMinutes !== undefined) {
      age =
        ageMinutes < 60
          ? `${ageMinutes}m old`
          : ageMinutes < 1440
            ? `${Math.floor(ageMinutes / 60)}h old`
            : `${Math.floor(ageMinutes / 1440)}d old`;
    }
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

// ── Stat card — FIXED: readable label + value colors
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
        borderRadius: 6,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          color: C.label,
          fontSize: 9,
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
          color: loading ? "#333" : color || "#e8e8e8",
          fontSize: 16,
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

// ── Narrative badge — NEW: shows the viral story behind the coin
function NarrativeBadge({
  context,
  celebMention,
  isCeleb,
}: {
  context?: string;
  celebMention?: string;
  isCeleb: boolean;
}) {
  if (!context) return null;
  return (
    <div
      style={{
        background: isCeleb ? "#0d0a00" : "#0a0a0d",
        border: `1px solid ${isCeleb ? "#ffd70022" : "#e8490f22"}`,
        borderRadius: 5,
        padding: "9px 12px",
        marginBottom: 2,
      }}
    >
      <div
        style={{
          color: isCeleb ? C.gold : C.accent,
          fontSize: 8,
          ...MONO,
          letterSpacing: "0.14em",
          marginBottom: 5,
        }}
      >
        {isCeleb
          ? `⭐ ${celebMention?.toUpperCase() || "CELEBRITY"} TRIGGER`
          : "✦ NARRATIVE ORIGIN"}
      </div>
      <div style={{ color: C.body, fontSize: 10, ...MONO, lineHeight: 1.7 }}>
        {context}
      </div>
    </div>
  );
}

export default function TokenPanel({ selectedMeme }: Props) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [evidence, setEvidence] = useState<ViralEvidence | null>(null);
  const [liveData, setLiveData] = useState<LiveTokenData>({});
  const [liveLoading, setLiveLoading] = useState(false);
  const [buyAmount, setBuyAmount] = useState("0.1");
  const [buying, setBuying] = useState(false);
  const [buyStatus, setBuyStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [buyMsg, setBuyMsg] = useState("");
  const [activeTab, setActiveTab] = useState<
    "overview" | "evidence" | "safety" | "buy"
  >("overview");
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [copiedTg, setCopiedTg] = useState(false);
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
    fetchLiveTokenData(selectedMeme.contractAddress).then((data) => {
      setLiveData(data);
      setLiveLoading(false);
    });
    const interval = setInterval(() => {
      if (selectedMeme?.contractAddress)
        fetchLiveTokenData(selectedMeme.contractAddress).then(setLiveData);
    }, 30000);
    return () => clearInterval(interval);
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
      setActiveTab("overview");
      setBuyStatus("idle");
      setBuyMsg("");
      fetchEvidence(selectedMeme);
    }
  }, [selectedMeme?.keyword]);

  const handleBuy = async () => {
    if (!publicKey || !selectedMeme?.contractAddress) return;
    setBuying(true);
    setBuyStatus("idle");
    setBuyMsg("");
    try {
      const amountSol = parseFloat(buyAmount);
      if (isNaN(amountSol) || amountSol <= 0) throw new Error("Invalid amount");
      if ((solBalance || 0) < amountSol + 0.01)
        throw new Error("Insufficient SOL balance");
      const quoteRes = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${selectedMeme.contractAddress}&amount=${Math.floor(amountSol * LAMPORTS_PER_SOL)}&slippageBps=1000`,
      );
      if (!quoteRes.ok)
        throw new Error(
          "Could not get swap quote — token may not be tradeable yet",
        );
      const quote = await quoteRes.json();
      if (quote.error) throw new Error(quote.error);
      const swapRes = await fetch("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: publicKey.toString(),
          wrapAndUnwrapSol: true,
        }),
      });
      if (!swapRes.ok) throw new Error("Failed to build swap transaction");
      const { swapTransaction } = await swapRes.json();
      const txBuf = Buffer.from(swapTransaction, "base64");
      const tx = Transaction.from(txBuf);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setBuyStatus("success");
      setBuyMsg(`✓ Bought! TX: ${sig.slice(0, 8)}...${sig.slice(-8)}`);
      setSolBalance((prev) => (prev !== null ? prev - amountSol : null));
    } catch (err) {
      setBuyStatus("error");
      setBuyMsg(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBuying(false);
    }
  };

  const copyTgCommand = () => {
    if (!selectedMeme?.contractAddress) return;
    navigator.clipboard.writeText(
      `/buy ${selectedMeme.contractAddress} ${buyAmount}`,
    );
    setCopiedTg(true);
    setTimeout(() => setCopiedTg(false), 2000);
  };

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
          border: `1px solid #111`,
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
            color: "#1a1a1a",
            fontSize: 32,
            letterSpacing: "0.3em",
            ...MONO,
          }}
        >
          WRAITH
        </div>
        <div
          style={{
            color: "#2a2a2a",
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

  const displayMcap = liveData.mcap || selectedMeme.mcap;
  const displayLiquidity = liveData.liquidity || selectedMeme.liquidity;
  const displayChange1h = liveData.priceChange1h ?? selectedMeme.priceChange1h;
  const displayChange24h =
    liveData.priceChange24h ?? selectedMeme.priceChange24h;
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
      : "#555";

  const isCeleb =
    selectedMeme.onCeleb ||
    (selectedMeme.platforms || []).includes("celebrity");

  const tabs = [
    { key: "overview", label: "OVERVIEW" },
    { key: "evidence", label: "EVIDENCE" },
    { key: "safety", label: "SAFETY" },
    { key: "buy", label: "BUY / CREATE" },
  ] as const;

  // Platform label colors — FIXED: readable
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
      {/* ── Header */}
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
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Token name row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
                flexWrap: "wrap" as const,
              }}
            >
              <span
                style={{
                  color: isCeleb ? C.gold : "#fff",
                  fontSize: 24,
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
                    padding: "3px 7px",
                    borderRadius: 3,
                    ...MONO,
                    background: "#ffd7000d",
                    fontWeight: 700,
                  }}
                >
                  ⭐{" "}
                  {selectedMeme.celebMention
                    ? selectedMeme.celebMention.toUpperCase()
                    : "CELEB"}
                </span>
              )}
              {selectedMeme.isNewCoin && (
                <span
                  style={{
                    fontSize: 9,
                    color: C.purple,
                    border: `1px solid ${C.purple}44`,
                    padding: "3px 7px",
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
                    padding: "3px 7px",
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
                    padding: "3px 7px",
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
                gap: 10,
                marginBottom: 8,
              }}
            >
              {displayPrice ? (
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
              ) : null}
              {displayChange1h !== undefined && displayChange1h !== null && (
                <span
                  style={{
                    color: (displayChange1h ?? 0) >= 0 ? C.green : C.red,
                    fontSize: 13,
                    fontWeight: 700,
                    ...MONO,
                  }}
                >
                  {fmtPct(displayChange1h)}{" "}
                  <span style={{ color: C.dim, fontSize: 9 }}>1h</span>
                </span>
              )}
              {displayChange24h !== undefined && displayChange24h !== null && (
                <span
                  style={{
                    color: (displayChange24h ?? 0) >= 0 ? C.green : C.red,
                    fontSize: 11,
                    ...MONO,
                    opacity: 0.8,
                  }}
                >
                  {fmtPct(displayChange24h)}{" "}
                  <span style={{ color: C.dim, fontSize: 9 }}>24h</span>
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
                  title="Live · refreshes 30s"
                />
              )}
            </div>

            {/* Narrative context — NEW prominent display */}
            {selectedMeme.aiContext && (
              <NarrativeBadge
                context={selectedMeme.aiContext}
                celebMention={selectedMeme.celebMention}
                isCeleb={isCeleb}
              />
            )}
          </div>

          {/* Safety score circle */}
          {safetyScore !== null && (
            <div
              style={{
                display: "flex",
                flexDirection: "column" as const,
                alignItems: "center",
                gap: 3,
                flexShrink: 0,
                marginLeft: 12,
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  border: `2px solid ${safetyColor}`,
                  display: "flex",
                  flexDirection: "column" as const,
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: `0 0 14px ${safetyColor}44`,
                }}
              >
                <span
                  style={{
                    color: safetyColor,
                    fontSize: 15,
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
                    fontSize: 7,
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
        <div style={{ display: "flex", gap: 0 }}>
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
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        {/* ════ OVERVIEW ════ */}
        {activeTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
                value={fmtMcap(displayLiquidity)}
                color={
                  !displayLiquidity
                    ? C.dim
                    : displayLiquidity >= 50000
                      ? C.green
                      : displayLiquidity >= 10000
                        ? "#ffaa00"
                        : "#ff4444"
                }
                loading={liveLoading && !displayLiquidity}
                sub={
                  displayLiquidity && displayLiquidity < 10000
                    ? "⚠ Very low"
                    : undefined
                }
              />
              <StatCard
                label="1H Change"
                value={fmtPct(displayChange1h) || "—"}
                color={(displayChange1h ?? 0) >= 0 ? C.green : C.red}
                loading={liveLoading && displayChange1h === undefined}
              />
              <StatCard
                label="24H Change"
                value={fmtPct(displayChange24h) || "—"}
                color={(displayChange24h ?? 0) >= 0 ? C.green : C.red}
                loading={liveLoading && displayChange24h === undefined}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <StatCard label="Age" value={displayAge || "—"} />
              <StatCard
                label="24H Volume"
                value={fmtMcap(displayVolume)}
                color={displayVolume ? C.accent : undefined}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <StatCard
                label="Price"
                value={fmtPrice(displayPrice)}
                color={displayPrice ? C.accent : undefined}
              />
              <StatCard
                label="Sources"
                value={`${selectedMeme.crossPlatforms ?? selectedMeme.platforms?.length ?? 1} platforms`}
              />
            </div>

            {/* Contract address */}
            {selectedMeme.contractAddress && (
              <div
                style={{
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: "10px 12px",
                }}
              >
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      color: C.sub,
                      fontSize: 9,
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
                  QUICK LINKS
                </div>
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
              </div>
            )}

            {/* Platforms detected — FIXED readable colors */}
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
                  borderRadius: 6,
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    color: PRED_COLOR[prediction!],
                    fontSize: 8,
                    ...MONO,
                    letterSpacing: "0.12em",
                    marginBottom: 6,
                  }}
                >
                  AI PREDICTION
                </div>
                <div
                  style={{
                    color: C.body,
                    fontSize: 10,
                    ...MONO,
                    lineHeight: 1.7,
                  }}
                >
                  {evidence.predictionReason}
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setActiveTab("buy")}
                style={{
                  flex: 1,
                  background: C.accent,
                  border: "none",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  ...MONO,
                  padding: "11px",
                  borderRadius: 5,
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                }}
              >
                BUY NOW
              </button>
              <a
                href={
                  selectedMeme.contractAddress
                    ? `https://dexscreener.com/solana/${selectedMeme.contractAddress}`
                    : `https://pump.fun/create`
                }
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "none", flex: 1 }}
              >
                <button
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: `1px solid ${C.blue}44`,
                    color: C.blue,
                    fontSize: 10,
                    ...MONO,
                    padding: "11px",
                    borderRadius: 5,
                    cursor: "pointer",
                    letterSpacing: "0.08em",
                  }}
                >
                  {selectedMeme.contractAddress
                    ? "VIEW CHART ↗"
                    : "CREATE ON PUMP.FUN"}
                </button>
              </a>
            </div>
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
                      ON-CHAIN LINKS
                    </div>
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
                            }}
                          >
                            ↗ {label}
                          </div>
                        </a>
                      ))}
                    </div>
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
                  {(evidence?.links || []).length === 0 ? (
                    <div
                      style={{
                        color: C.dim,
                        fontSize: 10,
                        ...MONO,
                        padding: "16px 0",
                      }}
                    >
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
                      {evidence!.links.map((link, i) => (
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
                                lineHeight: 1.5,
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
                      width: 76,
                      height: 76,
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
                        fontSize: 24,
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
                        fontSize: 14,
                        fontWeight: 700,
                        ...MONO,
                        marginBottom: 6,
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
                        padding: "9px 11px",
                      }}
                    >
                      <span
                        style={{
                          color: item.pass ? C.green : "#ff2222",
                          fontSize: 13,
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
                        {/* FIXED: detail text is now readable #888 not #555 */}
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
                      authority or freeze authority may still be active.
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ════ BUY / CREATE ════ */}
        {activeTab === "buy" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {!publicKey ? (
              <div
                style={{
                  background: "#0d0d0d",
                  border: `1px solid ${C.border}`,
                  borderRadius: 5,
                  padding: "16px",
                  textAlign: "center" as const,
                }}
              >
                <div
                  style={{
                    color: C.sub,
                    fontSize: 10,
                    ...MONO,
                    marginBottom: 4,
                  }}
                >
                  CONNECT WALLET TO BUY
                </div>
                <div style={{ color: C.dim, fontSize: 9, ...MONO }}>
                  Use the wallet button in the header
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: "#050505",
                  border: `1px solid #111`,
                  borderRadius: 5,
                  padding: "8px 12px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ color: C.sub, fontSize: 9, ...MONO }}>
                  BALANCE
                </span>
                <span
                  style={{
                    color: C.accent,
                    fontSize: 14,
                    fontWeight: 700,
                    ...MONO,
                  }}
                >
                  {solBalance?.toFixed(4) ?? "—"} SOL
                </span>
              </div>
            )}

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
                AMOUNT TO BUY (SOL)
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                {["0.05", "0.1", "0.25", "0.5", "1"].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setBuyAmount(amt)}
                    style={{
                      flex: 1,
                      background: buyAmount === amt ? "#1a0800" : "#0d0d0d",
                      border: `1px solid ${buyAmount === amt ? "#e8490f66" : "#1a1a1a"}`,
                      color: buyAmount === amt ? C.accent : C.sub,
                      fontSize: 9,
                      ...MONO,
                      padding: "6px 0",
                      borderRadius: 3,
                      cursor: "pointer",
                    }}
                  >
                    {amt}
                  </button>
                ))}
              </div>
              {/* // 1. Change type="number" to type="text" and add inputMode for
              mobile numeric keyboard */}
              <input
                type="text"
                inputMode="decimal"
                value={buyAmount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^\d*\.?\d*$/.test(val)) setBuyAmount(val);
                }}
                style={
                  {
                    width: "100%",
                    marginTop: 6,
                    background: C.bg,
                    border: `1px solid ${C.border}`,
                    color: "#e0e0e0",
                    fontSize: 12,
                    ...MONO,
                    padding: "8px 10px",
                    borderRadius: 4,
                    outline: "none",
                    boxSizing: "border-box" as const,
                    // remove spinners just in case
                    MozAppearance: "textfield",
                  } as React.CSSProperties
                }
                placeholder="Custom amount..."
              />
            </div>

            {selectedMeme.rugRisk === "high" && (
              <div
                style={{
                  background: "#1a0000",
                  border: "1px solid #ff222244",
                  borderRadius: 4,
                  padding: "8px 12px",
                }}
              >
                <div style={{ color: "#ff2222", fontSize: 9, ...MONO }}>
                  ⚠ HIGH RUG RISK — Buying not recommended
                </div>
              </div>
            )}
            {selectedMeme.rugRisk === "medium" && (
              <div
                style={{
                  background: "#1a1000",
                  border: "1px solid #ffaa0044",
                  borderRadius: 4,
                  padding: "8px 12px",
                }}
              >
                <div style={{ color: "#ffaa00", fontSize: 9, ...MONO }}>
                  ⚠ MEDIUM RISK — Proceed with caution
                </div>
              </div>
            )}

            {selectedMeme.contractAddress ? (
              <button
                onClick={handleBuy}
                disabled={
                  buying || !publicKey || selectedMeme.rugRisk === "high"
                }
                style={{
                  background: buying
                    ? "#111"
                    : selectedMeme.rugRisk === "high"
                      ? "#1a0000"
                      : C.accent,
                  border:
                    selectedMeme.rugRisk === "high"
                      ? "1px solid #ff222233"
                      : "none",
                  color: buying
                    ? C.dim
                    : selectedMeme.rugRisk === "high"
                      ? "#ff2222"
                      : "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  ...MONO,
                  padding: "13px",
                  borderRadius: 5,
                  cursor:
                    buying || !publicKey || selectedMeme.rugRisk === "high"
                      ? "not-allowed"
                      : "pointer",
                  letterSpacing: "0.1em",
                  width: "100%",
                }}
              >
                {buying
                  ? "SWAPPING VIA JUPITER..."
                  : selectedMeme.rugRisk === "high"
                    ? "BUY BLOCKED — RUG RISK"
                    : `BUY $${selectedMeme.keyword.toUpperCase()} · ${buyAmount} SOL`}
              </button>
            ) : (
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
                  NO CONTRACT YET — LAUNCH IT
                </div>
                <a
                  href="https://pump.fun/create"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: "none", display: "block" }}
                >
                  <button
                    style={{
                      background: "#0f0018",
                      border: `1px solid ${C.purple}44`,
                      color: C.purple,
                      fontSize: 11,
                      fontWeight: 700,
                      ...MONO,
                      padding: "13px",
                      borderRadius: 5,
                      cursor: "pointer",
                      letterSpacing: "0.1em",
                      width: "100%",
                    }}
                  >
                    ⚡ CREATE ${selectedMeme.keyword.toUpperCase()} ON PUMP.FUN
                  </button>
                </a>
              </div>
            )}

            {buyMsg && (
              <div
                style={{
                  background: buyStatus === "success" ? "#001a0a" : "#1a0000",
                  border: `1px solid ${buyStatus === "success" ? "#00c47a33" : "#ff222233"}`,
                  borderRadius: 4,
                  padding: "8px 12px",
                }}
              >
                <div
                  style={{
                    color: buyStatus === "success" ? C.green : "#ff4444",
                    fontSize: 9,
                    ...MONO,
                  }}
                >
                  {buyMsg}
                </div>
              </div>
            )}

            {/* DEX terminals */}
            {selectedMeme.contractAddress && (
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
                  OPEN IN TRADING TERMINAL
                </div>
                <div
                  style={{ display: "flex", gap: 7, flexWrap: "wrap" as const }}
                >
                  {[
                    {
                      label: "BullX",
                      url: `https://bullx.io/terminal?chainId=1399811149&address=${selectedMeme.contractAddress}`,
                      color: C.accent,
                    },
                    {
                      label: "Photon",
                      url: `https://photon-sol.tinyastro.io/en/lp/${selectedMeme.contractAddress}`,
                      color: "#ffaa00",
                    },
                    {
                      label: "Axiom",
                      url: `https://axiom.trade/t/${selectedMeme.contractAddress}`,
                      color: C.green,
                    },
                    {
                      label: "DexScreener",
                      url: `https://dexscreener.com/solana/${selectedMeme.contractAddress}`,
                      color: C.blue,
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
                          padding: "6px 11px",
                          borderRadius: 3,
                          cursor: "pointer",
                        }}
                      >
                        ↗ {label}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div style={{ borderTop: `1px solid #111`, paddingTop: 14 }}>
              <div
                style={{
                  color: C.label,
                  fontSize: 8,
                  ...MONO,
                  letterSpacing: "0.12em",
                  marginBottom: 8,
                }}
              >
                TELEGRAM BOT COMMAND
              </div>
              <div
                style={{
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ color: C.sub, fontSize: 10, ...MONO }}>
                  /buy{" "}
                  {selectedMeme.contractAddress
                    ? `${selectedMeme.contractAddress.slice(0, 8)}...`
                    : "<no CA yet>"}{" "}
                  {buyAmount}
                </span>
                <button
                  onClick={copyTgCommand}
                  disabled={!selectedMeme.contractAddress}
                  style={{
                    background: copiedTg ? "#001a0a" : "#111",
                    border: `1px solid ${copiedTg ? "#00c47a33" : "#222"}`,
                    color: copiedTg ? C.green : C.sub,
                    fontSize: 8,
                    ...MONO,
                    padding: "4px 10px",
                    borderRadius: 3,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  {copiedTg ? "COPIED!" : "COPY"}
                </button>
              </div>
              <div style={{ color: C.dim, fontSize: 8, ...MONO, marginTop: 4 }}>
                Paste into Trojan / Bonk Bot / BullX
              </div>
            </div>
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
