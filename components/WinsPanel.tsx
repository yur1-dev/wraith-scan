"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { MemeTrend } from "@/app/app/page";
import {
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
  peakMcapTs: number;
  currentMcap: number;
  snapshots: McapSnapshot[];
  lastChecked: number;
  tookProfitAt?: number;
  aiScore?: number;
  aiTier?: "HOT" | "WATCH" | "SKIP";
  twoXTier?: string;
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
const DISMISSED_KEY = "wraith_dismissed_keys";
const NOTIFIED_KEY = "wraith_notified_keys";
const WIN_NOTIFIED_KEY = "wraith_win_notified_keys";
const PEAK_GRACE_MS = 5 * 60 * 1000;
const DEAD_THRESHOLD = 0.1;
const DEAD_MIN_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_HISTORY_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const EARNED_MCAP_MULTIPLIER = 1.5;
const MIN_MCAP = 2_000;
const MAX_MCAP = 100_000;

const C = {
  primary: "#f0f0f0",
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
  hot: "#ff6b35",
};

// ─── SHARED SIGNAL FILTER (mirrors LiveSignalsBar passes()) ──────────────────
// A token only appears in Wins if it would have passed the live signals filter
// when it was first spotted. This prevents garbage tokens from polluting wins.
function passesSignalFilter(e: HistoryEntry): boolean {
  if (!e.contractAddress) return false;
  const mcap = e.initialMcap ?? 0;
  if (mcap > 0 && mcap < MIN_MCAP) return false;
  if (mcap > MAX_MCAP) return false;
  const platforms = Array.isArray(e.platforms) ? e.platforms : [];
  const tier = e.twoXTier ?? null;
  const aiTier = e.aiTier ?? null;
  const celeb = e.celebMention || null;
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

// ─── HELPERS ──────────────────────────────────────────────────────────────────
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
    const seenAt = typeof r.seenAt === "number" ? r.seenAt : Date.now();
    return {
      keyword: typeof r.keyword === "string" ? r.keyword : key,
      displayName:
        typeof r.displayName === "string" ? r.displayName : undefined,
      tokenSymbol:
        typeof r.tokenSymbol === "string" ? r.tokenSymbol : undefined,
      tokenImageUrl:
        typeof r.tokenImageUrl === "string" ? r.tokenImageUrl : undefined,
      seenAt,
      contractAddress:
        typeof r.contractAddress === "string" ? r.contractAddress : undefined,
      celebMention:
        typeof r.celebMention === "string" ? r.celebMention : undefined,
      aiContext: typeof r.aiContext === "string" ? r.aiContext : undefined,
      platforms: Array.isArray(r.platforms) ? (r.platforms as string[]) : [],
      initialMcap: typeof r.initialMcap === "number" ? r.initialMcap : 0,
      peakMcap: typeof r.peakMcap === "number" ? r.peakMcap : 0,
      peakMcapTs:
        typeof r.peakMcapTs === "number" && r.peakMcapTs !== seenAt
          ? r.peakMcapTs
          : 0,
      currentMcap: typeof r.currentMcap === "number" ? r.currentMcap : 0,
      snapshots: safeSnapshots(r.snapshots),
      lastChecked:
        typeof r.lastChecked === "number" ? r.lastChecked : Date.now(),
      tookProfitAt:
        typeof r.tookProfitAt === "number" ? r.tookProfitAt : undefined,
      aiScore: typeof r.aiScore === "number" ? r.aiScore : undefined,
      aiTier:
        r.aiTier === "HOT" || r.aiTier === "WATCH" || r.aiTier === "SKIP"
          ? r.aiTier
          : undefined,
      twoXTier: typeof r.twoXTier === "string" ? r.twoXTier : undefined,
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
function loadSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}
function saveSet(key: string, s: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {}
}
function isGarbage(kw: string): boolean {
  if (kw.length > 14) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{10,}$/.test(kw)) return true;
  if (/\d{4,}/.test(kw)) return true;
  if (kw.length >= 8 && (kw.match(/[aeiou]/gi) || []).length === 0) return true;
  return false;
}
function isDeadEntry(e: HistoryEntry, nowMs: number): boolean {
  const age = nowMs - e.seenAt;
  if (age > MAX_HISTORY_AGE_MS) return true;
  if (
    e.initialMcap > 0 &&
    age > DEAD_MIN_AGE_MS &&
    e.currentMcap / e.initialMcap < DEAD_THRESHOLD
  )
    return true;
  return false;
}
function purgeDead(
  h: Record<string, HistoryEntry>,
): Record<string, HistoryEntry> {
  const now = Date.now();
  const out: Record<string, HistoryEntry> = {};
  for (const [k, e] of Object.entries(h)) {
    if (!isDeadEntry(e, now)) out[k] = e;
  }
  return out;
}
function countDead(h: Record<string, HistoryEntry>): number {
  const now = Date.now();
  return Object.values(h).filter((e) => isDeadEntry(e, now)).length;
}

function isPeakEarned(e: HistoryEntry): boolean {
  if (e.peakMcapTs > e.seenAt + PEAK_GRACE_MS) return true;
  if (
    e.initialMcap > 0 &&
    e.currentMcap >= e.initialMcap * EARNED_MCAP_MULTIPLIER
  )
    return true;
  if (
    e.peakMcapTs > 0 &&
    e.initialMcap > 0 &&
    e.peakMcap >= e.initialMcap * EARNED_MCAP_MULTIPLIER
  )
    return true;
  return false;
}

function fmtMcap(n: number): string {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtAgo(ts: number, now: number): string {
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function calcX(init: number, cur: number): number {
  return !init ? 0 : cur / init;
}

// ─── SOUND ────────────────────────────────────────────────────────────────────
function playEntrySound() {
  try {
    const ctx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    )();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1200;
    osc.type = "sine";
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.01);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.22);
    setTimeout(() => ctx.close(), 500);
  } catch {
    /* silent */
  }
}

function playWinSound() {
  try {
    const ctx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    )();
    const beep = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + start + 0.01);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    };
    beep(880, 0, 0.12);
    beep(1100, 0.18, 0.12);
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* silent */
  }
}

// ─── BROWSER NOTIFICATIONS ────────────────────────────────────────────────────
async function requestNotifPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window))
    return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

function showWinNotif(entry: HistoryEntry, xNow: number) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const sym = (entry.tokenSymbol ?? entry.keyword).toUpperCase();
  const xStr = xNow >= 10 ? `${xNow.toFixed(1)}x` : `${xNow.toFixed(2)}x`;
  const n = new Notification(`✅ WRAITH WIN — $${sym} ${xStr}`, {
    body: `Spotted ${fmtMcap(entry.initialMcap)} → Now ${fmtMcap(entry.currentMcap)}${entry.celebMention ? `\n⭐ ${entry.celebMention}` : ""}`,
    icon: entry.tokenImageUrl ?? "/favicon.ico",
    tag: `wraith-win-${entry.keyword}`,
    requireInteraction: false,
  });
  n.onclick = () => {
    if (entry.contractAddress)
      window.open(
        `https://dexscreener.com/solana/${entry.contractAddress}`,
        "_blank",
      );
    n.close();
  };
}

// ─── TELEGRAM ─────────────────────────────────────────────────────────────────
async function sendTelegramWinAlert(entry: HistoryEntry, xNow: number) {
  try {
    await fetch("/api/alert/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "win",
        symbol: (entry.tokenSymbol ?? entry.keyword).toUpperCase(),
        keyword: entry.keyword,
        initialMcap: entry.initialMcap,
        currentMcap: entry.currentMcap,
        xNow,
        contractAddress: entry.contractAddress,
        celebMention: entry.celebMention,
        seenAt: entry.seenAt,
        platforms: entry.platforms,
        aiScore: entry.aiScore,
      }),
    });
  } catch {
    /* silent */
  }
}

// ─── AVATAR ───────────────────────────────────────────────────────────────────
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

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
let sparkIdCounter = 0;
function Spark({ snaps }: { snaps: McapSnapshot[] }) {
  const idRef = useRef<number | null>(null);
  if (idRef.current === null) idRef.current = sparkIdCounter++;
  const safe = safeSnapshots(snaps);
  if (safe.length < 2) return null;
  const vals = safe.map((s) => s.mcap);
  const min = Math.min(...vals),
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
  const uid = `sg${idRef.current}${up ? "u" : "d"}`;
  return (
    <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.18" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#${uid})`} />
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

// ─── AI SCORE BADGE ───────────────────────────────────────────────────────────
function AiScoreBadge({
  score,
  tier,
}: {
  score: number;
  tier?: "HOT" | "WATCH" | "SKIP";
}) {
  const isHot = tier === "HOT" || score >= 70;
  const isWatch = !isHot && (tier === "WATCH" || score >= 40);
  const color = isHot ? C.hot : isWatch ? C.amber : C.dim;
  const bg = isHot ? "#1a0800" : isWatch ? "#0d0800" : "#0a0a0a";
  const filled = Math.round(score / 20);
  return (
    <div
      title={`AI Score: ${score}/100`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: bg,
        border: `1px solid ${color}33`,
        borderRadius: 3,
        padding: "2px 6px",
        flexShrink: 0,
      }}
    >
      <span style={{ color, fontSize: 7, fontWeight: 800, ...MONO }}>AI</span>
      <div style={{ display: "flex", gap: 1.5 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 4,
              height: 8,
              borderRadius: 1,
              background: i < filled ? color : `${color}22`,
            }}
          />
        ))}
      </div>
      <span style={{ color, fontSize: 8, fontWeight: 700, ...MONO }}>
        {score}
      </span>
    </div>
  );
}

// ─── X BADGE ──────────────────────────────────────────────────────────────────
function XBadge({
  xNow,
  xPeak,
  updating,
  peakEarned,
}: {
  xNow: number;
  xPeak: number;
  updating: boolean;
  peakEarned: boolean;
}) {
  const isMega = peakEarned && xPeak >= 5;
  const isWin = peakEarned && xPeak >= 2;
  const isDead = xNow < 0.3;
  const col = isMega
    ? C.yellow
    : isWin
      ? C.green
      : xNow >= 1.2
        ? C.amber
        : isDead
          ? C.red
          : C.dim;
  const str =
    !updating && xNow >= 0.01
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
        flexDirection: "column",
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
      {peakEarned && xPeak > xNow * 1.15 && !updating && (
        <div
          style={{ color: `${C.yellow}55`, fontSize: 7, ...MONO, marginTop: 1 }}
        >
          pk {xPeak >= 10 ? xPeak.toFixed(1) : xPeak.toFixed(2)}x
        </div>
      )}
      {!peakEarned && xNow < 1.5 && (
        <div
          style={{
            color: `${C.red}55`,
            fontSize: 6,
            ...MONO,
            marginTop: 1,
            textAlign: "center",
          }}
        >
          pre-spot
        </div>
      )}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function WinsPanel({ onSelectMeme }: Props) {
  const [history, setHistory] = useState<Record<string, HistoryEntry>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [nextIn, setNextIn] = useState(AUTO_REFRESH_MS / 1000);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [updating, setUpdating] = useState<Set<string>>(new Set());
  const [boughtKeys, setBoughtKeys] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [undoSnap, setUndoSnap] = useState<Record<string, HistoryEntry> | null>(
    null,
  );
  const [undoCD, setUndoCD] = useState(0);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [deadCount, setDeadCount] = useState(0);
  const [purgeDismissed, setPurgeDismissed] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgStatus, setTgStatus] = useState<"idle" | "sending" | "ok" | "err">(
    "idle",
  );

  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoCD_ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const rfTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const backfillRunning = useRef(false);
  const winNotifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setBoughtKeys(loadSet(BOUGHT_KEY));
    setDismissed(loadSet(DISMISSED_KEY));
    const oldNotified = loadSet(NOTIFIED_KEY);
    const winNotified = loadSet(WIN_NOTIFIED_KEY);
    winNotifiedRef.current = new Set([...oldNotified, ...winNotified]);
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifEnabled(Notification.permission === "granted");
    }
    fetch("/api/alert/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _ping: true }),
    })
      .then((r) => {
        if (r.status !== 503) setTgEnabled(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const h = (e: StorageEvent) => {
      if (e.key === BOUGHT_KEY) setBoughtKeys(loadSet(BOUGHT_KEY));
    };
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setBoughtKeys(loadSet(BOUGHT_KEY)), 5_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const h = loadSafeHistory();
    const filtered: Record<string, HistoryEntry> = {};
    for (const [k, e] of Object.entries(h)) {
      if (isGarbage(k)) continue;
      if (!e.contractAddress && e.initialMcap === 0) continue;
      if (e.initialMcap === 0 && e.currentMcap === 0 && e.peakMcap === 0)
        continue;
      filtered[k] = e;
    }
    const dead = countDead(filtered);
    if (dead > 0) setDeadCount(dead);
    setHistory(filtered);
    backfill(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function backfill(h: Record<string, HistoryEntry>) {
    if (backfillRunning.current) return;
    backfillRunning.current = true;
    const toFill = Object.values(h).filter(
      (e) => e.contractAddress && !e.tokenImageUrl,
    );
    if (!toFill.length) {
      backfillRunning.current = false;
      return;
    }
    const upd = { ...h };
    for (let i = 0; i < toFill.length; i += 8) {
      await Promise.all(
        toFill.slice(i, i + 8).map(async (e) => {
          const meta = await fetchTokenMeta(e.contractAddress!);
          if (meta && upd[e.keyword]) {
            upd[e.keyword] = {
              ...upd[e.keyword],
              displayName: upd[e.keyword].displayName || meta.name,
              tokenSymbol: upd[e.keyword].tokenSymbol || meta.symbol,
              tokenImageUrl: meta.imageUrl,
            };
          }
        }),
      );
    }
    saveHistory(upd);
    setHistory((prev) => ({ ...prev, ...upd }));
    backfillRunning.current = false;
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && undoSnap) doUndo();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoSnap]);

  const fireWinAlerts = useCallback(
    (newWins: HistoryEntry[]) => {
      for (const entry of newWins) {
        const xNow = calcX(entry.initialMcap, entry.currentMcap);
        playWinSound();
        if (notifEnabled) showWinNotif(entry, xNow);
        if (tgEnabled) {
          setTgStatus("sending");
          sendTelegramWinAlert(entry, xNow)
            .then(() => {
              setTgStatus("ok");
              setTimeout(() => setTgStatus("idle"), 3_000);
            })
            .catch(() => {
              setTgStatus("err");
              setTimeout(() => setTgStatus("idle"), 3_000);
            });
        }
        winNotifiedRef.current.add(entry.keyword);
        saveSet(WIN_NOTIFIED_KEY, winNotifiedRef.current);
      }
    },
    [notifEnabled, tgEnabled],
  );

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
    }, 1_000);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      setUndoSnap(null);
      setUndoCD(0);
    }, UNDO_TIMEOUT_MS);
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
  const markBought = (kw: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set([...boughtKeys, kw]);
    setBoughtKeys(next);
    saveSet(BOUGHT_KEY, next);
  };
  const markSold = (kw: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set([...boughtKeys].filter((k) => k !== kw));
    setBoughtKeys(next);
    saveSet(BOUGHT_KEY, next);
  };
  const dismissEntry = (kw: string) => {
    const next = new Set([...dismissed, kw]);
    setDismissed(next);
    saveSet(DISMISSED_KEY, next);
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
  const confirmPurge = () => {
    const cur = loadSafeHistory();
    startUndo({ ...cur });
    const cleaned = purgeDead(cur);
    saveHistory(cleaned);
    setHistory(cleaned);
    setDeadCount(0);
    setPurgeDismissed(false);
    if (selKey && !cleaned[selKey]) setSelKey(null);
  };
  const openInPanel = (entry: HistoryEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onSelectMeme) return;
    onSelectMeme({
      keyword: entry.tokenSymbol || entry.keyword,
      score: 0,
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
    } as MemeTrend);
  };
  const enableNotifications = async () => {
    const granted = await requestNotifPermission();
    setNotifEnabled(granted);
  };

  // ─── REFRESH ──────────────────────────────────────────────────────────────
  const runRefresh = useCallback(
    async (h: Record<string, HistoryEntry>) => {
      const entries = Object.values(h).filter((e) => e.contractAddress);
      if (!entries.length) return h;
      setRefreshing(true);
      setUpdating(new Set(entries.map((e) => e.keyword)));
      const updates: Record<string, HistoryEntry> = {};
      await Promise.all(
        entries.map(async (entry) => {
          try {
            const mcap = await fetchCurrentMcap(entry.contractAddress!);
            if (!mcap || mcap <= 0) return;
            const nowMs = Date.now();
            const e: HistoryEntry = {
              ...entry,
              snapshots: safeSnapshots(entry.snapshots),
            };
            e.currentMcap = mcap;
            e.lastChecked = nowMs;
            if (mcap > e.peakMcap) {
              e.peakMcap = mcap;
              e.peakMcapTs = nowMs;
            }
            const snaps = e.snapshots;
            const last = snaps[snaps.length - 1];
            if (!last) {
              if (e.initialMcap === 0) e.initialMcap = mcap;
              e.snapshots = [{ ts: nowMs, mcap }];
            } else if (
              nowMs - last.ts > 1_800_000 ||
              Math.abs(mcap - last.mcap) / (last.mcap || 1) > 0.05
            ) {
              e.snapshots = [...snaps, { ts: nowMs, mcap }];
              if (e.snapshots.length > 48) e.snapshots.shift();
            }
            updates[entry.keyword] = e;
          } catch {
            /* skip */
          }
        }),
      );

      setHistory((prev) => {
        const merged = { ...prev, ...updates };
        saveHistory(merged);
        setDeadCount(countDead(merged));

        const newWins = Object.values(merged).filter((e) => {
          if (winNotifiedRef.current.has(e.keyword)) return false;
          if (!passesSignalFilter(e)) return false;
          const xNow = calcX(e.initialMcap, e.currentMcap);
          const xPeak = calcX(e.initialMcap, e.peakMcap);
          return (isPeakEarned(e) && xPeak >= 2 && xNow >= 1.5) || xNow >= 2;
        });
        if (newWins.length > 0) fireWinAlerts(newWins);
        return merged;
      });

      setRefreshing(false);
      setUpdating(new Set());
      setLastAt(new Date().toLocaleTimeString());
      return { ...h, ...updates };
    },
    [fireWinAlerts],
  );

  useEffect(() => {
    let cancelled = false;
    const schedule = () => {
      let s = AUTO_REFRESH_MS / 1000;
      setNextIn(s);
      if (cdTimer.current) clearInterval(cdTimer.current);
      cdTimer.current = setInterval(() => {
        s -= 1;
        if (!cancelled) setNextIn(Math.max(s, 0));
      }, 1_000);
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

  // ─── LIST — only tokens that passed signal filter AND hit 2x ──────────────
  const list = useMemo(
    () =>
      Object.values(history)
        .filter((e) => {
          // Must pass the same filter as Live Signals bar
          if (!passesSignalFilter(e)) return false;
          const xNow = calcX(e.initialMcap, e.currentMcap);
          const xPeak = calcX(e.initialMcap, e.peakMcap);
          const earned = isPeakEarned(e);
          return (earned && xPeak >= 2) || xNow >= 2;
        })
        .sort((a, b) => {
          const aHot = a.aiTier === "HOT" ? 1 : 0;
          const bHot = b.aiTier === "HOT" ? 1 : 0;
          const ax = isPeakEarned(a)
            ? calcX(a.initialMcap, a.peakMcap)
            : calcX(a.initialMcap, a.currentMcap);
          const bx = isPeakEarned(b)
            ? calcX(b.initialMcap, b.peakMcap)
            : calcX(b.initialMcap, b.currentMcap);
          if (Math.abs(ax - bx) > 0.5) return bx - ax;
          return bHot - aHot;
        }),
    [history],
  );

  const { bestX, bestTok } = useMemo(() => {
    const bx = list.reduce((acc, e) => {
      const x = isPeakEarned(e)
        ? calcX(e.initialMcap, e.peakMcap)
        : calcX(e.initialMcap, e.currentMcap);
      return Math.max(acc, x);
    }, 0);
    return {
      bestX: bx,
      bestTok: list.find((e) => {
        const x = isPeakEarned(e)
          ? calcX(e.initialMcap, e.peakMcap)
          : calcX(e.initialMcap, e.currentMcap);
        return x === bx;
      }),
    };
  }, [list]);

  const hotWins = useMemo(
    () => list.filter((e) => e.aiTier === "HOT").length,
    [list],
  );

  const tpAlerts = useMemo(
    () =>
      list.filter(
        (e) =>
          calcX(e.initialMcap, e.currentMcap) >= 2 &&
          boughtKeys.has(e.keyword) &&
          !dismissed.has(e.keyword),
      ),
    [list, boughtKeys, dismissed],
  );
  const showPurgeBanner = deadCount > 0 && !purgeDismissed;

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
        @keyframes tgsend{0%{opacity:1}50%{opacity:.3}100%{opacity:1}}
        @keyframes hotpulse{0%,100%{box-shadow:0 0 0 0 #ff6b3500}50%{box-shadow:0 0 8px 2px #ff6b3533}}
        .wc{cursor:pointer;transition:background .1s;position:relative}
        .wc:hover{background:#0a0a0a!important}
        .wdel{opacity:0;transition:opacity .12s}
        .wc:hover .wdel{opacity:1}
        .tpb{animation:aglow 2s ease-in-out infinite}
        .tgsending{animation:tgsend .8s ease-in-out infinite}
        .hotcard{animation:hotpulse 3s ease-in-out infinite}
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
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            flexWrap: "wrap",
          }}
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
              }}
            >
              💰 {tpAlerts.length}× TAKE PROFIT
            </span>
          )}
          {hotWins > 0 && (
            <span
              style={{
                fontSize: 9,
                color: C.hot,
                border: `1px solid ${C.hot}33`,
                padding: "2px 6px",
                borderRadius: 3,
                ...MONO,
                background: `${C.hot}0f`,
              }}
            >
              🔥 {hotWins} HOT WIN{hotWins !== 1 ? "S" : ""}
            </span>
          )}
          <span style={{ color: C.dim, fontSize: 9, ...MONO, flexShrink: 0 }}>
            {refreshing ? "refreshing..." : `↻ ${nextIn}s`}
          </span>
          {tgEnabled && tgStatus !== "idle" && (
            <span
              className={tgStatus === "sending" ? "tgsending" : ""}
              style={{
                fontSize: 9,
                ...MONO,
                color:
                  tgStatus === "ok"
                    ? C.green
                    : tgStatus === "err"
                      ? C.red
                      : C.blue,
              }}
            >
              {tgStatus === "sending"
                ? "TG ···"
                : tgStatus === "ok"
                  ? "TG ✓"
                  : "TG ✗"}
            </span>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 5,
            flexShrink: 0,
            alignItems: "center",
          }}
        >
          <button
            onClick={notifEnabled ? undefined : enableNotifications}
            style={{
              background: "transparent",
              border: "none",
              color: notifEnabled ? `${C.green}88` : C.dim,
              fontSize: 14,
              cursor: notifEnabled ? "default" : "pointer",
              padding: "2px 4px",
            }}
            title={
              notifEnabled
                ? "Browser notifications on"
                : "Click to enable notifications"
            }
          >
            🔔
          </button>
          {tgEnabled && (
            <span
              style={{ fontSize: 11, color: `${C.blue}88` }}
              title="Telegram alerts on"
            >
              ✈
            </span>
          )}
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

      {/* STATS BAR */}
      {list.length > 0 && (
        <div
          style={{
            background: "#030303",
            borderBottom: `1px solid ${C.bgCard}`,
            padding: "10px 14px",
            display: "flex",
            flexShrink: 0,
          }}
        >
          {(
            [
              {
                label: "TRACKED",
                value: Object.keys(history).length.toString(),
                color: C.orange,
              },
              {
                label: "2X+ WINS",
                value: list.length.toString(),
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
              {
                label: "HOT WINS",
                value: hotWins > 0 ? `${hotWins}/${list.length}` : "—",
                color: C.hot,
              },
              { label: "REFRESH", value: lastAt || "—", color: C.muted },
            ] as { label: string; value: string; color: string; sub?: string }[]
          ).map((s, i) => (
            <div
              key={i}
              style={{
                flex: i === 4 ? 1 : "none",
                minWidth: i === 4 ? 0 : 62,
                paddingRight: 14,
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
                  fontSize: i === 4 ? 10 : 18,
                  fontWeight: i === 4 ? 500 : 900,
                  ...MONO,
                  lineHeight: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.value}
              </div>
              {s.sub && (
                <div
                  style={{
                    color: `${C.yellow}66`,
                    fontSize: 7,
                    ...MONO,
                    marginTop: 2,
                  }}
                >
                  {s.sub}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* DEAD PURGE BANNER */}
      {showPurgeBanner && (
        <div
          style={{
            background: "#0d0600",
            borderBottom: `1px solid ${C.amber}22`,
            padding: "9px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            gap: 8,
          }}
        >
          <div>
            <div
              style={{ color: C.amber, fontSize: 10, fontWeight: 700, ...MONO }}
            >
              🗑 {deadCount} dead / stale token{deadCount !== 1 ? "s" : ""}{" "}
              detected
            </div>
            <div style={{ color: C.dim, fontSize: 8, ...MONO, marginTop: 2 }}>
              Down {(DEAD_THRESHOLD * 100).toFixed(0)}%+ from entry or older
              than 3 days
            </div>
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={confirmPurge}
              style={{
                background: "#1a0800",
                border: `1px solid ${C.amber}44`,
                color: C.amber,
                fontSize: 9,
                fontWeight: 700,
                ...MONO,
                padding: "5px 10px",
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              PURGE
            </button>
            <button
              onClick={() => setPurgeDismissed(true)}
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
              KEEP
            </button>
          </div>
        </div>
      )}

      {/* UNDO BANNER */}
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

      {/* EMPTY STATE */}
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
            NO WINS YET
          </div>
          <div
            style={{
              color: C.dim,
              fontSize: 9,
              ...MONO,
              textAlign: "center",
              maxWidth: 180,
              lineHeight: 1.6,
            }}
          >
            Only HIGH/ULTRA signals that hit 2x appear here
          </div>
        </div>
      )}

      {/* CARD LIST */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {list.map((entry) => {
          const snaps = safeSnapshots(entry.snapshots);
          const xNow = calcX(entry.initialMcap, entry.currentMcap);
          const xPeak = calcX(entry.initialMcap, entry.peakMcap);
          const earned = isPeakEarned(entry);
          const isMega = earned && xPeak >= 5;
          const isWin = earned && xPeak >= 2;
          const isDead = xNow < 0.3;
          const hasDumped = xNow < 0.7 && earned && xPeak >= 1.5;
          const drop =
            earned && entry.peakMcap > 0
              ? ((entry.peakMcap - entry.currentMcap) / entry.peakMcap) * 100
              : 0;
          const isCeleb = !!entry.celebMention;
          const isUpd = updating.has(entry.keyword);
          const isSel = selKey === entry.keyword;
          const hasBought = boughtKeys.has(entry.keyword);
          const showTP =
            xNow >= 2 && hasBought && !dismissed.has(entry.keyword);
          const isHot = entry.aiTier === "HOT";
          const accent = isMega
            ? C.yellow
            : isWin
              ? C.green
              : xNow >= 1.2
                ? C.amber
                : isDead
                  ? C.red
                  : C.border;
          const sym = (entry.tokenSymbol || entry.keyword).toUpperCase();
          const dispName =
            entry.displayName &&
            entry.displayName.toLowerCase() !== entry.keyword.toLowerCase()
              ? entry.displayName
              : null;

          return (
            <div
              key={entry.keyword}
              className={`wc${isHot ? " hotcard" : ""}`}
              onClick={() => {
                setSelKey(entry.keyword);
                if (onSelectMeme)
                  openInPanel(entry, {
                    stopPropagation: () => {},
                  } as React.MouseEvent);
              }}
              style={{
                borderBottom: `1px solid ${C.bgCard}`,
                borderTop: "none",
                borderRight: "none",
                borderLeft: `2px solid ${isSel ? (isMega ? C.yellow : C.orange) : isHot ? C.hot : accent}`,
                background: isSel ? "#0d0300" : isHot ? "#0d0500" : C.bg,
              }}
            >
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
                  <div>
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
                        style={{
                          fontSize: 9,
                          color: C.blue,
                          border: `1px solid ${C.blue}33`,
                          padding: "5px 10px",
                          borderRadius: 3,
                          textDecoration: "none",
                          ...MONO,
                        }}
                      >
                        DEX↗
                      </a>
                    )}
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
                      }}
                    >
                      SOLD ✓
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissEntry(entry.keyword);
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
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        flexWrap: "wrap",
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
                            whiteSpace: "nowrap",
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
                      {!earned && xNow < 1.5 && xPeak < 1.5 && (
                        <span
                          style={{
                            fontSize: 8,
                            color: C.red,
                            border: `1px solid ${C.red}22`,
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                          title="Peak happened before your scanner spotted this"
                        >
                          PRE-SPOT
                        </span>
                      )}
                      {typeof entry.aiScore === "number" && (
                        <AiScoreBadge
                          score={entry.aiScore}
                          tier={entry.aiTier}
                        />
                      )}
                    </div>
                    {entry.aiContext && (
                      <div
                        style={{
                          color: C.muted,
                          fontSize: 9,
                          ...MONO,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          marginBottom: 4,
                          maxWidth: "95%",
                        }}
                      >
                        {entry.aiContext.slice(0, 60)}
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <div
                        style={{
                          background: "#0a0a0a",
                          border: `1px solid ${C.border}`,
                          borderRadius: 3,
                          padding: "3px 8px",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <span
                          style={{
                            color: C.label,
                            fontSize: 7,
                            ...MONO,
                            letterSpacing: "0.1em",
                          }}
                        >
                          SPOTTED
                        </span>
                        <span
                          style={{
                            color: C.orange,
                            fontSize: 10,
                            fontWeight: 700,
                            ...MONO,
                          }}
                        >
                          {fmtTime(entry.seenAt)}
                        </span>
                        <span style={{ color: C.dim, fontSize: 8, ...MONO }}>
                          · {fmtAgo(entry.seenAt, now)}
                        </span>
                      </div>
                      {earned && entry.peakMcapTs > entry.seenAt && (
                        <div
                          style={{
                            background: "#0a0a0a",
                            border: `1px solid ${C.yellow}22`,
                            borderRadius: 3,
                            padding: "3px 8px",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          <span
                            style={{
                              color: C.label,
                              fontSize: 7,
                              ...MONO,
                              letterSpacing: "0.1em",
                            }}
                          >
                            PEAK AT
                          </span>
                          <span
                            style={{
                              color: C.yellow,
                              fontSize: 10,
                              fontWeight: 700,
                              ...MONO,
                            }}
                          >
                            {fmtTime(entry.peakMcapTs)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      {(
                        [
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
                          ...(earned && entry.peakMcap > entry.currentMcap * 1.1
                            ? [
                                null,
                                {
                                  label: "PEAK",
                                  value: fmtMcap(entry.peakMcap),
                                  color: `${C.yellow}99`,
                                },
                              ]
                            : []),
                        ] as ({
                          label: string;
                          value: string;
                          color: string;
                        } | null)[]
                      ).map((item, i) =>
                        item === null ? (
                          <span
                            key={i}
                            style={{ color: C.dim, fontSize: 10, ...MONO }}
                          >
                            →
                          </span>
                        ) : (
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
                        ),
                      )}
                    </div>
                  </div>
                  <XBadge
                    xNow={xNow}
                    xPeak={earned ? xPeak : xNow}
                    updating={isUpd}
                    peakEarned={earned}
                  />
                </div>
                {snaps.length >= 2 && (
                  <div style={{ marginBottom: 8, marginLeft: 50 }}>
                    <Spark snaps={snaps} />
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", gap: 5 }}>
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
                    {entry.contractAddress && onSelectMeme && (
                      <button
                        onClick={(e) => openInPanel(entry, e)}
                        style={{
                          background: "transparent",
                          border: `1px solid ${C.orange}33`,
                          color: C.orange,
                          fontSize: 8,
                          padding: "2px 7px",
                          borderRadius: 2,
                          cursor: "pointer",
                          ...MONO,
                        }}
                      >
                        CHART↗
                      </button>
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
                        fontWeight: hasBought ? 700 : 400,
                      }}
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
                        padding: "2px 7px",
                        borderRadius: 2,
                        cursor: "pointer",
                        ...MONO,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "#1a0000";
                        (e.currentTarget as HTMLElement).style.color = C.red;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "transparent";
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
