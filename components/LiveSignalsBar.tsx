"use client";

import { useState, useEffect, useRef } from "react";
import { MemeTrend } from "@/app/app/page";
import { useWraithTier } from "@/hooks/useWraithTier";

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
  const { canUse: can, tier } = useWraithTier();
  const canSeeSignals = can("live_signals_view");
  const canSeeAiScore = can("ai_score");

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

  // ─── LOCKED STATE ─────────────────────────────────────────────────────────
  if (!canSeeSignals) {
    return (
      <div
        style={{
          background: "#030303",
          borderBottom: "1px solid #141414",
          padding: "8px 14px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#1e1e1e",
            flexShrink: 0,
            display: "inline-block",
          }}
        />
        <span
          style={{
            color: "#252525",
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
            fontSize: 8,
            color: "#2a2a2a",
            background: "#0d0d0d",
            border: "1px solid #1a1a1a",
            padding: "2px 8px",
            borderRadius: 2,
            ...MONO,
            letterSpacing: "0.08em",
          }}
        >
          LOCKED — REQUIRES{" "}
          <span style={{ color: "#a855f7", fontWeight: 700 }}>SPECTER</span>
        </span>
        <span style={{ fontSize: 8, color: "#1e1e1e", ...MONO }}>
          100K WRAITH
        </span>
      </div>
    );
  }

  // ─── UNLOCKED STATE ───────────────────────────────────────────────────────
  return (
    <div
      style={{
        background: "#030303",
        borderBottom: "1px solid #141414",
        padding: "5px 0 7px",
        flexShrink: 0,
      }}
    >
      <style>{`
        @keyframes sigpulse { 0%,100%{opacity:1} 50%{opacity:.25} }
        .sig-card { cursor:pointer; transition:background .18s ease, border-color .18s ease, transform .18s ease, box-shadow .18s ease; }
        .sig-card:hover { background:#0d0d0d !important; transform:translateY(-2px); box-shadow: 0 8px 20px -8px rgba(0,0,0,0.6); border-color: #242424 !important; }
        .sig-nav { background:#0d0d0d; border:1px solid #1c1c1c; border-radius:6px; cursor:pointer; padding:4px 9px; transition:color .15s, border-color .15s, background .15s; }
        .sig-nav:disabled { opacity:.25; cursor:default; }
        .sig-nav:not(:disabled):hover { color:#e8490f !important; border-color:#e8490f44 !important; background:#0f0a06 !important; }
        .sig-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap:8px; }
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
        <div className="sig-grid">
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
              ? "HOT"
              : isCeleb
                ? "CELEB"
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
                  position: "relative",
                  minWidth: 0,
                  background: "#0a0a0a",
                  border: "1px solid #161616",
                  borderRadius: 10,
                  padding: "10px 11px 9px",
                  display: "flex",
                  flexDirection: "column" as const,
                  gap: 7,
                }}
              >
                {/* Tier chip — a status tab hanging off the top edge,
                    rather than crammed inline next to the ticker */}
                <div
                  style={{
                    position: "absolute",
                    top: -1,
                    left: 10,
                    fontSize: 7,
                    fontWeight: 900,
                    ...MONO,
                    color: "#0a0a0a",
                    background: tc,
                    padding: "2px 7px",
                    borderRadius: "0 0 4px 4px",
                    letterSpacing: "0.06em",
                  }}
                >
                  {tierLabel}
                </div>

                {/* Symbol + age */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 6,
                    marginTop: 6,
                  }}
                >
                  <span
                    style={{
                      color: "#f0f0f0",
                      fontSize: 15,
                      fontWeight: 800,
                      ...MONO,
                      letterSpacing: "-0.01em",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap" as const,
                      lineHeight: 1.1,
                    }}
                  >
                    ${sym}
                  </span>
                  <span
                    style={{
                      color: "#3a3a3a",
                      fontSize: 8,
                      ...MONO,
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    {ageMin < 1 ? "now" : `${ageMin}m`}
                  </span>
                </div>

                {/* Mcap */}
                <span
                  style={{
                    color: "#e8490f",
                    fontSize: 12,
                    fontWeight: 700,
                    ...MONO,
                  }}
                >
                  {fmtMcap(sig.initialMcap)}
                </span>

                {/* AI score — a real gauge bar, not a dot grid */}
                {canSeeAiScore && typeof sig.aiScore === "number" && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column" as const,
                      gap: 3,
                    }}
                  >
                    <div
                      style={{
                        height: 4,
                        borderRadius: 3,
                        background: "#141414",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.max(0, Math.min(100, sig.aiScore))}%`,
                          background:
                            sig.aiTier === "HOT"
                              ? HOT_COLOR
                              : sig.aiTier === "WATCH"
                                ? "#ffaa00"
                                : "#00c47a",
                          borderRadius: 3,
                          transition: "width .3s ease",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        ...MONO,
                        alignSelf: "flex-end",
                        color:
                          sig.aiTier === "HOT"
                            ? HOT_COLOR
                            : sig.aiTier === "WATCH"
                              ? "#ffaa00"
                              : "#00c47a",
                      }}
                    >
                      {sig.aiScore}/100
                    </span>
                  </div>
                )}

                {/* Platforms */}
                <div
                  style={{
                    display: "flex",
                    gap: 3,
                    flexWrap: "wrap" as const,
                    marginTop: "auto",
                    paddingTop: 2,
                  }}
                >
                  {keyPlats.map((p) => (
                    <span
                      key={p}
                      style={{
                        fontSize: 7,
                        ...MONO,
                        color: PLAT_COLOR[p] || "#444",
                        background: `${PLAT_COLOR[p] || "#444"}12`,
                        border: `1px solid ${PLAT_COLOR[p] || "#444"}26`,
                        padding: "2px 6px",
                        borderRadius: 4,
                        letterSpacing: "0.03em",
                      }}
                    >
                      {PLAT_LABEL[p] || p.slice(0, 3).toUpperCase()}
                    </span>
                  ))}
                  {sig.platforms.length > 4 && (
                    <span
                      style={{
                        fontSize: 7,
                        color: "#333",
                        ...MONO,
                        alignSelf: "center",
                      }}
                    >
                      +{sig.platforms.length - 4}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
