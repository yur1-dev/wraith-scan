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
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};
const AUTO_REFRESH_MS = 60_000;
const UNDO_TIMEOUT_MS = 10_000;
const BOUGHT_KEY = "wraith_bought_keys";

// ─── DEAD TOKEN PURGE CONSTANTS ───────────────────────────────────────────────
const DEAD_THRESHOLD = 0.1; // lost 90%+ from initial = dead
const DEAD_MIN_AGE_MS = 2 * 60 * 60 * 1000; // must be at least 2h old to purge
const MAX_HISTORY_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days max

const C = {
  primary: "#f0f0f0",
  secondary: "#aaaaaa",
  muted: "#777777",
  dim: "#555555",
  label: "#666666",
  orange: "#e8490f",
  green: "#00c47a",
  yellow: "#ffd700",
  purple: "#a855f7",
  blue: "#00b4d8",
  red: "#ff4444",
  amber: "#ffaa00",
  bg: "#050505",
  bgCard: "#0d0d0d",
  border: "#1a1a1a",
};

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
    const out: Record<string, HistoryEntry> = {};
    for (const [k, v] of Object.entries(raw)) {
      const e = safeEntry(k, v);
      if (e) out[k] = e;
    }
    return out;
  } catch {
    return {};
  }
}
function loadBoughtKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(BOUGHT_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveBoughtKeys(keys: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BOUGHT_KEY, JSON.stringify([...keys]));
  } catch {}
}
function isGarbage(kw: string): boolean {
  if (kw.length > 14) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{10,}$/.test(kw)) return true;
  if (/\d{4,}/.test(kw)) return true;
  if (kw.length >= 8 && (kw.match(/[aeiou]/gi) || []).length === 0) return true;
  return false;
}

// ─── DEAD TOKEN CHECK ─────────────────────────────────────────────────────────
function isDeadEntry(e: HistoryEntry, nowMs: number): boolean {
  const age = nowMs - e.seenAt;
  // Too old
  if (age > MAX_HISTORY_AGE_MS) return true;
  // Lost 90%+ and been around for at least 2h
  if (e.initialMcap > 0 && age > DEAD_MIN_AGE_MS) {
    const xNow = e.currentMcap / e.initialMcap;
    if (xNow < DEAD_THRESHOLD) return true;
  }
  return false;
}

function fmtMcap(n: number): string {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function calcX(init: number, cur: number): number {
  return !init || init === 0 ? 0 : cur / init;
}

// ── Avatar
function Avatar({
  imageUrl,
  symbol,
  size = 40,
}: {
  imageUrl?: string;
  symbol: string;
  size?: number;
}) {
  const [err, setErr] = useState(false);
  const letter = (symbol || "?").charAt(0).toUpperCase();
  if (imageUrl && !err)
    return (
      <img
        src={imageUrl}
        alt={symbol}
        width={size}
        height={size}
        onError={() => setErr(true)}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          border: `1px solid ${C.border}`,
        }}
      />
    );
  const palette = [C.orange, C.purple, C.blue, C.green, C.yellow, "#ff4500"];
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

// ── Sparkline
function Spark({ snaps }: { snaps: McapSnapshot[] }) {
  const safe = safeSnapshots(snaps);
  if (safe.length < 2) return null;
  const vals = safe.map((s) => s.mcap),
    min = Math.min(...vals),
    max = Math.max(...vals),
    range = max - min || 1;
  const W = 72,
    H = 24;
  const pts = safe
    .map(
      (s, i) =>
        `${((i / (safe.length - 1)) * W).toFixed(1)},${(H - ((s.mcap - min) / range) * (H - 2) - 1).toFixed(1)}`,
    )
    .join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  const col = up ? C.green : C.red;
  return (
    <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={`sg${up ? "u" : "d"}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.18" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${H} ${pts} ${W},${H}`}
        fill={`url(#sg${up ? "u" : "d"})`}
      />
      <polyline
        points={pts}
        fill="none"
        stroke={col}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── X Badge
function XBadge({
  xNow,
  xPeak,
  updating,
}: {
  xNow: number;
  xPeak: number;
  updating: boolean;
}) {
  const isMega = xPeak >= 5,
    isWin = xPeak >= 2,
    isDead = xNow < 0.3;
  const col = isMega
    ? C.yellow
    : isWin
      ? C.green
      : xNow >= 1.2
        ? C.amber
        : isDead
          ? C.red
          : C.dim;
  const str = updating
    ? null
    : xNow >= 0.01
      ? xNow >= 100
        ? `${xNow.toFixed(0)}x`
        : xNow >= 10
          ? `${xNow.toFixed(1)}x`
          : `${xNow.toFixed(2)}x`
      : null;
  return (
    <div
      style={{
        flexShrink: 0,
        width: 64,
        height: 54,
        background: isMega
          ? "#120c00"
          : isWin
            ? "#001610"
            : isDead
              ? "#120000"
              : C.bgCard,
        border: `1px solid ${col}33`,
        borderRadius: 6,
        display: "flex",
        flexDirection: "column" as const,
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
      }}
    >
      <div
        style={{
          color: C.muted,
          fontSize: 7,
          letterSpacing: "0.12em",
          ...MONO,
        }}
      >
        NOW
      </div>
      <div
        style={{
          color: updating ? C.dim : col,
          fontSize: (str || "").length > 5 ? 13 : 16,
          fontWeight: 900,
          lineHeight: 1,
          ...MONO,
        }}
      >
        {updating ? "···" : str || "—"}
      </div>
      {xPeak > xNow * 1.15 && !updating && (
        <div
          style={{ color: `${C.yellow}55`, fontSize: 7, ...MONO, marginTop: 1 }}
        >
          pk {xPeak >= 10 ? xPeak.toFixed(1) : xPeak.toFixed(2)}x
        </div>
      )}
    </div>
  );
}

export default function WinsPanel({ onSelectMeme }: Props) {
  const [history, setHistory] = useState<Record<string, HistoryEntry>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [nextIn, setNextIn] = useState(AUTO_REFRESH_MS / 1000);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [updating, setUpdating] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [boughtKeys, setBoughtKeys] = useState<Set<string>>(new Set());
  const [undoSnap, setUndoSnap] = useState<Record<string, HistoryEntry> | null>(
    null,
  );
  const [undoCD, setUndoCD] = useState(0);
  const [selKey, setSelKey] = useState<string | null>(null);

  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoCD_ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const rfTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cdTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load bought keys on mount
  useEffect(() => {
    setBoughtKeys(loadBoughtKeys());
  }, []);

  // ── LOAD + AUTO-PURGE DEAD TOKENS ON MOUNT ────────────────────────────────
  useEffect(() => {
    const h = loadSafeHistory();
    const clean: Record<string, HistoryEntry> = {};
    const now = Date.now();

    for (const [k, e] of Object.entries(h)) {
      if (isGarbage(k)) continue;
      if (!e.contractAddress && e.initialMcap === 0) continue;
      if (e.initialMcap === 0 && e.currentMcap === 0 && e.peakMcap === 0)
        continue;
      // FIX: auto-purge dead/stale tokens on load
      if (isDeadEntry(e, now)) continue;
      clean[k] = e;
    }
    if (Object.keys(clean).length !== Object.keys(h).length) saveHistory(clean);
    setHistory(clean);
    backfill(clean);
  }, []);

  async function backfill(h: Record<string, HistoryEntry>) {
    const toFill = Object.values(h).filter(
      (e) => e.contractAddress && !e.tokenImageUrl,
    );
    if (!toFill.length) return;
    const upd = { ...h };
    for (let i = 0; i < toFill.length; i += 8) {
      await Promise.all(
        toFill.slice(i, i + 8).map(async (e) => {
          const meta = await fetchTokenMeta(e.contractAddress!);
          if (meta)
            upd[e.keyword] = {
              ...upd[e.keyword],
              displayName: upd[e.keyword].displayName || meta.name,
              tokenSymbol: upd[e.keyword].tokenSymbol || meta.symbol,
              tokenImageUrl: meta.imageUrl,
            };
        }),
      );
    }
    saveHistory(upd);
    setHistory({ ...upd });
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && undoSnap) doUndo();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoSnap]);

  // ── Bought / Sold tracking
  const markBought = (kw: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set([...boughtKeys, kw]);
    setBoughtKeys(next);
    saveBoughtKeys(next);
  };

  const markSold = (kw: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set([...boughtKeys].filter((k) => k !== kw));
    setBoughtKeys(next);
    saveBoughtKeys(next);
    setDismissed((p) => new Set([...p, kw]));
  };

  const doUndo = () => {
    if (!undoSnap) return;
    saveHistory(undoSnap);
    setHistory({ ...undoSnap });
    setUndoSnap(null);
    setUndoCD(0);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (undoCD_ref.current) clearInterval(undoCD_ref.current);
  };
  const startUndo = (snap: Record<string, HistoryEntry>) => {
    setUndoSnap(snap);
    let s = UNDO_TIMEOUT_MS / 1000;
    setUndoCD(s);
    if (undoCD_ref.current) clearInterval(undoCD_ref.current);
    undoCD_ref.current = setInterval(() => {
      s -= 1;
      setUndoCD(s);
      if (s <= 0) {
        clearInterval(undoCD_ref.current!);
        setUndoSnap(null);
      }
    }, 1000);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      setUndoSnap(null);
      setUndoCD(0);
    }, UNDO_TIMEOUT_MS);
  };

  const delToken = (kw: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const cur = loadSafeHistory();
    startUndo({ ...cur });
    delete cur[kw];
    saveHistory(cur);
    setHistory({ ...cur });
    if (selKey === kw) setSelKey(null);
  };
  const clearAll = () => {
    startUndo(loadSafeHistory());
    localStorage.removeItem(HISTORY_KEY);
    setHistory({});
    setSelKey(null);
  };

  const cardClick = (entry: HistoryEntry) => {
    setSelKey(entry.keyword);
    if (onSelectMeme) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m: any = {
        keyword: entry.tokenSymbol || entry.keyword,
        score: entry.currentMcap || 0,
        posts: 1,
        source: entry.platforms?.join(",") || "history",
        hasTicker: !!entry.contractAddress,
        crossPlatforms: entry.platforms?.length || 1,
        isNewCoin: false,
        mcap: entry.currentMcap || entry.initialMcap,
        platforms: entry.platforms,
        contractAddress: entry.contractAddress,
        celebMention: entry.celebMention,
        aiContext: entry.aiContext,
      };
      onSelectMeme(m);
    }
  };

  const runRefresh = useCallback(async (h: Record<string, HistoryEntry>) => {
    const entries = Object.values(h).filter((e) => e.contractAddress);
    if (!entries.length) return h;
    setRefreshing(true);
    setUpdating(new Set(entries.map((e) => e.keyword)));
    const upd = { ...h };
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const mcap = await fetchCurrentMcap(entry.contractAddress!);
          if (!mcap || mcap <= 0) return;
          const now = Date.now();
          const e: HistoryEntry = {
            ...upd[entry.keyword],
            snapshots: safeSnapshots(upd[entry.keyword].snapshots),
          };
          e.currentMcap = mcap;
          e.lastChecked = now;
          if (mcap > e.peakMcap) e.peakMcap = mcap;
          const snaps = e.snapshots,
            last = snaps[snaps.length - 1];
          if (!last) {
            if (e.initialMcap === 0) e.initialMcap = mcap;
            e.snapshots = [{ ts: now, mcap }];
          } else {
            if (
              now - last.ts > 1_800_000 ||
              Math.abs(mcap - last.mcap) / (last.mcap || 1) > 0.05
            ) {
              e.snapshots = [...snaps, { ts: now, mcap }];
              if (e.snapshots.length > 48) e.snapshots.shift();
            }
          }
          upd[entry.keyword] = e;
        } catch {
          /* skip */
        }
      }),
    );

    // FIX: auto-purge dead tokens after refresh cycle
    const nowMs = Date.now();
    for (const [k, e] of Object.entries(upd)) {
      if (isDeadEntry(e, nowMs)) {
        delete upd[k];
      }
    }

    saveHistory(upd);
    setHistory({ ...upd });
    setRefreshing(false);
    setUpdating(new Set());
    setLastAt(new Date().toLocaleTimeString());
    return upd;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const schedule = () => {
      let s = AUTO_REFRESH_MS / 1000;
      setNextIn(s);
      if (cdTimer.current) clearInterval(cdTimer.current);
      cdTimer.current = setInterval(() => {
        s -= 1;
        if (!cancelled) setNextIn(Math.max(s, 0));
      }, 1000);
      rfTimer.current = setTimeout(async () => {
        if (cancelled) return;
        await runRefresh(loadSafeHistory());
        if (!cancelled) schedule();
      }, AUTO_REFRESH_MS);
    };
    schedule();
    return () => {
      cancelled = true;
      if (rfTimer.current) clearTimeout(rfTimer.current);
      if (cdTimer.current) clearInterval(cdTimer.current);
    };
  }, [runRefresh]);

  const list = Object.values(history).sort(
    (a, b) =>
      calcX(b.initialMcap, b.peakMcap) - calcX(a.initialMcap, a.peakMcap),
  );
  const winners = list.filter((e) => calcX(e.initialMcap, e.peakMcap) >= 2);
  const bestX = list.reduce(
    (b, e) => Math.max(b, calcX(e.initialMcap, e.peakMcap)),
    0,
  );
  const bestTok = list.find((e) => calcX(e.initialMcap, e.peakMcap) === bestX);

  // TP alerts only for tokens you've actually bought
  const tpAlerts = list.filter(
    (e) =>
      calcX(e.initialMcap, e.currentMcap) >= 2 &&
      boughtKeys.has(e.keyword) &&
      !dismissed.has(e.keyword),
  );

  return (
    <div
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        overflow: "hidden",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @keyframes dpulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes aglow{0%,100%{box-shadow:0 0 8px #ffd70022}50%{box-shadow:0 0 18px #ffd70055}}
        @keyframes bglow{0%,100%{box-shadow:0 0 8px #00b4d822}50%{box-shadow:0 0 18px #00b4d855}}
        .wc{cursor:pointer;transition:background .1s;position:relative}
        .wc:hover{background:#0a0a0a!important}
        .wdel{opacity:0;transition:opacity .12s}
        .wc:hover .wdel{opacity:1}
        .tpb{animation:aglow 2s ease-in-out infinite}
        .bpb{animation:bglow 2s ease-in-out infinite}
      `}</style>

      {/* HEADER */}
      <div
        style={{
          background: "#030303",
          borderBottom: `1px solid ${C.border}`,
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
              color: C.orange,
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
              flexShrink: 0,
              background: refreshing ? C.amber : C.green,
              boxShadow: `0 0 5px ${refreshing ? C.amber : C.green}88`,
              display: "inline-block",
              animation: "dpulse 2s ease-in-out infinite",
            }}
          />
          {tpAlerts.length > 0 && (
            <span
              className="tpb"
              style={{
                fontSize: 9,
                color: C.yellow,
                border: `1px solid ${C.yellow}33`,
                padding: "2px 6px",
                borderRadius: 3,
                ...MONO,
                background: `${C.yellow}0f`,
                letterSpacing: "0.08em",
              }}
            >
              💰 {tpAlerts.length}× TAKE PROFIT
            </span>
          )}
          <span style={{ color: C.dim, fontSize: 9, ...MONO, flexShrink: 0 }}>
            {refreshing ? "refreshing..." : `↻ ${nextIn}s`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          <button
            onClick={() => runRefresh(loadSafeHistory())}
            disabled={refreshing}
            style={{
              background: "#0a1a0a",
              border: `1px solid ${C.green}22`,
              color: refreshing ? C.dim : C.green,
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
            onClick={clearAll}
            style={{
              background: "transparent",
              border: `1px solid ${C.border}`,
              color: C.muted,
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

      {/* STATS */}
      {list.length > 0 && (
        <div
          style={{
            background: "#030303",
            borderBottom: `1px solid ${C.bgCard}`,
            padding: "10px 14px",
            display: "flex",
            gap: 0,
            flexShrink: 0,
          }}
        >
          {[
            {
              label: "TRACKED",
              value: list.length.toString(),
              color: C.orange,
            },
            {
              label: "2X+ WINS",
              value: winners.length.toString(),
              color: C.green,
            },
            {
              label: "BEST",
              value:
                bestX >= 1
                  ? bestX >= 10
                    ? `${bestX.toFixed(1)}x`
                    : `${bestX.toFixed(2)}x`
                  : "—",
              color: C.yellow,
              sub:
                bestTok && bestX >= 1.5
                  ? `$${(bestTok.tokenSymbol || bestTok.keyword).toUpperCase()}`
                  : undefined,
            },
            { label: "REFRESH", value: lastAt || "—", color: C.muted },
          ].map((s, i) => (
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
                  color: C.label,
                  fontSize: 7,
                  letterSpacing: "0.14em",
                  ...MONO,
                  marginBottom: 3,
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  color: s.color,
                  fontSize: i === 3 ? 10 : 18,
                  fontWeight: i === 3 ? 500 : 900,
                  ...MONO,
                  lineHeight: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap" as const,
                }}
              >
                {s.value}
              </div>
              {(s as { sub?: string }).sub && (
                <div
                  style={{
                    color: `${C.yellow}66`,
                    fontSize: 7,
                    ...MONO,
                    marginTop: 2,
                  }}
                >
                  {(s as { sub?: string }).sub}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* UNDO */}
      {undoSnap && undoCD > 0 && (
        <div
          style={{
            background: "#0e0800",
            borderBottom: `1px solid ${C.orange}22`,
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
                color: C.orange,
                fontSize: 10,
                fontWeight: 700,
                ...MONO,
                letterSpacing: "0.1em",
              }}
            >
              CLEARED — undo in {undoCD}s
            </div>
            <div
              style={{
                height: 2,
                background: C.border,
                borderRadius: 1,
                marginTop: 5,
                width: 120,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(undoCD / (UNDO_TIMEOUT_MS / 1000)) * 100}%`,
                  background: C.orange,
                  borderRadius: 1,
                  transition: "width 1s linear",
                }}
              />
            </div>
          </div>
          <button
            onClick={doUndo}
            style={{
              background: C.orange,
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

      {/* EMPTY */}
      {list.length === 0 && !undoSnap && (
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
              color: "#111",
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
              color: C.dim,
              fontSize: 10,
              letterSpacing: "0.2em",
              ...MONO,
            }}
          >
            NO TRACKED TOKENS
          </div>
          <div
            style={{
              color: C.dim,
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

      {/* CARDS */}
      <div style={{ flex: 1, overflowY: "auto" as const }}>
        {list.map((entry) => {
          const snaps = safeSnapshots(entry.snapshots);
          const xNow = calcX(entry.initialMcap, entry.currentMcap);
          const xPeak = calcX(entry.initialMcap, entry.peakMcap);
          const isMega = xPeak >= 5,
            isWin = xPeak >= 2,
            isDead = xNow < 0.3;
          const hasDumped = xNow < 0.7 && xPeak >= 1.5;
          const isCeleb = !!entry.celebMention;
          const isUpd = updating.has(entry.keyword);
          const isSel = selKey === entry.keyword;
          const hasBought = boughtKeys.has(entry.keyword);

          // TAKE PROFIT: only show if you actually marked it as bought
          const showTP =
            xNow >= 2 && hasBought && !dismissed.has(entry.keyword);

          // BUY PROMPT: spotted but not bought yet, still low mcap
          const showBuyPrompt =
            !hasBought &&
            !dismissed.has(entry.keyword) &&
            (entry.currentMcap || 0) > 0 &&
            (entry.currentMcap || 0) < 500_000;

          const accent = isMega
            ? C.yellow
            : isWin
              ? C.green
              : xNow >= 1.2
                ? C.amber
                : isDead
                  ? C.red
                  : C.border;
          const drop =
            xPeak > 0
              ? ((entry.peakMcap - entry.currentMcap) / entry.peakMcap) * 100
              : 0;
          const sym = (entry.tokenSymbol || entry.keyword).toUpperCase();
          const dispName =
            entry.displayName &&
            entry.displayName.toLowerCase() !== entry.keyword.toLowerCase()
              ? entry.displayName
              : null;

          return (
            <div
              key={entry.keyword}
              className="wc"
              onClick={() => cardClick(entry)}
              style={{
                borderBottom: `1px solid ${C.bgCard}`,
                borderTop: "none",
                borderRight: "none",
                borderLeft: `2px solid ${isSel ? (isMega ? C.yellow : C.orange) : accent}`,
                background: isSel ? "#0d0300" : C.bg,
              }}
            >
              {/* ── TAKE PROFIT BANNER */}
              {showTP && (
                <div
                  style={{
                    borderBottom: `1px solid ${C.yellow}22`,
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
                        color: C.yellow,
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
                        color: `${C.yellow}77`,
                        fontSize: 8,
                        ...MONO,
                        marginTop: 2,
                      }}
                    >
                      bought at ~{fmtMcap(entry.initialMcap)} → now{" "}
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
                          onClick={(e) => markSold(entry.keyword, e)}
                          style={{
                            background: C.green,
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
                        setDismissed((p) => new Set([...p, entry.keyword]));
                      }}
                      style={{
                        background: "transparent",
                        border: `1px solid ${C.yellow}22`,
                        color: `${C.yellow}77`,
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

              {/* ── BUY PROMPT BANNER */}
              {showBuyPrompt && (
                <div
                  className="bpb"
                  style={{
                    borderBottom: `1px solid ${C.blue}22`,
                    padding: "7px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "#03090e",
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        color: C.blue,
                        fontSize: 9,
                        fontWeight: 900,
                        letterSpacing: "0.12em",
                        ...MONO,
                      }}
                    >
                      ⚡ SPOTTED — {fmtMcap(entry.currentMcap)}
                    </div>
                    <div
                      style={{
                        color: `${C.blue}77`,
                        fontSize: 8,
                        ...MONO,
                        marginTop: 2,
                      }}
                    >
                      tap BOUGHT to start tracking profit
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
                            background: "transparent",
                            border: `1px solid ${C.blue}44`,
                            color: C.blue,
                            fontSize: 9,
                            fontWeight: 700,
                            ...MONO,
                            padding: "5px 9px",
                            borderRadius: 3,
                            cursor: "pointer",
                            letterSpacing: "0.08em",
                          }}
                        >
                          VIEW↗
                        </button>
                      </a>
                    )}
                    <button
                      onClick={(e) => markBought(entry.keyword, e)}
                      style={{
                        background: C.orange,
                        border: "none",
                        color: "#fff",
                        fontSize: 9,
                        fontWeight: 900,
                        ...MONO,
                        padding: "5px 10px",
                        borderRadius: 3,
                        cursor: "pointer",
                        letterSpacing: "0.08em",
                      }}
                    >
                      ✓ BOUGHT
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDismissed((p) => new Set([...p, entry.keyword]));
                      }}
                      style={{
                        background: "transparent",
                        border: `1px solid ${C.border}`,
                        color: C.dim,
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

              {/* BODY */}
              <div
                style={{
                  padding: "11px 12px",
                  opacity: isUpd ? 0.5 : 1,
                  transition: "opacity .3s",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <Avatar
                    imageUrl={entry.tokenImageUrl}
                    symbol={sym}
                    size={40}
                  />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Name badges */}
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
                            ? C.yellow
                            : isWin
                              ? C.green
                              : C.primary,
                          fontSize: 15,
                          fontWeight: 900,
                          ...MONO,
                          letterSpacing: "0.04em",
                        }}
                      >
                        ${sym}
                      </span>
                      {dispName && (
                        <span
                          style={{
                            color: C.muted,
                            fontSize: 9,
                            ...MONO,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap" as const,
                            maxWidth: 100,
                          }}
                        >
                          {dispName}
                        </span>
                      )}
                      {hasBought && (
                        <span
                          style={{
                            fontSize: 8,
                            color: C.green,
                            border: `1px solid ${C.green}33`,
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                            background: `${C.green}0f`,
                          }}
                        >
                          ✓ IN
                        </span>
                      )}
                      {isMega && (
                        <span
                          style={{
                            fontSize: 8,
                            color: C.yellow,
                            border: `1px solid ${C.yellow}33`,
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                            background: `${C.yellow}1a`,
                          }}
                        >
                          🚀 MEGA
                        </span>
                      )}
                      {!isMega && isWin && (
                        <span
                          style={{
                            fontSize: 8,
                            color: C.green,
                            border: `1px solid ${C.green}22`,
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
                          ↓ {drop.toFixed(0)}%
                        </span>
                      )}
                      {isDead && !hasDumped && (
                        <span
                          style={{
                            fontSize: 8,
                            color: C.red,
                            border: `1px solid ${C.red}22`,
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
                            color: C.yellow,
                            border: `1px solid ${C.yellow}22`,
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                        >
                          ⭐ {entry.celebMention?.split(" ")[0]}
                        </span>
                      )}
                    </div>

                    {/* AI context */}
                    {entry.aiContext && (
                      <div
                        style={{
                          color: C.muted,
                          fontSize: 9,
                          ...MONO,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap" as const,
                          marginBottom: 4,
                          maxWidth: "95%",
                        }}
                      >
                        {entry.aiContext.slice(0, 60)}
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
                          label: hasBought ? "BOUGHT" : "SPOTTED",
                          value: fmtMcap(entry.initialMcap),
                          color: C.muted,
                        },
                        null,
                        {
                          label: "NOW",
                          value: isUpd ? "···" : fmtMcap(entry.currentMcap),
                          color: isUpd ? C.dim : accent,
                        },
                        ...(entry.peakMcap > entry.currentMcap * 1.1
                          ? [
                              null,
                              {
                                label: "PEAK",
                                value: fmtMcap(entry.peakMcap),
                                color: `${C.yellow}99`,
                              },
                            ]
                          : []),
                      ].map((item, i) => {
                        if (item === null)
                          return (
                            <span
                              key={i}
                              style={{ color: C.dim, fontSize: 10, ...MONO }}
                            >
                              →
                            </span>
                          );
                        return (
                          <div
                            key={i}
                            style={{
                              background: C.bgCard,
                              border: `1px solid ${C.border}`,
                              borderRadius: 3,
                              padding: "3px 7px",
                            }}
                          >
                            <div
                              style={{
                                color: C.label,
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

                  <XBadge xNow={xNow} xPeak={xPeak} updating={isUpd} />
                </div>

                {snaps.length >= 2 && (
                  <div style={{ marginBottom: 8, marginLeft: 50 }}>
                    <Spark snaps={snaps} />
                  </div>
                )}

                {/* Footer */}
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
                    <span style={{ color: C.muted, fontSize: 8, ...MONO }}>
                      {fmtAgo(entry.seenAt)}
                    </span>
                    {entry.platforms.slice(0, 2).map((p) => (
                      <span
                        key={p}
                        style={{
                          fontSize: 8,
                          color: C.dim,
                          border: `1px solid ${C.border}`,
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
                    {hasBought && (
                      <span
                        style={{
                          color: xNow >= 1 ? `${C.green}aa` : `${C.red}aa`,
                          fontSize: 9,
                          fontWeight: 700,
                          ...MONO,
                        }}
                      >
                        {xNow >= 1
                          ? `+${((xNow - 1) * 100).toFixed(0)}%`
                          : `-${((1 - xNow) * 100).toFixed(0)}%`}
                      </span>
                    )}
                    {entry.contractAddress && (
                      <>
                        <a
                          href={`https://dexscreener.com/solana/${entry.contractAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: 8,
                            color: C.blue,
                            border: `1px solid ${C.blue}33`,
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
                            color: C.purple,
                            border: `1px solid ${C.purple}33`,
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
                      onClick={(e) =>
                        hasBought
                          ? markSold(entry.keyword, e)
                          : markBought(entry.keyword, e)
                      }
                      style={{
                        background: hasBought ? `${C.green}15` : "transparent",
                        border: `1px solid ${hasBought ? C.green + "44" : C.border}`,
                        color: hasBought ? C.green : C.dim,
                        fontSize: 8,
                        ...MONO,
                        padding: "2px 7px",
                        borderRadius: 2,
                        cursor: "pointer",
                        flexShrink: 0,
                        fontWeight: hasBought ? 700 : 400,
                      }}
                      title={hasBought ? "Mark as sold" : "Mark as bought"}
                    >
                      {hasBought ? "✓ IN" : "BUY?"}
                    </button>
                    <button
                      className="wdel"
                      onClick={(e) => delToken(entry.keyword, e)}
                      style={{
                        background: "transparent",
                        border: `1px solid ${C.border}`,
                        color: C.dim,
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
                          `${C.red}44`;
                        (e.currentTarget as HTMLElement).style.color = C.red;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "transparent";
                        (e.currentTarget as HTMLElement).style.borderColor =
                          C.border;
                        (e.currentTarget as HTMLElement).style.color = C.dim;
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
