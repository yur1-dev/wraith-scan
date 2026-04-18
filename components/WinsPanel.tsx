"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MemeTrend } from "@/app/page";
import {
  loadHistory,
  saveHistory,
  fetchCurrentMcap,
  fetchTokenMeta,
  HISTORY_KEY,
} from "./MemeScanner";

interface McapSnapshot {
  ts: number;
  mcap: number;
}

interface HistoryEntry {
  keyword: string;
  displayName?: string;
  tokenSymbol?: string;
  tokenImageUrl?: string;
  seenAt: number;
  contractAddress?: string;
  celebMention?: string;
  aiContext?: string;
  platforms: string[];
  initialMcap: number;
  peakMcap: number;
  currentMcap: number;
  snapshots: McapSnapshot[];
  lastChecked: number;
  tookProfitAt?: number;
}

interface Props {
  onSelectMeme?: (meme: MemeTrend) => void;
}

const MONO = {
  fontFamily:
    "'JetBrains Mono', 'Fira Mono', 'Courier New', monospace" as const,
};
const AUTO_REFRESH_MS = 60_000;
const UNDO_TIMEOUT_MS = 10_000;

function safeSnapshots(raw: unknown): McapSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is McapSnapshot =>
      s !== null &&
      typeof s === "object" &&
      typeof (s as Record<string, unknown>).ts === "number" &&
      typeof (s as Record<string, unknown>).mcap === "number",
  );
}

function safeEntry(key: string, raw: unknown): HistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  try {
    return {
      keyword: typeof r.keyword === "string" ? r.keyword : key,
      displayName:
        typeof r.displayName === "string" ? r.displayName : undefined,
      tokenSymbol:
        typeof r.tokenSymbol === "string" ? r.tokenSymbol : undefined,
      tokenImageUrl:
        typeof r.tokenImageUrl === "string" ? r.tokenImageUrl : undefined,
      seenAt: typeof r.seenAt === "number" ? r.seenAt : Date.now(),
      contractAddress:
        typeof r.contractAddress === "string" ? r.contractAddress : undefined,
      celebMention:
        typeof r.celebMention === "string" ? r.celebMention : undefined,
      aiContext: typeof r.aiContext === "string" ? r.aiContext : undefined,
      platforms: Array.isArray(r.platforms) ? (r.platforms as string[]) : [],
      initialMcap: typeof r.initialMcap === "number" ? r.initialMcap : 0,
      peakMcap: typeof r.peakMcap === "number" ? r.peakMcap : 0,
      currentMcap: typeof r.currentMcap === "number" ? r.currentMcap : 0,
      snapshots: safeSnapshots(r.snapshots),
      lastChecked:
        typeof r.lastChecked === "number" ? r.lastChecked : Date.now(),
      tookProfitAt:
        typeof r.tookProfitAt === "number" ? r.tookProfitAt : undefined,
    };
  } catch {
    return null;
  }
}

function loadSafeHistory(): Record<string, HistoryEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
    const result: Record<string, HistoryEntry> = {};
    for (const [key, val] of Object.entries(raw)) {
      const entry = safeEntry(key, val);
      if (entry) result[key] = entry;
    }
    return result;
  } catch {
    return {};
  }
}

function isGarbageKeyword(kw: string): boolean {
  if (kw.length > 14) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{10,}$/.test(kw)) return true;
  if (/\d{4,}/.test(kw)) return true;
  const vowels = (kw.match(/[aeiou]/gi) || []).length;
  if (kw.length >= 8 && vowels === 0) return true;
  return false;
}

function fmtMcap(n: number): string {
  if (!n || n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtTimeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
function calcX(initial: number, current: number): number {
  if (!initial || initial === 0) return 0;
  return current / initial;
}

// ─── TOKEN AVATAR ────────────────────────────────────────────────────────────
function TokenAvatar({
  imageUrl,
  symbol,
  size = 40,
}: {
  imageUrl?: string;
  symbol: string;
  size?: number;
}) {
  const [imgError, setImgError] = useState(false);
  const letter = (symbol || "?").charAt(0).toUpperCase();

  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={symbol}
        width={size}
        height={size}
        onError={() => setImgError(true)}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          border: "1px solid #1a1a1a",
        }}
      />
    );
  }

  const palette = [
    "#e8490f",
    "#a855f7",
    "#00b4d8",
    "#00c47a",
    "#ffd700",
    "#ff4500",
  ];
  const bg = palette[letter.charCodeAt(0) % palette.length];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `${bg}1a`,
        border: `1px solid ${bg}44`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: bg,
        fontSize: size * 0.38,
        fontWeight: 900,
        ...MONO,
      }}
    >
      {letter}
    </div>
  );
}

// ─── SPARKLINE ───────────────────────────────────────────────────────────────
function Sparkline({ snapshots }: { snapshots: McapSnapshot[] }) {
  const safe = safeSnapshots(snapshots);
  if (safe.length < 2) return null;
  const vals = safe.map((s) => s.mcap);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 72,
    H = 24;
  const pts = safe
    .map((s, i) => {
      const x = (i / (safe.length - 1)) * W;
      const y = H - ((s.mcap - min) / range) * (H - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = vals[vals.length - 1];
  const isUp = last >= vals[0];
  const color = isUp ? "#00c47a" : "#ff4455";
  const firstPt = `0,${H}`;
  const lastPt = `${W},${H}`;
  return (
    <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient
          id={`sg-${isUp ? "up" : "dn"}`}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`${firstPt} ${pts} ${lastPt}`}
        fill={`url(#sg-${isUp ? "up" : "dn"})`}
      />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── X BADGE ─────────────────────────────────────────────────────────────────
function XBadge({
  xNow,
  xPeak,
  isUpdating,
}: {
  xNow: number;
  xPeak: number;
  isUpdating: boolean;
}) {
  const isMega = xPeak >= 5;
  const isWin = xPeak >= 2;
  const isDead = xNow < 0.3;
  const color = isMega
    ? "#ffd700"
    : isWin
      ? "#00c47a"
      : xNow >= 1.2
        ? "#ffaa00"
        : isDead
          ? "#ff4455"
          : "#444";
  const bg = isMega
    ? "#120c00"
    : isWin
      ? "#001610"
      : isDead
        ? "#120000"
        : "#0c0c0c";
  const displayX = isUpdating ? null : xNow >= 0.01 ? xNow : null;
  const xStr = displayX
    ? displayX >= 100
      ? `${displayX.toFixed(0)}x`
      : displayX >= 10
        ? `${displayX.toFixed(1)}x`
        : `${displayX.toFixed(2)}x`
    : "—";

  return (
    <div
      style={{
        flexShrink: 0,
        width: 64,
        height: 54,
        background: bg,
        border: `1px solid ${color}33`,
        borderRadius: 6,
        display: "flex",
        flexDirection: "column" as const,
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
      }}
    >
      <div
        style={{ color: "#333", fontSize: 7, letterSpacing: "0.12em", ...MONO }}
      >
        NOW
      </div>
      <div
        style={{
          color: isUpdating ? "#2a2a2a" : color,
          fontSize: xStr.length > 5 ? 13 : 16,
          fontWeight: 900,
          lineHeight: 1,
          ...MONO,
        }}
      >
        {isUpdating ? "···" : xStr}
      </div>
      {xPeak > xNow * 1.15 && !isUpdating && (
        <div style={{ color: "#ffd70044", fontSize: 7, ...MONO, marginTop: 1 }}>
          pk {xPeak >= 10 ? xPeak.toFixed(1) : xPeak.toFixed(2)}x
        </div>
      )}
    </div>
  );
}

export default function WinsPanel({ onSelectMeme }: Props) {
  const [history, setHistory] = useState<Record<string, HistoryEntry>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [nextRefreshIn, setNextRefreshIn] = useState(AUTO_REFRESH_MS / 1000);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [updatingKeys, setUpdatingKeys] = useState<Set<string>>(new Set());
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(
    new Set(),
  );
  const [undoSnapshot, setUndoSnapshot] = useState<Record<
    string,
    HistoryEntry
  > | null>(null);
  const [undoCountdown, setUndoCountdown] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const h = loadSafeHistory();
    const clean: Record<string, HistoryEntry> = {};
    for (const [key, entry] of Object.entries(h)) {
      // Drop garbage keywords
      if (isGarbageKeyword(key)) continue;
      // Drop tokens with no contract address and no mcap — pure noise
      if (!entry.contractAddress && entry.initialMcap === 0) continue;
      // Drop tokens that never had any real mcap data
      if (
        entry.initialMcap === 0 &&
        entry.currentMcap === 0 &&
        entry.peakMcap === 0
      )
        continue;
      clean[key] = entry;
    }
    if (Object.keys(clean).length !== Object.keys(h).length) {
      saveHistory(clean);
    }
    setHistory(clean);
    backfillTokenMeta(clean);
  }, []);

  async function backfillTokenMeta(h: Record<string, HistoryEntry>) {
    const toFill = Object.values(h).filter(
      (e) => e.contractAddress && !e.tokenImageUrl,
    );
    if (!toFill.length) return;
    const updated = { ...h };
    for (let i = 0; i < toFill.length; i += 8) {
      await Promise.all(
        toFill.slice(i, i + 8).map(async (entry) => {
          const meta = await fetchTokenMeta(entry.contractAddress!);
          if (meta) {
            updated[entry.keyword] = {
              ...updated[entry.keyword],
              displayName: updated[entry.keyword].displayName || meta.name,
              tokenSymbol: updated[entry.keyword].tokenSymbol || meta.symbol,
              tokenImageUrl: meta.imageUrl,
            };
          }
        }),
      );
    }
    saveHistory(updated);
    setHistory({ ...updated });
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && undoSnapshot)
        handleUndo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoSnapshot]);

  const handleUndo = () => {
    if (!undoSnapshot) return;
    saveHistory(undoSnapshot);
    setHistory({ ...undoSnapshot });
    setUndoSnapshot(null);
    setUndoCountdown(0);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (undoCountdownRef.current) clearInterval(undoCountdownRef.current);
  };

  const startUndoTimer = (snapshot: Record<string, HistoryEntry>) => {
    setUndoSnapshot(snapshot);
    let secs = UNDO_TIMEOUT_MS / 1000;
    setUndoCountdown(secs);
    if (undoCountdownRef.current) clearInterval(undoCountdownRef.current);
    undoCountdownRef.current = setInterval(() => {
      secs -= 1;
      setUndoCountdown(secs);
      if (secs <= 0) {
        clearInterval(undoCountdownRef.current!);
        setUndoSnapshot(null);
      }
    }, 1000);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => {
      setUndoSnapshot(null);
      setUndoCountdown(0);
    }, UNDO_TIMEOUT_MS);
  };

  const handleDeleteToken = (keyword: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const current = loadSafeHistory();
    startUndoTimer({ ...current });
    delete current[keyword];
    saveHistory(current);
    setHistory({ ...current });
    if (selectedKey === keyword) setSelectedKey(null);
  };

  const handleClear = () => {
    startUndoTimer(loadSafeHistory());
    localStorage.removeItem(HISTORY_KEY);
    setHistory({});
    setSelectedKey(null);
  };

  // ── Card click: load into TokenPanel instead of opening DexScreener
  const handleCardClick = (entry: HistoryEntry) => {
    setSelectedKey(entry.keyword);

    if (onSelectMeme) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meme: any = {
        keyword: entry.tokenSymbol || entry.keyword,
        score: entry.currentMcap || 0,
        posts: 1,
        source: entry.platforms?.join(", ") || "history",
        hasTicker: !!entry.contractAddress,
        crossPlatforms: entry.platforms?.length || 1,
        isNewCoin: false,
        ageLabel: undefined,
        mcap: entry.currentMcap || entry.initialMcap,
        platforms: entry.platforms,
        contractAddress: entry.contractAddress,
        celebMention: entry.celebMention,
        aiContext: entry.aiContext,
      };
      onSelectMeme(meme);
    }
  };

  const runRefresh = useCallback(async (h: Record<string, HistoryEntry>) => {
    const entries = Object.values(h).filter((e) => e.contractAddress);
    if (!entries.length) return h;
    setRefreshing(true);
    setUpdatingKeys(new Set(entries.map((e) => e.keyword)));
    const updated = { ...h };

    await Promise.all(
      entries.map(async (entry) => {
        try {
          const mcap = await fetchCurrentMcap(entry.contractAddress!);
          if (!mcap || mcap <= 0) return;
          const now = Date.now();
          const e: HistoryEntry = {
            ...updated[entry.keyword],
            snapshots: safeSnapshots(updated[entry.keyword].snapshots),
          };
          e.currentMcap = mcap;
          e.lastChecked = now;
          if (mcap > e.peakMcap) e.peakMcap = mcap;
          const snaps = e.snapshots;
          const lastSnap = snaps[snaps.length - 1];
          if (!lastSnap) {
            if (e.initialMcap === 0) e.initialMcap = mcap;
            e.snapshots = [{ ts: now, mcap }];
          } else {
            const timeDiff = now - lastSnap.ts;
            const mcapChange =
              Math.abs(mcap - lastSnap.mcap) / (lastSnap.mcap || 1);
            if (timeDiff > 1_800_000 || mcapChange > 0.05) {
              e.snapshots = [...snaps, { ts: now, mcap }];
              if (e.snapshots.length > 48) e.snapshots.shift();
            }
          }
          updated[entry.keyword] = e;
        } catch {
          /* skip */
        }
      }),
    );

    saveHistory(updated);
    setHistory({ ...updated });
    setRefreshing(false);
    setUpdatingKeys(new Set());
    setLastRefreshed(new Date().toLocaleTimeString());
    return updated;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const schedule = () => {
      let secs = AUTO_REFRESH_MS / 1000;
      setNextRefreshIn(secs);
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        secs -= 1;
        if (!cancelled) setNextRefreshIn(Math.max(secs, 0));
      }, 1000);
      refreshTimerRef.current = setTimeout(async () => {
        if (cancelled) return;
        const h = loadSafeHistory();
        await runRefresh(h);
        if (!cancelled) schedule();
      }, AUTO_REFRESH_MS);
    };
    schedule();
    return () => {
      cancelled = true;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [runRefresh]);

  const historyList = Object.values(history).sort(
    (a, b) =>
      calcX(b.initialMcap, b.peakMcap) - calcX(a.initialMcap, a.peakMcap),
  );

  const winners = historyList.filter(
    (e) => calcX(e.initialMcap, e.peakMcap) >= 2,
  );
  const bestX = historyList.reduce(
    (b, e) => Math.max(b, calcX(e.initialMcap, e.peakMcap)),
    0,
  );
  const bestToken = historyList.find(
    (e) => calcX(e.initialMcap, e.peakMcap) === bestX,
  );
  const takeProfitAlerts = historyList.filter(
    (e) =>
      calcX(e.initialMcap, e.currentMcap) >= 2 &&
      !dismissedAlerts.has(e.keyword),
  );

  return (
    <div
      style={{
        background: "#050505",
        border: "1px solid #111",
        borderRadius: 8,
        overflow: "hidden",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @keyframes dot-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes alert-glow { 0%,100%{box-shadow:0 0 8px #ffd70022} 50%{box-shadow:0 0 18px #ffd70055} }
        .wc { cursor: pointer; transition: background 0.1s; position: relative; }
        .wc:hover { background: #0a0a0a !important; }
        .wc-del { opacity: 0; transition: opacity 0.12s; }
        .wc:hover .wc-del { opacity: 1; }
        .tp-badge { animation: alert-glow 2s ease-in-out infinite; }
      `}</style>

      {/* ── HEADER */}
      <div
        style={{
          background: "#030303",
          borderBottom: "1px solid #111",
          padding: "11px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          gap: 8,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
        >
          <span
            style={{
              color: "#e8490f",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.2em",
              ...MONO,
            }}
          >
            WIN TRACKER
          </span>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: refreshing ? "#ffaa00" : "#00c47a",
              boxShadow: `0 0 5px ${refreshing ? "#ffaa00" : "#00c47a"}88`,
              display: "inline-block",
              animation: "dot-pulse 2s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
          {takeProfitAlerts.length > 0 && (
            <span
              className="tp-badge"
              style={{
                fontSize: 9,
                color: "#ffd700",
                border: "1px solid #ffd70033",
                padding: "2px 6px",
                borderRadius: 3,
                ...MONO,
                background: "#ffd7000f",
                letterSpacing: "0.08em",
              }}
            >
              💰 {takeProfitAlerts.length}× TAKE PROFIT
            </span>
          )}
          <span
            style={{ color: "#1c1c1c", fontSize: 9, ...MONO, flexShrink: 0 }}
          >
            {refreshing ? "refreshing..." : `↻ ${nextRefreshIn}s`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          <button
            onClick={() => runRefresh(loadSafeHistory())}
            disabled={refreshing}
            style={{
              background: "#0a1a0a",
              border: "1px solid #00c47a1a",
              color: refreshing ? "#1a1a1a" : "#00c47a",
              fontSize: 9,
              ...MONO,
              padding: "4px 10px",
              borderRadius: 3,
              cursor: "pointer",
              letterSpacing: "0.1em",
            }}
          >
            {refreshing ? "···" : "↻ NOW"}
          </button>
          <button
            onClick={handleClear}
            style={{
              background: "transparent",
              border: "1px solid #161616",
              color: "#2a2a2a",
              fontSize: 9,
              ...MONO,
              padding: "4px 9px",
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            CLR
          </button>
        </div>
      </div>

      {/* ── STATS ROW */}
      {historyList.length > 0 && (
        <div
          style={{
            background: "#030303",
            borderBottom: "1px solid #0d0d0d",
            padding: "10px 14px",
            display: "flex",
            gap: 0,
            flexShrink: 0,
          }}
        >
          {[
            {
              label: "TRACKED",
              value: historyList.length.toString(),
              color: "#e8490f",
            },
            {
              label: "2X+ WINS",
              value: winners.length.toString(),
              color: "#00c47a",
            },
            {
              label: "BEST",
              value:
                bestX >= 1
                  ? `${bestX >= 10 ? bestX.toFixed(1) : bestX.toFixed(2)}x`
                  : "—",
              color: "#ffd700",
              sub:
                bestToken && bestX >= 1.5
                  ? `$${(bestToken.tokenSymbol || bestToken.keyword).toUpperCase()}`
                  : undefined,
            },
            { label: "REFRESH", value: lastRefreshed || "—", color: "#333" },
          ].map((stat, i) => (
            <div
              key={i}
              style={{
                flex: i === 3 ? 1 : "none",
                minWidth: i === 3 ? 0 : 62,
                paddingRight: 16,
              }}
            >
              <div
                style={{
                  color: "#1e1e1e",
                  fontSize: 7,
                  letterSpacing: "0.14em",
                  ...MONO,
                  marginBottom: 3,
                }}
              >
                {stat.label}
              </div>
              <div
                style={{
                  color: stat.color,
                  fontSize: i === 3 ? 10 : 18,
                  fontWeight: i === 3 ? 500 : 900,
                  ...MONO,
                  lineHeight: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap" as const,
                }}
              >
                {stat.value}
              </div>
              {stat.sub && (
                <div
                  style={{
                    color: "#ffd70044",
                    fontSize: 7,
                    ...MONO,
                    marginTop: 2,
                  }}
                >
                  {stat.sub}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── UNDO TOAST */}
      {undoSnapshot && undoCountdown > 0 && (
        <div
          style={{
            background: "#0e0800",
            borderBottom: "1px solid #e8490f22",
            padding: "9px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div>
            <div
              style={{
                color: "#e8490f",
                fontSize: 10,
                fontWeight: 700,
                ...MONO,
                letterSpacing: "0.1em",
              }}
            >
              CLEARED — undo in {undoCountdown}s
            </div>
            <div
              style={{
                height: 2,
                background: "#1a1a1a",
                borderRadius: 1,
                marginTop: 5,
                width: 120,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(undoCountdown / (UNDO_TIMEOUT_MS / 1000)) * 100}%`,
                  background: "#e8490f",
                  borderRadius: 1,
                  transition: "width 1s linear",
                }}
              />
            </div>
          </div>
          <button
            onClick={handleUndo}
            style={{
              background: "#e8490f",
              border: "none",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              ...MONO,
              padding: "6px 14px",
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            ↩ UNDO
          </button>
        </div>
      )}

      {/* ── EMPTY STATE */}
      {historyList.length === 0 && !undoSnapshot && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 24,
          }}
        >
          <div
            style={{
              color: "#0e0e0e",
              fontSize: 28,
              fontWeight: 900,
              letterSpacing: "0.4em",
              ...MONO,
            }}
          >
            WRAITH
          </div>
          <div
            style={{
              color: "#1a1a1a",
              fontSize: 10,
              letterSpacing: "0.2em",
              ...MONO,
            }}
          >
            NO TRACKED TOKENS
          </div>
          <div
            style={{
              color: "#141414",
              fontSize: 9,
              ...MONO,
              textAlign: "center",
              maxWidth: 160,
              lineHeight: 1.6,
            }}
          >
            Tokens with on-chain mcap data are tracked automatically on each
            scan
          </div>
        </div>
      )}

      {/* ── TOKEN CARDS */}
      <div style={{ flex: 1, overflowY: "auto" as const }}>
        {historyList.map((entry) => {
          const safeSnaps = safeSnapshots(entry.snapshots);
          const xNow = calcX(entry.initialMcap, entry.currentMcap);
          const xPeak = calcX(entry.initialMcap, entry.peakMcap);
          const isMega = xPeak >= 5;
          const isWin = xPeak >= 2;
          const isDead = xNow < 0.3;
          const hasDumped = xNow < 0.7 && xPeak >= 1.5;
          const isCeleb = !!entry.celebMention;
          const isUpdating = updatingKeys.has(entry.keyword);
          const showTP = xNow >= 2 && !dismissedAlerts.has(entry.keyword);
          const isSelected = selectedKey === entry.keyword;

          const accentColor = isMega
            ? "#ffd700"
            : isWin
              ? "#00c47a"
              : xNow >= 1.2
                ? "#ffaa00"
                : isDead
                  ? "#ff4455"
                  : "#1e1e1e";
          const dropFromPeak =
            xPeak > 0
              ? ((entry.peakMcap - entry.currentMcap) / entry.peakMcap) * 100
              : 0;

          const displaySymbol = (
            entry.tokenSymbol || entry.keyword
          ).toUpperCase();
          const displayName =
            entry.displayName &&
            entry.displayName.toLowerCase() !== entry.keyword.toLowerCase()
              ? entry.displayName
              : null;

          return (
            <div
              key={entry.keyword}
              className="wc"
              onClick={() => handleCardClick(entry)}
              style={{
                borderBottom: "1px solid #0a0a0a",
                borderTop: "none",
                borderRight: "none",
                borderLeft: `2px solid ${isSelected ? (isMega ? "#ffd700" : "#e8490f") : accentColor}`,
                background: isSelected ? "#0d0300" : "#050505",
              }}
            >
              {/* Take-profit banner */}
              {showTP && (
                <div
                  style={{
                    borderBottom: "1px solid #ffd70018",
                    padding: "7px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "#0e0900",
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        color: "#ffd700",
                        fontSize: 9,
                        fontWeight: 900,
                        letterSpacing: "0.12em",
                        ...MONO,
                      }}
                    >
                      {xNow >= 5 ? "🚨 TAKE PROFIT — " : "💰 TAKE PROFIT — "}
                      {xNow >= 10
                        ? `${xNow.toFixed(1)}x`
                        : `${xNow.toFixed(2)}x`}
                    </div>
                    <div
                      style={{
                        color: "#ffd70044",
                        fontSize: 8,
                        ...MONO,
                        marginTop: 2,
                      }}
                    >
                      spotted {fmtMcap(entry.initialMcap)} → now{" "}
                      {fmtMcap(entry.currentMcap)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                    {entry.contractAddress && (
                      <a
                        href={`https://dexscreener.com/solana/${entry.contractAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ textDecoration: "none" }}
                      >
                        <button
                          style={{
                            background: "#00c47a",
                            border: "none",
                            color: "#000",
                            fontSize: 9,
                            fontWeight: 900,
                            ...MONO,
                            padding: "5px 10px",
                            borderRadius: 3,
                            cursor: "pointer",
                            letterSpacing: "0.1em",
                          }}
                        >
                          SELL↗
                        </button>
                      </a>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDismissedAlerts(
                          (prev) => new Set([...prev, entry.keyword]),
                        );
                      }}
                      style={{
                        background: "transparent",
                        border: "1px solid #ffd70022",
                        color: "#ffd70055",
                        fontSize: 9,
                        ...MONO,
                        padding: "5px 8px",
                        borderRadius: 3,
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Card body */}
              <div
                style={{
                  padding: "11px 12px",
                  opacity: isUpdating ? 0.5 : 1,
                  transition: "opacity 0.3s",
                }}
              >
                {/* Row 1: avatar + name + x badge */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <TokenAvatar
                    imageUrl={entry.tokenImageUrl}
                    symbol={displaySymbol}
                    size={40}
                  />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        flexWrap: "wrap" as const,
                        marginBottom: 3,
                      }}
                    >
                      <span
                        style={{
                          color: isMega
                            ? "#ffd700"
                            : isWin
                              ? "#00c47a"
                              : "#c0c0c0",
                          fontSize: 15,
                          fontWeight: 900,
                          ...MONO,
                          letterSpacing: "0.04em",
                        }}
                      >
                        ${displaySymbol}
                      </span>
                      {displayName && (
                        <span
                          style={{
                            color: "#2a2a2a",
                            fontSize: 9,
                            ...MONO,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap" as const,
                            maxWidth: 100,
                          }}
                        >
                          {displayName}
                        </span>
                      )}
                      {isMega && (
                        <span
                          style={{
                            fontSize: 8,
                            color: "#ffd700",
                            border: "1px solid #ffd70033",
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                            background: "#ffd7001a",
                            letterSpacing: "0.1em",
                          }}
                        >
                          🚀 MEGA
                        </span>
                      )}
                      {!isMega && isWin && (
                        <span
                          style={{
                            fontSize: 8,
                            color: "#00c47a",
                            border: "1px solid #00c47a22",
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                        >
                          ✓ WIN
                        </span>
                      )}
                      {hasDumped && (
                        <span
                          style={{
                            fontSize: 8,
                            color: "#ff6644",
                            border: "1px solid #ff664422",
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                        >
                          ↓ {dropFromPeak.toFixed(0)}%
                        </span>
                      )}
                      {isDead && !hasDumped && (
                        <span
                          style={{
                            fontSize: 8,
                            color: "#ff4455",
                            border: "1px solid #ff445522",
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                        >
                          DEAD
                        </span>
                      )}
                      {isCeleb && (
                        <span
                          style={{
                            fontSize: 8,
                            color: "#ffd700",
                            border: "1px solid #ffd70022",
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                        >
                          ⭐ {entry.celebMention?.split(" ")[0]}
                        </span>
                      )}
                    </div>

                    {entry.aiContext && (
                      <div
                        style={{
                          color: "#252525",
                          fontSize: 9,
                          ...MONO,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap" as const,
                          marginBottom: 4,
                          maxWidth: "95%",
                        }}
                      >
                        {entry.aiContext.slice(0, 55)}
                      </div>
                    )}

                    {/* Mcap journey */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap" as const,
                      }}
                    >
                      {[
                        {
                          label: "IN",
                          value: fmtMcap(entry.initialMcap),
                          color: "#333",
                        },
                        null,
                        {
                          label: "NOW",
                          value: isUpdating
                            ? "···"
                            : fmtMcap(entry.currentMcap),
                          color: isUpdating ? "#222" : accentColor,
                        },
                        ...(entry.peakMcap > entry.currentMcap * 1.1
                          ? [
                              null,
                              {
                                label: "PEAK",
                                value: fmtMcap(entry.peakMcap),
                                color: "#ffd70066",
                              },
                            ]
                          : []),
                      ].map((item, i) => {
                        if (item === null)
                          return (
                            <span
                              key={i}
                              style={{
                                color: "#161616",
                                fontSize: 10,
                                ...MONO,
                              }}
                            >
                              →
                            </span>
                          );
                        return (
                          <div
                            key={i}
                            style={{
                              background: "#0a0a0a",
                              border: "1px solid #141414",
                              borderRadius: 3,
                              padding: "3px 7px",
                            }}
                          >
                            <div
                              style={{
                                color: "#1c1c1c",
                                fontSize: 7,
                                ...MONO,
                                marginBottom: 1,
                                letterSpacing: "0.1em",
                              }}
                            >
                              {item.label}
                            </div>
                            <div
                              style={{
                                color: item.color,
                                fontSize: 11,
                                fontWeight: 700,
                                ...MONO,
                              }}
                            >
                              {item.value}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <XBadge xNow={xNow} xPeak={xPeak} isUpdating={isUpdating} />
                </div>

                {/* Sparkline */}
                {safeSnaps.length >= 2 && (
                  <div style={{ marginBottom: 8, marginLeft: 50 }}>
                    <Sparkline snapshots={safeSnaps} />
                  </div>
                )}

                {/* Footer row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    flexWrap: "wrap" as const,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 5 }}
                  >
                    <span style={{ color: "#1c1c1c", fontSize: 8, ...MONO }}>
                      {fmtTimeAgo(entry.seenAt)}
                    </span>
                    {entry.platforms.slice(0, 2).map((p) => (
                      <span
                        key={p}
                        style={{
                          fontSize: 8,
                          color: "#252525",
                          border: "1px solid #181818",
                          padding: "1px 5px",
                          borderRadius: 2,
                          ...MONO,
                        }}
                      >
                        {p.toUpperCase()}
                      </span>
                    ))}
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 5 }}
                  >
                    <span
                      style={{
                        color: xNow >= 1 ? "#00c47a33" : "#ff445533",
                        fontSize: 9,
                        fontWeight: 700,
                        ...MONO,
                      }}
                    >
                      {xNow >= 1
                        ? `+${((xNow - 1) * 100).toFixed(0)}%`
                        : `-${((1 - xNow) * 100).toFixed(0)}%`}
                    </span>
                    {entry.contractAddress && (
                      <>
                        <a
                          href={`https://dexscreener.com/solana/${entry.contractAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: 8,
                            color: "#00b4d8",
                            border: "1px solid #00b4d822",
                            padding: "2px 6px",
                            borderRadius: 2,
                            textDecoration: "none",
                            ...MONO,
                          }}
                        >
                          DEX↗
                        </a>
                        <a
                          href={`https://pump.fun/${entry.contractAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: 8,
                            color: "#a855f7",
                            border: "1px solid #a855f722",
                            padding: "2px 6px",
                            borderRadius: 2,
                            textDecoration: "none",
                            ...MONO,
                          }}
                        >
                          PUMP↗
                        </a>
                      </>
                    )}
                    <button
                      className="wc-del"
                      onClick={(e) => handleDeleteToken(entry.keyword, e)}
                      style={{
                        background: "transparent",
                        border: "1px solid #141414",
                        color: "#222",
                        fontSize: 8,
                        width: 18,
                        height: 18,
                        borderRadius: 2,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        ...MONO,
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "#1a0000";
                        (e.currentTarget as HTMLElement).style.borderColor =
                          "#ff445533";
                        (e.currentTarget as HTMLElement).style.color =
                          "#ff4455";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "transparent";
                        (e.currentTarget as HTMLElement).style.borderColor =
                          "#141414";
                        (e.currentTarget as HTMLElement).style.color = "#222";
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
