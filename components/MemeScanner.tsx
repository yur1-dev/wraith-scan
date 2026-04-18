"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import axios from "axios";
import { MemeTrend } from "@/app/page";

interface ScanResult extends MemeTrend {
  platforms?: string[];
  isNewCoin?: boolean;
  ageLabel?: string;
  ageMinutes?: number;
  ageDays?: number;
  mcap?: number;
  volume?: number;
  liquidity?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  contractAddress?: string;
  rugRisk?: "low" | "medium" | "high" | "unknown";
  rugDetails?: string;
  onTwitter?: boolean;
  onTelegram?: boolean;
  onDex?: boolean;
  onCeleb?: boolean;
  onAI?: boolean;
  celebMention?: string;
  aiContext?: string;
  isViralTrend?: boolean;
  tokenName?: string;
  tokenSymbol?: string;
  tokenImageUrl?: string;
}

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

export const HISTORY_KEY = "wraith_token_history_v2";

export function loadHistory(): Record<string, HistoryEntry> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveHistory(h: Record<string, HistoryEntry>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch {}
}

interface TokenMeta {
  name: string;
  symbol: string;
  imageUrl?: string;
}
const metaCache = new Map<string, TokenMeta | null>();

export async function fetchTokenMeta(ca: string): Promise<TokenMeta | null> {
  if (metaCache.has(ca)) return metaCache.get(ca)!;
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${ca}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) {
      metaCache.set(ca, null);
      return null;
    }
    const data = await res.json();
    const pairs = (data?.pairs || [])
      .filter((p: { chainId: string }) => p.chainId === "solana")
      .sort(
        (
          a: { liquidity?: { usd?: number } },
          b: { liquidity?: { usd?: number } },
        ) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0),
      );
    if (!pairs.length) {
      metaCache.set(ca, null);
      return null;
    }
    const best = pairs[0];
    const meta: TokenMeta = {
      name: best.baseToken?.name || best.baseToken?.symbol || "",
      symbol: (best.baseToken?.symbol || "").toUpperCase(),
      imageUrl: best.info?.imageUrl ?? undefined,
    };
    metaCache.set(ca, meta);
    return meta;
  } catch {
    metaCache.set(ca, null);
    return null;
  }
}

export async function fetchCurrentMcap(ca: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${ca}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const pairs = (data?.pairs || [])
      .filter((p: { chainId: string }) => p.chainId === "solana")
      .sort(
        (
          a: { liquidity?: { usd?: number } },
          b: { liquidity?: { usd?: number } },
        ) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0),
      );
    if (!pairs.length) return null;
    return pairs[0].fdv || pairs[0].marketCap || null;
  } catch {
    return null;
  }
}

// Detect CA-fragment garbage keywords
function isGarbageKeyword(kw: string): boolean {
  if (kw.length > 14) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{10,}$/.test(kw)) return true;
  if (/\d{4,}/.test(kw)) return true;
  const vowels = (kw.match(/[aeiou]/gi) || []).length;
  if (kw.length >= 8 && vowels === 0) return true;
  return false;
}

// Minimum quality gates for Win Tracker
// Tokens below these are noise — not worth watching
const MIN_TRACK_SCORE = 500_000;
const MIN_TRACK_MCAP = 5_000;

export function recordTokenSighting(result: ScanResult) {
  if (!result.contractAddress) return;
  if (isGarbageKeyword(result.keyword)) return;

  // Skip weak signals — celeb tokens bypass this since they're always relevant
  if ((result.score || 0) < MIN_TRACK_SCORE && !result.celebMention) return;
  // Skip tokens with a known mcap that's too tiny to matter
  if ((result.mcap || 0) > 0 && (result.mcap || 0) < MIN_TRACK_MCAP) return;

  const h = loadHistory();
  const key = result.keyword;
  const now = Date.now();
  const mcap = result.mcap || 0;

  if (!h[key]) {
    h[key] = {
      keyword: key,
      displayName: result.tokenName,
      tokenSymbol: result.tokenSymbol,
      tokenImageUrl: result.tokenImageUrl,
      seenAt: now,
      contractAddress: result.contractAddress,
      celebMention: result.celebMention,
      aiContext: result.aiContext,
      platforms: result.platforms || [],
      initialMcap: mcap,
      peakMcap: mcap,
      currentMcap: mcap,
      snapshots: mcap > 0 ? [{ ts: now, mcap }] : [],
      lastChecked: now,
    };
  } else {
    if (mcap > 0) {
      if (mcap > h[key].peakMcap) h[key].peakMcap = mcap;
      h[key].currentMcap = mcap;
      h[key].lastChecked = now;
      const snaps = h[key].snapshots;
      const lastSnap = snaps[snaps.length - 1];
      if (!lastSnap) {
        h[key].initialMcap = mcap;
        h[key].snapshots = [{ ts: now, mcap }];
      } else {
        const timeDiff = now - lastSnap.ts;
        const mcapChange =
          Math.abs(mcap - lastSnap.mcap) / (lastSnap.mcap || 1);
        if (timeDiff > 1800000 || mcapChange > 0.05) {
          h[key].snapshots = [...snaps, { ts: now, mcap }];
          if (h[key].snapshots.length > 48) h[key].snapshots.shift();
        }
      }
    }
    if (result.celebMention && !h[key].celebMention)
      h[key].celebMention = result.celebMention;
    if (result.aiContext && !h[key].aiContext)
      h[key].aiContext = result.aiContext;
    if (result.tokenName && !h[key].displayName)
      h[key].displayName = result.tokenName;
    if (result.tokenSymbol && !h[key].tokenSymbol)
      h[key].tokenSymbol = result.tokenSymbol;
    if (result.tokenImageUrl && !h[key].tokenImageUrl)
      h[key].tokenImageUrl = result.tokenImageUrl;
  }
  saveHistory(h);
}

function getAgeDisplay(ageMinutes: number | undefined) {
  if (ageMinutes === undefined)
    return { label: "", color: "#2a2a2a", isStale: false, isFresh: false };
  const days = ageMinutes / 1440;
  if (days > 14)
    return {
      label: `${Math.floor(days)}d — STALE`,
      color: "#ff4444",
      isStale: true,
      isFresh: false,
    };
  if (days > 7)
    return {
      label: `${Math.floor(days)}d old`,
      color: "#ff6600",
      isStale: false,
      isFresh: false,
    };
  if (days > 3)
    return {
      label: `${Math.floor(days)}d old`,
      color: "#ffaa00",
      isStale: false,
      isFresh: false,
    };
  if (ageMinutes > 1440)
    return {
      label: `${Math.floor(days)}d old`,
      color: "#888",
      isStale: false,
      isFresh: false,
    };
  if (ageMinutes > 360)
    return {
      label: `${Math.floor(ageMinutes / 60)}h old`,
      color: "#00c47a",
      isStale: false,
      isFresh: true,
    };
  return {
    label: `${ageMinutes}m old`,
    color: "#00c47a",
    isStale: false,
    isFresh: true,
  };
}

const MONO = {
  fontFamily: "'JetBrains Mono', 'Fira Mono', monospace" as const,
};

const PLATFORM_META: Record<string, { label: string; color: string }> = {
  celebrity: { label: "CELEB", color: "#ffd700" },
  ai: { label: "AI", color: "#e8490f" },
  pumpfun: { label: "PUMP", color: "#a855f7" },
  dexscreener: { label: "DEX", color: "#00b4d8" },
  twitter: { label: "X", color: "#e2e8f0" },
  coingecko: { label: "CGK", color: "#8dc63f" },
  reddit: { label: "RED", color: "#ff4500" },
  "google-trends": { label: "TREND", color: "#4285f4" },
  "google-news": { label: "NEWS", color: "#4285f4" },
  youtube: { label: "YT", color: "#ff0000" },
  kym: { label: "KYM", color: "#00b300" },
  hackernews: { label: "HN", color: "#ff6600" },
  telegram: { label: "TG", color: "#26a5e4" },
};

const RUG_COLOR: Record<string, string> = {
  low: "#00c47a",
  medium: "#ffaa00",
  high: "#ff2222",
  unknown: "#333",
};

// ─── TOKEN AVATAR ────────────────────────────────────────────────────────────
function TokenAvatar({
  imageUrl,
  symbol,
  size = 36,
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

// ─── DECISION CHAIN ──────────────────────────────────────────────────────────
function DecisionChain({ item }: { item: ScanResult }) {
  const platforms = item.platforms || [];
  const signals: { label: string; color: string; reason: string }[] = [];

  if (item.onCeleb || platforms.includes("celebrity"))
    signals.push({
      label: "CELEBRITY TRIGGER",
      color: "#ffd700",
      reason: item.celebMention
        ? `${item.celebMention} mentioned this`
        : "Celebrity/influencer mention detected",
    });
  if (item.onAI || platforms.includes("ai"))
    signals.push({
      label: "AI CONTEXT MATCH",
      color: "#e8490f",
      reason: item.aiContext
        ? item.aiContext.slice(0, 100)
        : "Gemini AI confirmed viral potential",
    });
  if (platforms.includes("pumpfun") || platforms.includes("dexscreener"))
    signals.push({
      label: "ON-CHAIN ACTIVITY",
      color: "#00b4d8",
      reason: item.mcap
        ? `Mcap $${item.mcap >= 1000 ? (item.mcap / 1000).toFixed(0) + "K" : item.mcap}${item.liquidity ? " · Liq $" + (item.liquidity / 1000).toFixed(0) + "K" : ""}`
        : "Active trading on Solana",
    });
  if (platforms.some((p) => ["google-trends", "youtube", "kym"].includes(p)))
    signals.push({
      label: "VIRAL INTERNET TREND",
      color: "#ffaa00",
      reason: `Trending on: ${platforms
        .filter((p) => ["google-trends", "youtube", "kym"].includes(p))
        .map((p) => PLATFORM_META[p]?.label || p)
        .join(", ")}`,
    });
  if (platforms.includes("reddit"))
    signals.push({
      label: "REDDIT BUZZ",
      color: "#ff4500",
      reason: "Hot posts on crypto/meme subreddits",
    });
  if (platforms.some((p) => ["google-news", "twitter"].includes(p)))
    signals.push({
      label: "NEWS / SOCIAL SIGNAL",
      color: "#4285f4",
      reason: "In Google News or X trending",
    });

  const hasCeleb = item.onCeleb;
  const hasAI = item.onAI;
  const hasOnchain = platforms.some((p) =>
    ["pumpfun", "dexscreener"].includes(p),
  );
  const hasSocial = platforms.some((p) =>
    ["reddit", "twitter", "google-trends", "youtube", "kym"].includes(p),
  );
  const platformCount = platforms.length;

  let confidence = 20,
    confidenceLabel = "SPECULATIVE",
    confidenceColor = "#ff4444";
  if (hasCeleb && hasOnchain) {
    confidence = 95;
    confidenceLabel = "EXTREMELY HIGH";
    confidenceColor = "#ffd700";
  } else if (hasCeleb && hasSocial) {
    confidence = 88;
    confidenceLabel = "VERY HIGH";
    confidenceColor = "#ffd700";
  } else if (hasAI && hasOnchain && hasSocial && platformCount >= 4) {
    confidence = 82;
    confidenceLabel = "HIGH";
    confidenceColor = "#00c47a";
  } else if (hasAI && hasOnchain && platformCount >= 3) {
    confidence = 70;
    confidenceLabel = "GOOD";
    confidenceColor = "#00c47a";
  } else if (hasOnchain && hasSocial) {
    confidence = 58;
    confidenceLabel = "MODERATE";
    confidenceColor = "#ffaa00";
  } else if (hasOnchain && platformCount >= 2) {
    confidence = 45;
    confidenceLabel = "LOW-MODERATE";
    confidenceColor = "#ffaa00";
  } else if (hasCeleb) {
    confidence = 40;
    confidenceLabel = "LOW (no coin yet)";
    confidenceColor = "#ff6600";
  }
  if (item.rugRisk === "medium") confidence = Math.max(confidence - 15, 5);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px",
        background: "#040404",
        borderTop: "1px solid #0d0d0d",
      }}
    >
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              color: "#2a2a2a",
              fontSize: 8,
              ...MONO,
              letterSpacing: "0.14em",
            }}
          >
            WRAITH CONFIDENCE
          </span>
          <span
            style={{
              color: confidenceColor,
              fontSize: 10,
              fontWeight: 700,
              ...MONO,
            }}
          >
            {confidenceLabel} · {confidence}%
          </span>
        </div>
        <div
          style={{
            height: 3,
            background: "#111",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${confidence}%`,
              background: `linear-gradient(90deg, ${confidenceColor}88, ${confidenceColor})`,
              borderRadius: 2,
              transition: "width 0.6s ease",
            }}
          />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div
          style={{
            color: "#1e1e1e",
            fontSize: 7,
            ...MONO,
            letterSpacing: "0.14em",
            marginBottom: 2,
          }}
        >
          WHY WRAITH FOUND THIS
        </div>
        {signals.map((sig, i) => (
          <div
            key={i}
            style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: sig.color,
                flexShrink: 0,
                marginTop: 3,
              }}
            />
            <div>
              <div
                style={{
                  color: sig.color,
                  fontSize: 8,
                  fontWeight: 700,
                  ...MONO,
                  letterSpacing: "0.1em",
                }}
              >
                {sig.label}
              </div>
              <div
                style={{
                  color: "#444",
                  fontSize: 9,
                  ...MONO,
                  lineHeight: 1.5,
                  marginTop: 1,
                }}
              >
                {sig.reason}
              </div>
            </div>
          </div>
        ))}
        {signals.length === 0 && (
          <div style={{ color: "#222", fontSize: 9, ...MONO }}>
            Weak signal — insufficient cross-platform confirmation
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const }}>
        {platforms
          .filter((p) => PLATFORM_META[p])
          .map((p) => (
            <span
              key={p}
              style={{
                fontSize: 7,
                ...MONO,
                color: PLATFORM_META[p].color,
                border: `1px solid ${PLATFORM_META[p].color}33`,
                padding: "1px 5px",
                borderRadius: 2,
              }}
            >
              {PLATFORM_META[p].label}
            </span>
          ))}
      </div>
    </div>
  );
}

const REFRESH_INTERVAL = 90;

interface Props {
  onSelectMeme: (meme: MemeTrend) => void;
  selectedMeme: MemeTrend | null;
}

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
    "all" | "celeb" | "new" | "viral" | "social" | "onchain" | "safe" | "fresh"
  >("all");
  const [expandedDecision, setExpandedDecision] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasMounted = useRef(false);
  const loadingRef = useRef(false);

  const enrichWithTokenMeta = useCallback(
    async (results: ScanResult[]): Promise<ScanResult[]> => {
      const toEnrich = results.filter(
        (r) => r.contractAddress && !r.tokenImageUrl,
      );
      if (!toEnrich.length) return results;
      setEnriching(true);

      for (let i = 0; i < toEnrich.length; i += 12) {
        await Promise.all(
          toEnrich.slice(i, i + 12).map(async (r) => {
            const meta = await fetchTokenMeta(r.contractAddress!);
            if (meta) {
              r.tokenName = meta.name;
              r.tokenSymbol = meta.symbol;
              r.tokenImageUrl = meta.imageUrl;
            }
          }),
        );
      }
      setEnriching(false);
      return [...results];
    },
    [],
  );

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
      [
        "Scanning Elon, Trump, CZ on X...",
        "Fetching Pump.fun launches...",
        "Scanning DexScreener pairs...",
        "CoinGecko trending...",
        "Google Trends + YouTube...",
        "Reddit subs...",
        "KYM + Hacker News...",
        "Rugcheck...",
        "Age filtering + scoring...",
      ].forEach((msg, i) =>
        setTimeout(() => setScanLog((l) => [...l.slice(-6), msg]), i * 2000),
      );

      try {
        const res = await axios.get<{
          results: ScanResult[];
          logs: string[];
          scannedAt: string;
        }>("/api/scan", { timeout: 85000 });
        clearInterval(ticker);
        setProgress(100);
        const { results, logs } = res.data;

        const enriched = await enrichWithTokenMeta(results);
        enriched.forEach(recordTokenSighting);

        setScanLog([...logs.slice(-8)]);
        setTrends(enriched);
        setLastScan(new Date().toLocaleTimeString());
        setError("");
        setCountdown(REFRESH_INTERVAL);
        if (enriched.length > 0 && !selectedMeme) onSelectMeme(enriched[0]);
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
    [selectedMeme, onSelectMeme, enrichWithTokenMeta],
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
    const hasCeleb = p.includes("celebrity") || item.onCeleb;
    const hasSocial = p.some((x) =>
      ["reddit", "google-trends", "youtube", "kym"].includes(x),
    );
    const hasChain = p.some((x) => ["pumpfun", "dexscreener"].includes(x));
    const count = item.crossPlatforms ?? 0;
    if (hasCeleb && hasChain) return { label: "CELEB+CHAIN", color: "#ffd700" };
    if (hasCeleb && hasSocial)
      return { label: "CELEB+VIRAL", color: "#ffd700" };
    if (hasCeleb) return { label: "CELEB SIGNAL", color: "#ffd700" };
    if (hasSocial && hasChain && count >= 3)
      return { label: "VIRAL+CHAIN", color: "#ff2020" };
    if (hasSocial && hasChain)
      return { label: "SOCIAL+CHAIN", color: "#ff6600" };
    if (hasSocial && count >= 4)
      return { label: "MEGA VIRAL", color: "#ffcc00" };
    if (hasSocial && count >= 3) return { label: "VIRAL", color: "#ffcc00" };
    if (hasChain && item.isNewCoin)
      return { label: "NEW COIN", color: "#a855f7" };
    if (hasChain) return { label: "ON-CHAIN", color: "#00c47a" };
    if (item.hasTicker && hasSocial)
      return { label: "TRENDING", color: "#e8490f" };
    return { label: "WATCH", color: "#333" };
  };

  const filtered = trends.filter((t) => {
    const p = t.platforms || [];
    if (filter === "celeb") return t.onCeleb || p.includes("celebrity");
    if (filter === "new") return t.isNewCoin;
    if (filter === "fresh") return (t.ageMinutes || Infinity) < 1440;
    if (filter === "viral")
      return (
        t.isViralTrend ||
        p.some((x) => ["google-trends", "youtube", "kym"].includes(x))
      );
    if (filter === "social")
      return p.some((x) =>
        ["reddit", "google-trends", "google-news"].includes(x),
      );
    if (filter === "onchain")
      return p.some((x) => ["pumpfun", "dexscreener"].includes(x));
    if (filter === "safe") return t.rugRisk === "low";
    return true;
  });

  const celebCount = trends.filter((t) => t.onCeleb).length;
  const viralCount = trends.filter((t) => t.isViralTrend).length;
  const freshCount = trends.filter(
    (t) => (t.ageMinutes || Infinity) < 1440,
  ).length;

  const TABS: { key: typeof filter; label: string; color?: string }[] = [
    { key: "all", label: "ALL" },
    { key: "celeb", label: "⭐ CELEB", color: "#ffd700" },
    { key: "fresh", label: "🔥 FRESH", color: "#00c47a" },
    { key: "new", label: "NEW" },
    { key: "viral", label: "VIRAL" },
    { key: "social", label: "SOCIAL" },
    { key: "onchain", label: "ON-CHAIN" },
    { key: "safe", label: "SAFE" },
  ];

  const SCAN_SOURCES = [
    "Celeb/X",
    "Pump.fun",
    "DexScreener",
    "CoinGecko",
    "Trends/YT",
    "Reddit",
    "KYM/HN",
    "Rugcheck",
    "Age filter",
  ];

  return (
    <div
      style={{
        background: "#060606",
        border: "1px solid #141414",
        borderRadius: 8,
        overflow: "hidden",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          borderBottom: "1px solid #111",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
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
                ...MONO,
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
                color: loading ? "#ffaa00" : enriching ? "#ffaa00" : "#00c47a",
                fontSize: 9,
                ...MONO,
              }}
            >
              {loading ? "SCANNING" : enriching ? "ENRICHING" : "LIVE"}
            </span>
            {!loading && celebCount > 0 && (
              <span
                style={{
                  fontSize: 9,
                  ...MONO,
                  color: "#ffd700",
                  border: "1px solid #ffd70033",
                  padding: "1px 6px",
                  borderRadius: 3,
                }}
              >
                ⭐ {celebCount} CELEB
              </span>
            )}
            {!loading && freshCount > 0 && (
              <span
                style={{
                  fontSize: 9,
                  ...MONO,
                  color: "#00c47a",
                  border: "1px solid #00c47a33",
                  padding: "1px 6px",
                  borderRadius: 3,
                }}
              >
                ⚡ {freshCount} FRESH
              </span>
            )}
            {!loading && viralCount > 0 && (
              <span
                style={{
                  fontSize: 9,
                  ...MONO,
                  color: "#ff6600",
                  border: "1px solid #ff660033",
                  padding: "1px 6px",
                  borderRadius: 3,
                }}
              >
                🔥 {viralCount} VIRAL
              </span>
            )}
          </div>
          <div
            style={{ color: "#2a2a2a", fontSize: 10, marginTop: 3, ...MONO }}
          >
            {loading
              ? scanLog[scanLog.length - 1] || "Initializing..."
              : enriching
                ? "Fetching real token names + images from DexScreener..."
                : lastScan
                  ? `${lastScan} · ${trends.length} signals · refresh ${countdown}s`
                  : "Elon · Trump · TikTok · YouTube · Reddit · Pump.fun · DexScreener"}
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
              ...MONO,
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
              ...MONO,
            }}
          >
            {loading ? "SCANNING..." : "SCAN NOW"}
          </button>
        </div>
      </div>

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
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const }}>
            {SCAN_SOURCES.map((label, i) => {
              const step = Math.floor(progress / (100 / SCAN_SOURCES.length));
              return (
                <span
                  key={label}
                  style={{
                    fontSize: 9,
                    ...MONO,
                    color:
                      step === i ? "#e8490f" : step > i ? "#222" : "#1a1a1a",
                  }}
                >
                  {step === i ? ">" : "·"} {label.toUpperCase()}
                </span>
              );
            })}
          </div>
          {scanLog.slice(-1).map((line, i) => (
            <div
              key={i}
              style={{ color: "#666", fontSize: 10, ...MONO, marginTop: 4 }}
            >
              &gt; {line}
            </div>
          ))}
        </div>
      )}

      {error && !loading && (
        <div
          style={{
            padding: "8px 16px",
            color: "#ff4444",
            fontSize: 10,
            ...MONO,
            borderBottom: "1px solid #1a1a1a",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          padding: "5px 10px",
          borderBottom: "1px solid #0d0d0d",
          display: "flex",
          gap: 3,
          background: "#040404",
          flexShrink: 0,
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
                ...MONO,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && !loading && !error && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              color: "#0d0d0d",
              fontSize: 28,
              ...MONO,
              letterSpacing: "0.3em",
            }}
          >
            WRAITH
          </div>
          <div style={{ color: "#1a1a1a", fontSize: 10, ...MONO }}>
            {filter === "celeb"
              ? "NO CELEB SIGNALS"
              : filter === "safe"
                ? "NO SAFE TOKENS"
                : filter === "fresh"
                  ? "NO FRESH TOKENS YET — SCAN NOW"
                  : "HUNTING..."}
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto" as const }}>
        {filtered.map((t, i) => {
          const sig = getSignal(t);
          const isSelected = selectedMeme?.keyword === t.keyword;
          const p = t.platforms || [];
          const isCeleb = t.onCeleb || p.includes("celebrity");
          const isExpanded = expandedDecision === t.keyword;
          const change1h =
            t.priceChange1h !== undefined
              ? {
                  text: `${t.priceChange1h >= 0 ? "+" : ""}${t.priceChange1h.toFixed(0)}%`,
                  color: t.priceChange1h >= 0 ? "#00c47a" : "#ff4444",
                }
              : null;
          const ageDisplay = getAgeDisplay(t.ageMinutes);
          const platformCount = p.length;
          const qualityWarning = platformCount < 2 && !isCeleb && !t.hasTicker;
          const displaySymbol = t.tokenSymbol || t.keyword.toUpperCase();
          const displayName =
            t.tokenName && t.tokenName.toLowerCase() !== t.keyword.toLowerCase()
              ? t.tokenName
              : null;

          return (
            <div key={t.keyword} style={{ borderBottom: "1px solid #080808" }}>
              <button
                onClick={() => {
                  onSelectMeme(t);
                  setExpandedDecision(isExpanded ? null : t.keyword);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 14px",
                  background: isSelected
                    ? isCeleb
                      ? "#0d0a00"
                      : "#0d0300"
                    : "transparent",
                  borderTop: "none",
                  borderRight: "none",
                  borderBottom: "none",
                  borderLeft: `2px solid ${isSelected ? (isCeleb ? "#ffd700" : "#e8490f") : "transparent"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  gap: 8,
                  opacity: qualityWarning ? 0.5 : ageDisplay.isStale ? 0.35 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected)
                    (e.currentTarget as HTMLElement).style.background =
                      "#0a0a0a";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected)
                    (e.currentTarget as HTMLElement).style.background =
                      isSelected
                        ? isCeleb
                          ? "#0d0a00"
                          : "#0d0300"
                        : "transparent";
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <span
                    style={{
                      color: "#1e1e1e",
                      fontSize: 9,
                      ...MONO,
                      width: 18,
                      flexShrink: 0,
                      textAlign: "right" as const,
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>

                  <TokenAvatar
                    imageUrl={t.tokenImageUrl}
                    symbol={displaySymbol}
                    size={34}
                  />

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        flexWrap: "wrap" as const,
                        marginBottom: 2,
                      }}
                    >
                      <span
                        style={{
                          color: isCeleb
                            ? "#ffd700"
                            : ageDisplay.isStale
                              ? "#555"
                              : "#f0f0f0",
                          fontSize: 13,
                          fontWeight: 700,
                          ...MONO,
                        }}
                      >
                        ${displaySymbol}
                      </span>
                      {displayName && (
                        <span
                          style={{
                            color: "#2e2e2e",
                            fontSize: 9,
                            ...MONO,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap" as const,
                            maxWidth: 90,
                          }}
                        >
                          {displayName}
                        </span>
                      )}
                      {ageDisplay.label && (
                        <span
                          style={{
                            fontSize: 7,
                            ...MONO,
                            color: ageDisplay.color,
                            border: `1px solid ${ageDisplay.color}44`,
                            padding: "1px 5px",
                            borderRadius: 2,
                            fontWeight: ageDisplay.isFresh ? 700 : 400,
                          }}
                        >
                          {ageDisplay.isFresh
                            ? "⚡ "
                            : ageDisplay.isStale
                              ? "⚠ "
                              : ""}
                          {ageDisplay.label}
                        </span>
                      )}
                      {isCeleb && (
                        <span
                          style={{
                            fontSize: 7,
                            color: "#ffd700",
                            border: "1px solid #ffd70044",
                            padding: "1px 5px",
                            borderRadius: 2,
                            ...MONO,
                            fontWeight: 700,
                          }}
                        >
                          ⭐{" "}
                          {t.celebMention
                            ? t.celebMention.split(" ")[0].toUpperCase()
                            : "CELEB"}
                        </span>
                      )}
                      {t.isNewCoin && (
                        <span
                          style={{
                            fontSize: 7,
                            color: "#a855f7",
                            border: "1px solid #a855f744",
                            padding: "1px 4px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                        >
                          NEW
                        </span>
                      )}
                      {qualityWarning && (
                        <span
                          style={{
                            fontSize: 7,
                            color: "#444",
                            border: "1px solid #33333344",
                            padding: "1px 4px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                        >
                          WEAK
                        </span>
                      )}
                      {p
                        .filter(
                          (pl) =>
                            ![
                              "celebrity",
                              "ai",
                              "google-trends",
                              "google-news",
                              "hackernews",
                            ].includes(pl),
                        )
                        .map((plat) => {
                          const pi = PLATFORM_META[plat];
                          return pi ? (
                            <span
                              key={plat}
                              style={{
                                fontSize: 7,
                                color: pi.color,
                                border: `1px solid ${pi.color}33`,
                                padding: "1px 4px",
                                borderRadius: 2,
                                ...MONO,
                              }}
                            >
                              {pi.label}
                            </span>
                          ) : null;
                        })}
                      {t.rugRisk && t.rugRisk !== "unknown" && (
                        <span
                          style={{
                            fontSize: 7,
                            color: RUG_COLOR[t.rugRisk],
                            border: `1px solid ${RUG_COLOR[t.rugRisk]}33`,
                            padding: "1px 4px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                        >
                          {t.rugRisk === "low"
                            ? "SAFE"
                            : t.rugRisk === "medium"
                              ? "MED"
                              : "RUG"}
                        </span>
                      )}
                    </div>

                    {isCeleb && t.aiContext && (
                      <div
                        style={{
                          fontSize: 9,
                          color: "#ffd70055",
                          ...MONO,
                          marginBottom: 2,
                          maxWidth: 200,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap" as const,
                        }}
                      >
                        ⭐ {t.aiContext.slice(0, 50)}
                      </div>
                    )}
                    {!isCeleb && t.aiContext && (
                      <div
                        style={{
                          fontSize: 9,
                          color: "#2e2e2e",
                          ...MONO,
                          maxWidth: 200,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap" as const,
                          marginBottom: 2,
                        }}
                      >
                        ✦ {t.aiContext.slice(0, 50)}
                      </div>
                    )}

                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                        flexWrap: "wrap" as const,
                      }}
                    >
                      {change1h && (
                        <span
                          style={{
                            fontSize: 9,
                            color: change1h.color,
                            ...MONO,
                            fontWeight: 600,
                          }}
                        >
                          1h {change1h.text}
                        </span>
                      )}
                      {t.liquidity ? (
                        <span
                          style={{ fontSize: 9, color: "#1f5a3a", ...MONO }}
                        >
                          ${(t.liquidity / 1000).toFixed(0)}K liq
                        </span>
                      ) : null}
                      {t.mcap ? (
                        <span
                          style={{ fontSize: 9, color: "#2a2a2a", ...MONO }}
                        >
                          mc $
                          {t.mcap >= 1000
                            ? (t.mcap / 1000).toFixed(0) + "K"
                            : t.mcap}
                        </span>
                      ) : null}
                      <span style={{ fontSize: 7, color: "#1a1a1a", ...MONO }}>
                        {platformCount}src
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      ...MONO,
                      padding: "3px 7px",
                      borderRadius: 3,
                      color: sig.color,
                      border: `1px solid ${sig.color}44`,
                      background: `${sig.color}0d`,
                      whiteSpace: "nowrap" as const,
                    }}
                  >
                    {sig.label}
                  </span>
                  <span style={{ color: "#1e1e1e", fontSize: 8, ...MONO }}>
                    {t.score.toLocaleString()}
                  </span>
                  <span
                    style={{
                      color: isExpanded ? "#e8490f" : "#222",
                      fontSize: 8,
                      ...MONO,
                    }}
                  >
                    {isExpanded ? "▲ WHY" : "▼ WHY"}
                  </span>
                </div>
              </button>

              {isExpanded && <DecisionChain item={t} />}
            </div>
          );
        })}
      </div>

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
          <div style={{ display: "flex", gap: 10 }}>
            <span style={{ color: "#ffd70044", fontSize: 8, ...MONO }}>
              ⭐ {celebCount}
            </span>
            <span style={{ color: "#00c47a44", fontSize: 8, ...MONO }}>
              ⚡ {freshCount} fresh
            </span>
            <span style={{ color: "#ff660044", fontSize: 8, ...MONO }}>
              🔥 {viralCount}
            </span>
            <span style={{ color: "#00c47a33", fontSize: 8, ...MONO }}>
              SAFE: {trends.filter((t) => t.rugRisk === "low").length}
            </span>
          </div>
          <span
            style={{
              color: autoScan ? "#00c47a44" : "#222",
              fontSize: 8,
              ...MONO,
            }}
          >
            {autoScan ? `AUTO ${countdown}s` : "AUTO OFF"}
          </span>
        </div>
      )}
    </div>
  );
}
