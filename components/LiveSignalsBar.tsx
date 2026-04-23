"use client";

import { useState, useEffect, useRef } from "react";
import { MemeTrend } from "@/app/page";

const SCAN_CLUSTER_GAP_MS = 10 * 60 * 1000;
const LOOKBACK_MS = 40 * 60 * 1000;
const HISTORY_KEY = "wraith_token_history_v2";
const PAGE_SIZE = 6;
const MIN_MCAP = 2_000;
const MAX_MCAP = 100_000;

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};

const TIER_COLOR: Record<string, string> = {
  ULTRA: "#ffd700",
  HIGH: "#00c47a",
};
const HOT_COLOR = "#ff6b35";
const CELEB_COLOR = "#ffd700";

const PLAT_COLOR: Record<string, string> = {
  pumpfun: "#a855f7",
  dexscreener: "#00b4d8",
  celebrity: "#ffd700",
  twitter: "#aab8c8",
  reddit: "#ff5733",
  telegram: "#26a5e4",
  birdeye: "#00c47a",
  youtube: "#ff4444",
  "google-trends": "#4285f4",
  "google-news": "#4285f4",
  kym: "#44cc44",
};
const PLAT_LABEL: Record<string, string> = {
  pumpfun: "PUMP",
  dexscreener: "DEX",
  celebrity: "CELEB",
  twitter: "X",
  reddit: "REDDIT",
  telegram: "TG",
  birdeye: "BIRD",
  youtube: "YT",
  "google-trends": "TREND",
  "google-news": "NEWS",
  kym: "KYM",
};

interface Sig {
  keyword: string;
  tokenSymbol?: string;
  contractAddress?: string;
  celebMention?: string;
  initialMcap: number;
  seenAt: number;
  platforms: string[];
  twoXTier?: string;
  aiTier?: string;
  aiScore?: number;
  crossPlatforms?: number;
}

function fmtMcap(n: number) {
  if (!n) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function passes(e: Record<string, unknown>): boolean {
  if (!e.contractAddress) return false;
  const mcap = typeof e.initialMcap === "number" ? e.initialMcap : 0;
  if (mcap > 0 && mcap < MIN_MCAP) return false;
  if (mcap > MAX_MCAP) return false;
  const platforms = Array.isArray(e.platforms) ? (e.platforms as string[]) : [];
  const tier = typeof e.twoXTier === "string" ? e.twoXTier : null;
  const aiTier = typeof e.aiTier === "string" ? e.aiTier : null;
  const celeb =
    typeof e.celebMention === "string" && e.celebMention
      ? e.celebMention
      : null;
  const hasOnchain = platforms.some((p) =>
    ["pumpfun", "dexscreener", "birdeye"].includes(p),
  );
  if (!hasOnchain && !celeb) return false;
  if (aiTier === "SKIP") return false;
  if (!celeb) {
    if (!tier || ["SKIP", "LOW", "MEDIUM"].includes(tier)) return false;
  } else {
    if (tier === "SKIP") return false;
    if (!hasOnchain && (tier === "LOW" || tier === "MEDIUM")) return false;
  }
  return true;
}

function readLatestBatch(): { batchTs: number; sigs: Sig[] } {
  if (typeof window === "undefined") return { batchTs: 0, sigs: [] };
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
  } catch {
    return { batchTs: 0, sigs: [] };
  }

  const now = Date.now();
  const cutoff = now - LOOKBACK_MS;
  const candidates: Array<{ seenAt: number; sig: Sig }> = [];

  for (const [kw, v] of Object.entries(raw)) {
    const e = v as Record<string, unknown>;
    const seenAt = typeof e.seenAt === "number" ? e.seenAt : 0;
    if (seenAt < cutoff || !passes(e)) continue;
    const platforms = Array.isArray(e.platforms)
      ? (e.platforms as string[])
      : [];
    candidates.push({
      seenAt,
      sig: {
        keyword: typeof e.keyword === "string" ? e.keyword : kw,
        tokenSymbol:
          typeof e.tokenSymbol === "string" ? e.tokenSymbol : undefined,
        contractAddress: e.contractAddress as string,
        celebMention:
          typeof e.celebMention === "string" && e.celebMention
            ? e.celebMention
            : undefined,
        initialMcap: typeof e.initialMcap === "number" ? e.initialMcap : 0,
        seenAt,
        platforms,
        twoXTier: typeof e.twoXTier === "string" ? e.twoXTier : undefined,
        aiTier: typeof e.aiTier === "string" ? e.aiTier : undefined,
        aiScore: typeof e.aiScore === "number" ? e.aiScore : undefined,
        crossPlatforms:
          typeof e.crossPlatforms === "number"
            ? e.crossPlatforms
            : platforms.length,
      },
    });
  }

  if (!candidates.length) return { batchTs: 0, sigs: [] };
  candidates.sort((a, b) => b.seenAt - a.seenAt);

  const newestTs = candidates[0].seenAt;
  let batch = candidates.filter(
    (c) => c.seenAt >= newestTs - SCAN_CLUSTER_GAP_MS,
  );
  if (!batch.length) batch = candidates.slice(0, 20);

  const sigs = batch.map((c) => c.sig);
  sigs.sort((a, b) => {
    const rank = (s: Sig) =>
      s.aiTier === "HOT" ? 3 : s.twoXTier === "ULTRA" ? 2 : 1;
    if (rank(a) !== rank(b)) return rank(b) - rank(a);
    const sweet = (m: number) => (m >= 3_000 && m <= 50_000 ? 1 : 0);
    return sweet(b.initialMcap) - sweet(a.initialMcap);
  });

  return { batchTs: newestTs, sigs };
}

export default function LiveSignalsBar({
  onSelectMeme,
}: {
  onSelectMeme: (m: MemeTrend) => void;
}) {
  const [sigs, setSigs] = useState<Sig[]>([]);
  const [batchTs, setBatchTs] = useState(0);
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(Date.now());
  const prevTs = useRef(0);

  useEffect(() => {
    function read() {
      const res = readLatestBatch();
      const isNew = res.batchTs > prevTs.current;
      const isEmpty = sigs.length === 0 && res.sigs.length > 0;
      if (isNew || isEmpty) {
        prevTs.current = res.batchTs;
        setBatchTs(res.batchTs);
        setSigs(res.sigs);
        if (isNew) setPage(0);
      }
    }
    read();
    const t = setInterval(read, 12_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const totalPages = Math.max(1, Math.ceil(sigs.length / PAGE_SIZE));
  const visible = sigs.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const batchAgeMin = batchTs ? Math.floor((now - batchTs) / 60_000) : null;

  const click = (s: Sig) =>
    onSelectMeme({
      keyword: s.tokenSymbol || s.keyword,
      score: 0,
      posts: 1,
      source: s.platforms.join(",") || "history",
      hasTicker: !!s.contractAddress,
      crossPlatforms: s.crossPlatforms || 1,
      isNewCoin: false,
      mcap: s.initialMcap,
      platforms: s.platforms,
      contractAddress: s.contractAddress,
      celebMention: s.celebMention,
    } as MemeTrend);

  return (
    <div
      style={{
        background: "#030303",
        borderBottom: "1px solid #141414",
        padding: "5px 14px 7px",
        flexShrink: 0,
      }}
    >
      <style>{`
        @keyframes sigpulse { 0%,100%{opacity:1} 50%{opacity:.2} }
        .sig-card { cursor:pointer; transition:background .15s, border-color .15s, transform .1s; }
        .sig-card:hover { background:#0b0b0b !important; transform:translateY(-1px); border-top-color: rgba(232,73,15,.7) !important; }
        .sig-nav { background:transparent; border:none; cursor:pointer; padding:2px 6px; transition:color .15s; }
        .sig-nav:disabled { opacity:.15; cursor:default; }
        .sig-nav:not(:disabled):hover { color:#e8490f !important; }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: sigs.length ? 6 : 0,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            flexShrink: 0,
            display: "inline-block",
            background: sigs.length ? "#e8490f" : "#1e1e1e",
            animation: sigs.length
              ? "sigpulse 1.6s ease-in-out infinite"
              : "none",
          }}
        />
        <span
          style={{
            color: sigs.length ? "#e8490f" : "#282828",
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: "0.22em",
            ...MONO,
          }}
        >
          LIVE SIGNALS
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            ...MONO,
            color: sigs.length ? "#cc3d0d" : "#1e1e1e",
            background: sigs.length ? "#e8490f12" : "transparent",
            border: `1px solid ${sigs.length ? "#e8490f28" : "#1a1a1a"}`,
            padding: "1px 7px",
            borderRadius: 10,
          }}
        >
          {sigs.length}
        </span>
        {batchAgeMin !== null && sigs.length > 0 && (
          <span style={{ color: "#252525", fontSize: 8, ...MONO }}>
            · {batchAgeMin < 1 ? "just scanned" : `${batchAgeMin}m ago`}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <button
              className="sig-nav"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              style={{ color: "#333", fontSize: 11, ...MONO }}
            >
              ◀
            </button>
            <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
              {Array.from({ length: totalPages }).map((_, i) => (
                <div
                  key={i}
                  onClick={() => setPage(i)}
                  style={{
                    width: i === page ? 14 : 5,
                    height: 3,
                    borderRadius: 3,
                    background: i === page ? "#e8490f" : "#1e1e1e",
                    cursor: "pointer",
                    transition: "width .2s, background .2s",
                  }}
                />
              ))}
            </div>
            <button
              className="sig-nav"
              disabled={page === totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              style={{ color: "#333", fontSize: 11, ...MONO }}
            >
              ▶
            </button>
            <span style={{ color: "#222", fontSize: 8, ...MONO }}>
              {page + 1}/{totalPages}
            </span>
          </div>
        )}
      </div>

      {sigs.length === 0 && (
        <div
          style={{
            color: "#1c1c1c",
            fontSize: 9,
            letterSpacing: "0.1em",
            ...MONO,
          }}
        >
          HIGH / ULTRA signals appear here after each scan
        </div>
      )}

      {sigs.length > 0 && (
        <div style={{ display: "flex", gap: 5 }}>
          {visible.map((sig) => {
            const sym = (sig.tokenSymbol || sig.keyword)
              .toUpperCase()
              .slice(0, 9);
            const isHot = sig.aiTier === "HOT";
            const isCeleb = !!sig.celebMention;
            const tc = isHot
              ? HOT_COLOR
              : isCeleb
                ? CELEB_COLOR
                : TIER_COLOR[sig.twoXTier || ""] || "#444";
            const tierLabel = isHot
              ? "🔥 HOT"
              : isCeleb
                ? "⭐ CELEB"
                : sig.twoXTier || "HIGH";
            const ageMin = Math.floor((now - sig.seenAt) / 60_000);
            const keyPlats = sig.platforms
              .filter((p) =>
                [
                  "pumpfun",
                  "dexscreener",
                  "twitter",
                  "telegram",
                  "birdeye",
                  "celebrity",
                ].includes(p),
              )
              .slice(0, 4);

            return (
              <div
                key={sig.keyword}
                className="sig-card"
                onClick={() => click(sig)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "#070707",
                  border: `1px solid ${tc}20`,
                  borderTop: `2px solid ${tc}`,
                  borderRadius: "0 0 4px 4px",
                  padding: "5px 9px 7px",
                }}
              >
                {/* Row 1: tier badge + symbol + age */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 7,
                      fontWeight: 900,
                      ...MONO,
                      color: tc,
                      background: `${tc}18`,
                      border: `1px solid ${tc}30`,
                      padding: "1px 5px",
                      borderRadius: 2,
                      flexShrink: 0,
                      letterSpacing: "0.06em",
                    }}
                  >
                    {tierLabel}
                  </span>
                  <span
                    style={{
                      color: "#e0e0e0",
                      fontSize: 13,
                      fontWeight: 900,
                      ...MONO,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap" as const,
                      lineHeight: 1,
                    }}
                  >
                    ${sym}
                  </span>
                  <span
                    style={{
                      color: "#2e2e2e",
                      fontSize: 8,
                      ...MONO,
                      flexShrink: 0,
                    }}
                  >
                    {ageMin < 1 ? "now" : `${ageMin}m`}
                  </span>
                </div>

                {/* Row 2: mcap + AI score */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      color: "#e8490f",
                      fontSize: 11,
                      fontWeight: 800,
                      ...MONO,
                    }}
                  >
                    {fmtMcap(sig.initialMcap)}
                  </span>
                  {typeof sig.aiScore === "number" && (
                    <div
                      style={{
                        marginLeft: "auto",
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                      }}
                    >
                      {Array.from({ length: 5 }).map((_, i) => {
                        const filled = Math.round(sig.aiScore! / 20);
                        const dc =
                          sig.aiTier === "HOT"
                            ? HOT_COLOR
                            : sig.aiTier === "WATCH"
                              ? "#ffaa00"
                              : "#00c47a";
                        return (
                          <div
                            key={i}
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: 1,
                              background: i < filled ? dc : "#141414",
                            }}
                          />
                        );
                      })}
                      <span
                        style={{
                          fontSize: 8,
                          fontWeight: 800,
                          ...MONO,
                          marginLeft: 2,
                          color:
                            sig.aiTier === "HOT"
                              ? HOT_COLOR
                              : sig.aiTier === "WATCH"
                                ? "#ffaa00"
                                : "#00c47a",
                        }}
                      >
                        {sig.aiScore}
                      </span>
                    </div>
                  )}
                </div>

                {/* Row 3: platforms */}
                <div
                  style={{ display: "flex", gap: 3, flexWrap: "wrap" as const }}
                >
                  {keyPlats.map((p) => (
                    <span
                      key={p}
                      style={{
                        fontSize: 7,
                        ...MONO,
                        color: PLAT_COLOR[p] || "#444",
                        background: `${PLAT_COLOR[p] || "#444"}14`,
                        border: `1px solid ${PLAT_COLOR[p] || "#444"}28`,
                        padding: "1px 5px",
                        borderRadius: 2,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {PLAT_LABEL[p] || p.slice(0, 3).toUpperCase()}
                    </span>
                  ))}
                  {sig.platforms.length > 4 && (
                    <span style={{ fontSize: 7, color: "#2a2a2a", ...MONO }}>
                      +{sig.platforms.length - 4}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {visible.length < PAGE_SIZE &&
            Array.from({ length: PAGE_SIZE - visible.length }).map((_, i) => (
              <div key={`g${i}`} style={{ flex: 1, minWidth: 0 }} />
            ))}
        </div>
      )}
    </div>
  );
}
