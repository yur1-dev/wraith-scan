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
}

interface Props {
  onSelectMeme: (meme: MemeTrend) => void;
  selectedMeme: MemeTrend | null;
}

const REFRESH_INTERVAL = 90;

export default function MemeScanner({ onSelectMeme, selectedMeme }: Props) {
  const [trends, setTrends] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [autoScan, setAutoScan] = useState(true);
  const [filter, setFilter] = useState<"all" | "new" | "social" | "onchain">(
    "all",
  );

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
        () => setProgress((p) => Math.min(p + 1.2, 88)),
        350,
      );

      const logSteps = [
        "Connecting to Reddit — public JSON, no auth...",
        "Scanning meme subs for viral moments...",
        "Checking Pump.fun newest coins...",
        "Pulling DexScreener new Solana pairs < 24h...",
        "Fetching CoinGecko new listings...",
        "Scanning Google Trends RSS...",
        "Cross-platform scoring in progress...",
      ];
      logSteps.forEach((msg, i) => {
        setTimeout(() => setScanLog((l) => [...l.slice(-6), msg]), i * 2200);
      });

      try {
        const res = await axios.get<{
          results: ScanResult[];
          logs: string[];
          scannedAt: string;
        }>("/api/scan", { timeout: 75000 });

        clearInterval(ticker);
        setProgress(100);
        const { results, logs } = res.data;
        setScanLog(logs);
        setTrends(results);
        setLastScan(new Date().toLocaleTimeString());
        setError("");
        setCountdown(REFRESH_INTERVAL);

        if (results.length > 0 && !selectedMeme) {
          onSelectMeme(results[0]);
        }
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

  // Platform colors — no emoji
  const PLATFORM: Record<string, { label: string; color: string }> = {
    reddit: { label: "REDDIT", color: "#ff4500" },
    coingecko: { label: "GECKO", color: "#8dc63f" },
    dexscreener: { label: "DEX", color: "#00b4d8" },
    pumpfun: { label: "PUMP", color: "#a855f7" },
    google: { label: "GOOGLE", color: "#4285f4" },
    cmc: { label: "CMC", color: "#3861fb" },
  };

  // Signal classification
  const getSignal = (item: ScanResult) => {
    const p = item.platforms || [];
    const hasSocial = p.includes("reddit") || p.includes("google");
    const hasChain = p.includes("pumpfun") || p.includes("dexscreener");
    const count = item.crossPlatforms ?? 0;

    if (hasSocial && hasChain && count >= 3)
      return { label: "VIRAL+CHAIN", color: "#ff2020", bar: "#ff2020" };
    if (hasSocial && hasChain)
      return { label: "SOCIAL+CHAIN", color: "#ff6600", bar: "#ff6600" };
    if (hasSocial && count >= 3)
      return { label: "VIRAL", color: "#ffcc00", bar: "#ffcc00" };
    if (hasChain && item.isNewCoin)
      return { label: "NEW COIN", color: "#a855f7", bar: "#a855f7" };
    if (hasChain)
      return { label: "ON-CHAIN", color: "#00c47a", bar: "#00c47a" };
    if (item.hasTicker && hasSocial)
      return { label: "TRENDING", color: "#e8490f", bar: "#e8490f" };
    if (item.hasTicker)
      return { label: "TICKER", color: "#e8490f", bar: "#e8490f" };
    if (item.score > 30000)
      return { label: "HOT", color: "#ff6600", bar: "#ff6600" };
    return { label: "WATCH", color: "#333", bar: "#222" };
  };

  const formatMcap = (n?: number) => {
    if (!n) return null;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  };

  const filtered = trends.filter((t) => {
    if (filter === "new") return t.isNewCoin;
    if (filter === "social")
      return (t.platforms || []).some((p) => ["reddit", "google"].includes(p));
    if (filter === "onchain")
      return (t.platforms || []).some((p) =>
        ["pumpfun", "dexscreener"].includes(p),
      );
    return true;
  });

  const S = {
    root: {
      background: "#0d0d0d",
      border: "1px solid #1a1a1a",
      borderRadius: 8,
      overflow: "hidden" as const,
      height: "100%",
      display: "flex",
      flexDirection: "column" as const,
    },
    header: {
      borderBottom: "1px solid #1a1a1a",
      padding: "14px 18px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexShrink: 0,
    },
    mono: { fontFamily: "monospace" as const },
  };

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                color: "#e8490f",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.15em",
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
          </div>
          <div style={{ color: "#444", fontSize: 10, marginTop: 2, ...S.mono }}>
            {loading
              ? scanLog[scanLog.length - 1] || "Initializing..."
              : lastScan
                ? `${lastScan} — ${trends.length} signals — refresh in ${countdown}s`
                : "Reddit / Pump.fun / DexScreener / CoinGecko / Google Trends — no keys"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setAutoScan((v) => !v)}
            style={{
              background: autoScan ? "#001a08" : "#111",
              border: `1px solid ${autoScan ? "#00c47a44" : "#1a1a1a"}`,
              color: autoScan ? "#00c47a" : "#444",
              borderRadius: 4,
              padding: "6px 10px",
              fontSize: 10,
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
              background: loading ? "#1a1a1a" : "#e8490f",
              color: loading ? "#666" : "#fff",
              border: "none",
              borderRadius: 4,
              padding: "8px 18px",
              fontSize: 11,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              ...S.mono,
              letterSpacing: "0.12em",
            }}
          >
            {loading ? "SCANNING..." : "SCAN NOW"}
          </button>
        </div>
      </div>

      {/* Progress */}
      {loading && (
        <div
          style={{
            background: "#090909",
            borderBottom: "1px solid #111",
            padding: "10px 18px",
          }}
        >
          <div
            style={{
              height: 2,
              background: "#1a1a1a",
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
                transition: "width 0.3s ease",
                boxShadow: "0 0 8px #e8490f88",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              gap: 14,
              marginBottom: 6,
              flexWrap: "wrap" as const,
            }}
          >
            {[
              "Reddit",
              "Pump.fun",
              "DexScreener",
              "CoinGecko",
              "Google",
              "Scoring",
            ].map((label, i) => {
              const active = Math.floor(progress / (100 / 6)) === i;
              return (
                <span
                  key={label}
                  style={{
                    fontSize: 9,
                    ...S.mono,
                    color: active ? "#e8490f" : "#2a2a2a",
                    letterSpacing: "0.1em",
                  }}
                >
                  {active ? ">" : "·"} {label.toUpperCase()}
                </span>
              );
            })}
          </div>
          {scanLog.slice(-2).map((line, i, arr) => (
            <div
              key={i}
              style={{
                color: i === arr.length - 1 ? "#777" : "#2a2a2a",
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
            padding: "10px 18px",
            color: "#ff4444",
            fontSize: 11,
            ...S.mono,
            borderBottom: "1px solid #1a1a1a",
            background: "#ff000008",
          }}
        >
          {error}
        </div>
      )}

      {/* Filter bar */}
      <div
        style={{
          padding: "6px 12px",
          borderBottom: "1px solid #111",
          display: "flex",
          gap: 4,
          background: "#090909",
          flexShrink: 0,
        }}
      >
        {(["all", "new", "social", "onchain"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: filter === f ? "#1a1a1a" : "transparent",
              border: `1px solid ${filter === f ? "#333" : "transparent"}`,
              color: filter === f ? "#e8490f" : "#333",
              borderRadius: 3,
              padding: "3px 8px",
              fontSize: 9,
              cursor: "pointer",
              ...S.mono,
              letterSpacing: "0.1em",
            }}
          >
            {f === "all"
              ? "ALL"
              : f === "new"
                ? "NEW COINS"
                : f === "social"
                  ? "VIRAL"
                  : "ON-CHAIN"}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          {Object.entries(PLATFORM).map(([, { label, color }]) => (
            <span
              key={label}
              style={{ fontSize: 9, ...S.mono, color, opacity: 0.6 }}
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
            color: "#222",
            ...S.mono,
            gap: 8,
          }}
        >
          <div style={{ fontSize: 32, color: "#1a1a1a" }}>WRAITH</div>
          <div style={{ fontSize: 11, letterSpacing: "0.15em" }}>
            HUNTING SIGNALS...
          </div>
        </div>
      )}

      {/* Results */}
      <div style={{ flex: 1, overflowY: "auto" as const }}>
        {filtered.map((t, i) => {
          const sig = getSignal(t);
          const isSelected = selectedMeme?.keyword === t.keyword;
          const mcap = formatMcap(t.mcap);

          return (
            <button
              key={t.keyword}
              onClick={() => onSelectMeme(t)}
              style={{
                width: "100%",
                textAlign: "left" as const,
                padding: "9px 14px 9px 18px",
                borderBottom: "1px solid #0d0d0d",
                background: isSelected ? "#130700" : "transparent",
                borderLeft: `2px solid ${isSelected ? "#e8490f" : "transparent"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (!isSelected)
                  (e.currentTarget as HTMLElement).style.background = "#101010";
              }}
              onMouseLeave={(e) => {
                if (!isSelected)
                  (e.currentTarget as HTMLElement).style.background =
                    "transparent";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    color: "#222",
                    fontSize: 10,
                    ...S.mono,
                    width: 20,
                    flexShrink: 0,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  {/* Name + platform badges */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      flexWrap: "wrap" as const,
                      marginBottom: 2,
                    }}
                  >
                    <span
                      style={{
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 700,
                        ...S.mono,
                      }}
                    >
                      ${t.keyword.toUpperCase()}
                    </span>
                    {t.isNewCoin && (
                      <span
                        style={{
                          fontSize: 8,
                          color: "#a855f7",
                          border: "1px solid #a855f744",
                          padding: "1px 5px",
                          borderRadius: 3,
                          ...S.mono,
                          letterSpacing: "0.05em",
                        }}
                      >
                        NEW
                      </span>
                    )}
                    {(t.platforms || []).map((p) => {
                      const pi = PLATFORM[p];
                      if (!pi) return null;
                      return (
                        <span
                          key={p}
                          style={{
                            fontSize: 8,
                            color: pi.color,
                            border: `1px solid ${pi.color}33`,
                            padding: "1px 4px",
                            borderRadius: 3,
                            ...S.mono,
                          }}
                        >
                          {pi.label}
                        </span>
                      );
                    })}
                  </div>

                  {/* Sub-info row */}
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <span style={{ color: "#2a2a2a", fontSize: 10, ...S.mono }}>
                      {t.source.length > 35
                        ? t.source.slice(0, 35) + "..."
                        : t.source}
                    </span>
                    {t.ageLabel && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "#444",
                          ...S.mono,
                          borderLeft: "1px solid #1a1a1a",
                          paddingLeft: 8,
                        }}
                      >
                        {t.ageLabel}
                      </span>
                    )}
                    {mcap && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "#333",
                          ...S.mono,
                          borderLeft: "1px solid #1a1a1a",
                          paddingLeft: 8,
                        }}
                      >
                        mcap {mcap}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                <span style={{ color: "#333", fontSize: 10, ...S.mono }}>
                  {t.score.toLocaleString()}
                </span>
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    ...S.mono,
                    letterSpacing: "0.05em",
                    padding: "3px 7px",
                    borderRadius: 3,
                    color: sig.color,
                    border: `1px solid ${sig.color}44`,
                    background: `${sig.color}0d`,
                    boxShadow:
                      sig.color !== "#333" ? `0 0 6px ${sig.color}33` : "none",
                    whiteSpace: "nowrap" as const,
                  }}
                >
                  {sig.label}
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
            borderTop: "1px solid #1a1a1a",
            padding: "7px 18px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
            flexWrap: "wrap" as const,
            gap: 6,
          }}
        >
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" as const }}>
            <span style={{ color: "#ff2020", fontSize: 9, ...S.mono }}>
              VIRAL+CHAIN — cross-platform viral meme with on-chain activity
            </span>
          </div>
          <span
            style={{
              color: autoScan ? "#00c47a" : "#333",
              fontSize: 9,
              ...S.mono,
            }}
          >
            {autoScan ? `REFRESH IN ${countdown}s` : "AUTO OFF"}
          </span>
        </div>
      )}
    </div>
  );
}
