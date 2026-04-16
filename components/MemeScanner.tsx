"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import axios from "axios";
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
  twitterMentions?: number;
  telegramMentions?: number;
  onTwitter?: boolean;
  onTelegram?: boolean;
  onDex?: boolean;
}

interface Props {
  onSelectMeme: (meme: MemeTrend) => void;
  selectedMeme: MemeTrend | null;
}

const REFRESH_INTERVAL = 90;

const PLATFORM: Record<string, { label: string; color: string }> = {
  telegram: { label: "TG", color: "#26a5e4" },
  twitter: { label: "X", color: "#e2e8f0" },
  reddit: { label: "RED", color: "#ff4500" },
  coingecko: { label: "CGK", color: "#8dc63f" },
  dexscreener: { label: "DEX", color: "#00b4d8" },
  pumpfun: { label: "PUMP", color: "#a855f7" },
  google: { label: "GOOG", color: "#4285f4" },
  cmc: { label: "CMC", color: "#3861fb" },
};

const RUG_COLOR: Record<string, string> = {
  low: "#00c47a",
  medium: "#ffaa00",
  high: "#ff2222",
  unknown: "#333",
};

export default function MemeScanner({ onSelectMeme, selectedMeme }: Props) {
  const [trends, setTrends] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [autoScan, setAutoScan] = useState(true);
  const [filter, setFilter] = useState<
    "all" | "new" | "telegram" | "twitter" | "social" | "onchain" | "safe"
  >("all");

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasMounted = useRef(false);
  const loadingRef = useRef(false);

  const fetchTrends = useCallback(
    async (silent = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      if (!silent) {
        setError("");
        setScanLog([]);
      }
      setProgress(0);

      const ticker = setInterval(
        () => setProgress((p) => Math.min(p + 1.0, 88)),
        400,
      );

      const logSteps = [
        "Scraping Telegram alpha channels...",
        "Hitting Twitter/X public endpoints...",
        "Fetching Pump.fun newest launches...",
        "Scanning DexScreener new Solana pairs...",
        "Pulling CoinGecko trending + new...",
        "Google Trends + Reddit signals...",
        "Running rugcheck on top candidates...",
        "Scoring and filtering results...",
      ];
      logSteps.forEach((msg, i) => {
        setTimeout(() => setScanLog((l) => [...l.slice(-6), msg]), i * 2000);
      });

      try {
        const res = await axios.get<{
          results: ScanResult[];
          logs: string[];
          scannedAt: string;
        }>("/api/scan", { timeout: 80000 });

        clearInterval(ticker);
        setProgress(100);
        const { results, logs } = res.data;
        setScanLog(logs);
        setTrends(results);
        setLastScan(new Date().toLocaleTimeString());
        setError("");
        setCountdown(REFRESH_INTERVAL);
        if (results.length > 0 && !selectedMeme) onSelectMeme(results[0]);
      } catch (err) {
        clearInterval(ticker);
        const msg = axios.isAxiosError(err)
          ? err.response?.data?.error || err.message
          : "Unknown error";
        setError(`Scan failed: ${msg}`);
      } finally {
        setLoading(false);
        loadingRef.current = false;
        setTimeout(() => setProgress(0), 600);
      }
    },
    [selectedMeme, onSelectMeme],
  );

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      fetchTrends();
    }
  }, []);

  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (autoScan && !loadingRef.current) fetchTrends(true);
          return REFRESH_INTERVAL;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoScan, fetchTrends]);

  const getSignal = (item: ScanResult) => {
    const p = item.platforms || [];
    const hasTg = p.includes("telegram");
    const hasTw = p.includes("twitter");
    const hasSocial = p.includes("reddit") || p.includes("google");
    const hasChain = p.includes("pumpfun") || p.includes("dexscreener");
    const count = item.crossPlatforms ?? 0;

    if (hasTg && hasTw && hasChain)
      return { label: "TG+X+CHAIN", color: "#ff2020" };
    if (hasTg && hasChain && hasSocial)
      return { label: "VIRAL+TG+CHAIN", color: "#ff2020" };
    if (hasTg && hasTw) return { label: "TG+TWITTER", color: "#ff5500" };
    if (hasTg && hasChain) return { label: "TG+CHAIN", color: "#ff6600" };
    if (hasTg && item.isNewCoin) return { label: "TG+NEW", color: "#26a5e4" };
    if (hasTg) return { label: "TELEGRAM", color: "#26a5e4" };
    if (hasTw && hasChain) return { label: "X+CHAIN", color: "#ff6600" };
    if (hasTw && hasSocial) return { label: "X+SOCIAL", color: "#e2e8f0" };
    if (hasTw) return { label: "TWITTER", color: "#e2e8f0" };
    if (hasSocial && hasChain && count >= 3)
      return { label: "VIRAL+CHAIN", color: "#ff2020" };
    if (hasSocial && hasChain)
      return { label: "SOCIAL+CHAIN", color: "#ff6600" };
    if (hasSocial && count >= 3) return { label: "VIRAL", color: "#ffcc00" };
    if (hasChain && item.isNewCoin)
      return { label: "NEW COIN", color: "#a855f7" };
    if (hasChain) return { label: "ON-CHAIN", color: "#00c47a" };
    if (item.hasTicker && hasSocial)
      return { label: "TRENDING", color: "#e8490f" };
    if (item.score > 30000) return { label: "HOT", color: "#ff6600" };
    return { label: "WATCH", color: "#333" };
  };

  const fmt = {
    mcap: (n?: number) => {
      if (!n) return null;
      if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
      return `$${n.toFixed(0)}`;
    },
    liq: (n?: number) => {
      if (!n) return null;
      if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M liq`;
      if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K liq`;
      return `$${n.toFixed(0)} liq`;
    },
    change: (n?: number) => {
      if (n === undefined || n === null) return null;
      const color = n > 0 ? "#00c47a" : n < -20 ? "#ff4444" : "#888";
      return { text: `${n > 0 ? "+" : ""}${n.toFixed(0)}%`, color };
    },
    addr: (a?: string) => (a ? `${a.slice(0, 4)}...${a.slice(-4)}` : null),
  };

  // Parse scan log stats
  const tgLog = scanLog.find((l) => l.includes("[Telegram]")) || "";
  const twLog = scanLog.find((l) => l.includes("[Twitter/X]")) || "";
  const tgChannels = parseInt(tgLog.match(/(\d+)\//)?.[1] || "0");
  const tgTickers = parseInt(tgLog.match(/(\d+) tickers/)?.[1] || "0");
  const twTickers = parseInt(twLog.match(/(\d+) tickers/)?.[1] || "0");
  const twMethod = twLog.match(/method:([^\s]+)/)?.[1] || "none";
  const twOnline = twMethod !== "none" && twTickers > 0;

  const filtered = trends.filter((t) => {
    const p = t.platforms || [];
    if (filter === "new") return t.isNewCoin;
    if (filter === "telegram") return p.includes("telegram");
    if (filter === "twitter") return p.includes("twitter");
    if (filter === "social")
      return p.some((x) => ["reddit", "google"].includes(x));
    if (filter === "onchain")
      return p.some((x) => ["pumpfun", "dexscreener"].includes(x));
    if (filter === "safe") return t.rugRisk === "low";
    return true;
  });

  const S = {
    root: {
      background: "#080808",
      border: "1px solid #151515",
      borderRadius: 8,
      overflow: "hidden" as const,
      height: "100%",
      display: "flex",
      flexDirection: "column" as const,
    },
    mono: { fontFamily: "'JetBrains Mono', 'Fira Mono', monospace" as const },
    header: {
      borderBottom: "1px solid #111",
      padding: "12px 16px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexShrink: 0,
    },
  };

  // Filter tab config
  const TABS: { key: typeof filter; label: string; color?: string }[] = [
    { key: "all", label: "ALL" },
    { key: "new", label: "NEW" },
    { key: "telegram", label: "TELEGRAM", color: "#26a5e4" },
    { key: "twitter", label: "X/TWITTER", color: "#e2e8f0" },
    { key: "social", label: "VIRAL" },
    { key: "onchain", label: "ON-CHAIN" },
    { key: "safe", label: "SAFE" },
  ];

  const SCAN_SOURCES = [
    "Telegram",
    "Twitter/X",
    "Pump.fun",
    "DexScreener",
    "CoinGecko",
    "Reddit",
    "Rugcheck",
    "Scoring",
  ];

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap" as const,
            }}
          >
            <span
              style={{
                color: "#e8490f",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.18em",
                ...S.mono,
              }}
            >
              MEME SCANNER
            </span>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: loading ? "#ffaa00" : "#00c47a",
                boxShadow: `0 0 6px ${loading ? "#ffaa00" : "#00c47a"}`,
                display: "inline-block",
              }}
            />
            <span
              style={{
                color: loading ? "#ffaa00" : "#00c47a",
                fontSize: 9,
                ...S.mono,
              }}
            >
              {loading ? "SCANNING" : "LIVE"}
            </span>

            {/* Telegram status */}
            {!loading && lastScan && (
              <span
                style={{
                  fontSize: 9,
                  ...S.mono,
                  color: tgChannels > 0 ? "#26a5e4" : "#333",
                  border: `1px solid ${tgChannels > 0 ? "#26a5e433" : "#222"}`,
                  padding: "1px 6px",
                  borderRadius: 3,
                }}
              >
                TG{" "}
                {tgChannels > 0 ? `${tgChannels}ch +${tgTickers}` : "offline"}
              </span>
            )}

            {/* Twitter status */}
            {!loading && lastScan && (
              <span
                style={{
                  fontSize: 9,
                  ...S.mono,
                  color: twOnline ? "#e2e8f0" : "#333",
                  border: `1px solid ${twOnline ? "#e2e8f022" : "#222"}`,
                  padding: "1px 6px",
                  borderRadius: 3,
                }}
              >
                X {twOnline ? `+${twTickers}` : "offline"}
              </span>
            )}
          </div>
          <div style={{ color: "#333", fontSize: 10, marginTop: 3, ...S.mono }}>
            {loading
              ? scanLog[scanLog.length - 1] || "Initializing..."
              : lastScan
                ? `${lastScan} · ${trends.length} signals · refresh in ${countdown}s`
                : "Telegram · Twitter/X · Pump.fun · DexScreener · CoinGecko · Reddit"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => setAutoScan((v) => !v)}
            style={{
              background: autoScan ? "#001a08" : "#111",
              border: `1px solid ${autoScan ? "#00c47a44" : "#1a1a1a"}`,
              color: autoScan ? "#00c47a" : "#444",
              borderRadius: 4,
              padding: "5px 9px",
              fontSize: 9,
              cursor: "pointer",
              ...S.mono,
              letterSpacing: "0.1em",
            }}
          >
            AUTO {autoScan ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => fetchTrends()}
            disabled={loading}
            style={{
              background: loading ? "#111" : "#e8490f",
              color: loading ? "#555" : "#fff",
              border: "none",
              borderRadius: 4,
              padding: "7px 16px",
              fontSize: 11,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              ...S.mono,
              letterSpacing: "0.1em",
            }}
          >
            {loading ? "SCANNING..." : "SCAN NOW"}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {loading && (
        <div
          style={{
            background: "#050505",
            borderBottom: "1px solid #0d0d0d",
            padding: "10px 16px",
          }}
        >
          <div
            style={{
              height: 2,
              background: "#111",
              borderRadius: 1,
              marginBottom: 8,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background: "linear-gradient(90deg, #e8490f, #ff8800)",
                transition: "width 0.35s ease",
                boxShadow: "0 0 8px #e8490f88",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              gap: 12,
              marginBottom: 6,
              flexWrap: "wrap" as const,
            }}
          >
            {SCAN_SOURCES.map((label, i) => {
              const step = Math.floor(progress / (100 / SCAN_SOURCES.length));
              const active = step === i;
              const done = step > i;
              return (
                <span
                  key={label}
                  style={{
                    fontSize: 9,
                    ...S.mono,
                    letterSpacing: "0.08em",
                    color: active
                      ? label === "Telegram"
                        ? "#26a5e4"
                        : label === "Twitter/X"
                          ? "#e2e8f0"
                          : "#e8490f"
                      : done
                        ? "#222"
                        : "#1a1a1a",
                  }}
                >
                  {active ? ">" : done ? "·" : "·"} {label.toUpperCase()}
                </span>
              );
            })}
          </div>
          {scanLog.slice(-2).map((line, i, arr) => (
            <div
              key={i}
              style={{
                color: i === arr.length - 1 ? "#666" : "#1e1e1e",
                fontSize: 10,
                ...S.mono,
                lineHeight: "1.6",
              }}
            >
              {i === arr.length - 1 ? "> " : "  "}
              {line}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div
          style={{
            padding: "8px 16px",
            color: "#ff4444",
            fontSize: 10,
            ...S.mono,
            borderBottom: "1px solid #1a1a1a",
            background: "#ff000008",
          }}
        >
          {error}
        </div>
      )}

      {/* Filter tabs */}
      <div
        style={{
          padding: "5px 10px",
          borderBottom: "1px solid #0d0d0d",
          display: "flex",
          gap: 3,
          background: "#040404",
          flexShrink: 0,
          alignItems: "center",
          flexWrap: "wrap" as const,
        }}
      >
        {TABS.map(({ key, label, color }) => {
          const active = filter === key;
          const col = color || "#e8490f";
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                background: active ? "#111" : "transparent",
                border: `1px solid ${active ? col + "55" : "transparent"}`,
                color: active ? col : "#2a2a2a",
                borderRadius: 3,
                padding: "3px 8px",
                fontSize: 9,
                cursor: "pointer",
                ...S.mono,
                letterSpacing: "0.08em",
                transition: "all 0.15s",
              }}
            >
              {label}
            </button>
          );
        })}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {Object.entries(PLATFORM).map(([, { label, color }]) => (
            <span
              key={label}
              style={{
                fontSize: 8,
                ...S.mono,
                color,
                opacity: 0.4,
                letterSpacing: "0.05em",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && !loading && !error && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column" as const,
            alignItems: "center",
            justifyContent: "center",
            color: "#111",
            ...S.mono,
            gap: 8,
          }}
        >
          <div
            style={{ fontSize: 28, color: "#0d0d0d", letterSpacing: "0.3em" }}
          >
            WRAITH
          </div>
          <div
            style={{ fontSize: 10, letterSpacing: "0.15em", color: "#1a1a1a" }}
          >
            {filter === "telegram"
              ? "NO TELEGRAM HITS — CHANNELS OFFLINE"
              : filter === "twitter"
                ? "NO X/TWITTER HITS — ENDPOINT OFFLINE"
                : filter === "safe"
                  ? "NO SAFE TOKENS FOUND THIS SCAN"
                  : "HUNTING SIGNALS..."}
          </div>
        </div>
      )}

      {/* Results list */}
      <div style={{ flex: 1, overflowY: "auto" as const }}>
        {filtered.map((t, i) => {
          const sig = getSignal(t);
          const isSelected = selectedMeme?.keyword === t.keyword;
          const p = t.platforms || [];
          const mcap = fmt.mcap(t.mcap);
          const liq = fmt.liq(t.liquidity);
          const change1h = fmt.change(t.priceChange1h);
          const change24h = fmt.change(t.priceChange24h);
          const addr = fmt.addr(t.contractAddress);

          return (
            <button
              key={t.keyword}
              onClick={() => onSelectMeme(t)}
              style={{
                width: "100%",
                textAlign: "left" as const,
                padding: "8px 14px 8px 16px",
                borderBottom: "1px solid #080808",
                background: isSelected ? "#0d0300" : "transparent",
                borderLeft: `2px solid ${isSelected ? "#e8490f" : "transparent"}`,
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                cursor: "pointer",
                gap: 8,
              }}
              onMouseEnter={(e) => {
                if (!isSelected)
                  (e.currentTarget as HTMLElement).style.background = "#0a0a0a";
              }}
              onMouseLeave={(e) => {
                if (!isSelected)
                  (e.currentTarget as HTMLElement).style.background =
                    "transparent";
              }}
            >
              {/* Left side */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: "#1e1e1e",
                    fontSize: 9,
                    ...S.mono,
                    width: 18,
                    flexShrink: 0,
                    paddingTop: 2,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div style={{ minWidth: 0 }}>
                  {/* Name + badges row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      flexWrap: "wrap" as const,
                      marginBottom: 3,
                    }}
                  >
                    <span
                      style={{
                        color: "#f0f0f0",
                        fontSize: 13,
                        fontWeight: 700,
                        ...S.mono,
                        letterSpacing: "0.05em",
                      }}
                    >
                      ${t.keyword.toUpperCase()}
                    </span>

                    {/* NEW badge */}
                    {t.isNewCoin && (
                      <span
                        style={{
                          fontSize: 7,
                          color: "#a855f7",
                          border: "1px solid #a855f744",
                          padding: "1px 4px",
                          borderRadius: 2,
                          ...S.mono,
                        }}
                      >
                        NEW
                      </span>
                    )}

                    {/* Platform badges */}
                    {p.map((plat) => {
                      const pi = PLATFORM[plat];
                      if (!pi) return null;
                      return (
                        <span
                          key={plat}
                          style={{
                            fontSize: 7,
                            color: pi.color,
                            border: `1px solid ${pi.color}33`,
                            padding: "1px 4px",
                            borderRadius: 2,
                            ...S.mono,
                            fontWeight: ["telegram", "twitter"].includes(plat)
                              ? 700
                              : 400,
                            background: ["telegram", "twitter"].includes(plat)
                              ? `${pi.color}0e`
                              : "transparent",
                          }}
                        >
                          {pi.label}
                        </span>
                      );
                    })}

                    {/* Rug risk badge */}
                    {t.rugRisk && t.rugRisk !== "unknown" && (
                      <span
                        style={{
                          fontSize: 7,
                          color: RUG_COLOR[t.rugRisk],
                          border: `1px solid ${RUG_COLOR[t.rugRisk]}33`,
                          padding: "1px 4px",
                          borderRadius: 2,
                          ...S.mono,
                        }}
                      >
                        {t.rugRisk === "low"
                          ? "SAFE"
                          : t.rugRisk === "medium"
                            ? "MED RISK"
                            : "RUG RISK"}
                      </span>
                    )}
                  </div>

                  {/* Data row 1 — price / liquidity / age */}
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      flexWrap: "wrap" as const,
                      marginBottom: 2,
                    }}
                  >
                    {change1h && (
                      <span
                        style={{
                          fontSize: 9,
                          color: change1h.color,
                          ...S.mono,
                          fontWeight: 600,
                        }}
                      >
                        1h {change1h.text}
                      </span>
                    )}
                    {change24h && (
                      <span
                        style={{
                          fontSize: 9,
                          color: change24h.color,
                          ...S.mono,
                          opacity: 0.7,
                        }}
                      >
                        24h {change24h.text}
                      </span>
                    )}
                    {liq && (
                      <span
                        style={{ fontSize: 9, color: "#2a6a4a", ...S.mono }}
                      >
                        {liq}
                      </span>
                    )}
                    {mcap && (
                      <span
                        style={{ fontSize: 9, color: "#2a2a2a", ...S.mono }}
                      >
                        mc {mcap}
                      </span>
                    )}
                    {t.ageLabel && (
                      <span
                        style={{ fontSize: 9, color: "#1e1e1e", ...S.mono }}
                      >
                        {t.ageLabel}
                      </span>
                    )}
                  </div>

                  {/* Data row 2 — social mentions + CA */}
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      flexWrap: "wrap" as const,
                    }}
                  >
                    {(t.telegramMentions ?? 0) > 0 && (
                      <span
                        style={{ fontSize: 8, color: "#26a5e466", ...S.mono }}
                      >
                        TG ×{t.telegramMentions}
                      </span>
                    )}
                    {(t.twitterMentions ?? 0) > 0 && (
                      <span
                        style={{ fontSize: 8, color: "#e2e8f033", ...S.mono }}
                      >
                        X ×{t.twitterMentions}
                      </span>
                    )}
                    {addr && (
                      <span
                        style={{
                          fontSize: 8,
                          color: "#1a1a1a",
                          ...S.mono,
                          cursor: "pointer",
                        }}
                        title={t.contractAddress}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (t.contractAddress) {
                            navigator.clipboard.writeText(t.contractAddress);
                          }
                        }}
                      >
                        CA: {addr}
                      </span>
                    )}
                    {t.rugDetails && t.rugRisk === "medium" && (
                      <span
                        style={{ fontSize: 7, color: "#553300", ...S.mono }}
                      >
                        {t.rugDetails}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right side — score + signal label */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column" as const,
                  alignItems: "flex-end",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    ...S.mono,
                    letterSpacing: "0.04em",
                    padding: "3px 7px",
                    borderRadius: 3,
                    color: sig.color,
                    border: `1px solid ${sig.color}44`,
                    background: `${sig.color}0d`,
                    boxShadow:
                      sig.color !== "#333" ? `0 0 8px ${sig.color}22` : "none",
                    whiteSpace: "nowrap" as const,
                  }}
                >
                  {sig.label}
                </span>
                <span style={{ color: "#1a1a1a", fontSize: 9, ...S.mono }}>
                  {t.score.toLocaleString()}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      {trends.length > 0 && (
        <div
          style={{
            borderTop: "1px solid #0d0d0d",
            padding: "6px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
            flexWrap: "wrap" as const,
            gap: 4,
            background: "#040404",
          }}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <span style={{ color: "#ff2020", fontSize: 8, ...S.mono }}>
              TG+X+CHAIN = triple source cross
            </span>
            <span style={{ color: "#26a5e4", fontSize: 8, ...S.mono }}>
              TG: {trends.filter((t) => t.onTelegram).length}
            </span>
            <span style={{ color: "#e2e8f055", fontSize: 8, ...S.mono }}>
              X: {trends.filter((t) => t.onTwitter).length}
            </span>
            <span style={{ color: "#00c47a44", fontSize: 8, ...S.mono }}>
              SAFE: {trends.filter((t) => t.rugRisk === "low").length}
            </span>
          </div>
          <span
            style={{
              color: autoScan ? "#00c47a66" : "#222",
              fontSize: 8,
              ...S.mono,
            }}
          >
            {autoScan ? `AUTO REFRESH ${countdown}s` : "AUTO OFF"}
          </span>
        </div>
      )}
    </div>
  );
}
