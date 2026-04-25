"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import axios from "axios";
import { MemeTrend } from "@/app/app/page";

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
  // conviction fields from route
  twoXTier?: "ULTRA" | "HIGH" | "MEDIUM" | "LOW" | "SKIP";
  twoXScore?: number;
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
  twoXTier?: string;
  twoXScore?: number;
  crossPlatforms?: number;
  aiScore?: number;
  aiTier?: "HOT" | "WATCH" | "SKIP";
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
    const MAX_BYTES = 4 * 1024 * 1024; // 4MB guard — browser limit is 5MB
    let serialized = JSON.stringify(h);

    // If over limit, trim oldest 20% of entries until under limit
    if (serialized.length > MAX_BYTES) {
      const entries = Object.entries(h).sort(
        ([, a], [, b]) => a.seenAt - b.seenAt, // oldest first
      );
      const trimCount = Math.max(1, Math.floor(entries.length * 0.2));
      console.warn(
        `[saveHistory] localStorage near limit (${(serialized.length / 1024).toFixed(0)}KB) — trimming ${trimCount} oldest entries`,
      );
      const trimmed = Object.fromEntries(entries.slice(trimCount));
      serialized = JSON.stringify(trimmed);
    }

    localStorage.setItem(HISTORY_KEY, serialized);
  } catch (err) {
    console.error("[saveHistory] failed to write localStorage:", err);
  }
}

// ─── STALE TOKEN CLEANUP ──────────────────────────────────────────────────────
// Called at the top of every fetchTrends() to keep localStorage clean.
// Only removes tokens that: are >40min old AND haven't moved meaningfully.
// Winners (2x+), active movers, and celeb tokens are ALWAYS preserved.
function pruneStaleTokens() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
    const now = Date.now();
    const SCAN_STALE_MS = 40 * 60 * 1000; // 40 min — prune window for dead tokens
    const MAX_KEEP_MS = 3 * 24 * 60 * 60 * 1000; // 3 days — hard cap for everything
    let pruned = 0;
    for (const [key, v] of Object.entries(raw)) {
      const e = v as Record<string, unknown>;
      const seenAt = typeof e.seenAt === "number" ? e.seenAt : 0;
      const initialMcap = typeof e.initialMcap === "number" ? e.initialMcap : 0;
      const currentMcap = typeof e.currentMcap === "number" ? e.currentMcap : 0;
      const peakMcap = typeof e.peakMcap === "number" ? e.peakMcap : 0;
      const celebMention = !!e.celebMention;
      const age = now - seenAt;

      // Hard cap: nothing lives longer than 3 days
      if (age > MAX_KEEP_MS) {
        delete raw[key];
        pruned++;
        continue;
      }

      // Keep everything under 40min
      if (age <= SCAN_STALE_MS) continue;

      // Always keep winners (1.5x+ current or 2x+ peak)
      if (initialMcap > 0) {
        if (currentMcap >= initialMcap * 1.5) continue;
        if (peakMcap >= initialMcap * 2.0) continue;
      }

      // Always keep celeb tokens — they can pump days later
      if (celebMention) continue;

      // Token is >40min old with no meaningful price movement — prune it
      delete raw[key];
      pruned++;
    }
    if (pruned > 0) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(raw));
    }
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
    const best = pairs[0];
    return best.marketCap || best.fdv || null;
  } catch {
    return null;
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

const MIN_TRACK_MCAP = 2_000;
const MIN_TRACK_LIQUIDITY = 300;
const MIN_24H_CHANGE = -85;
const MAX_LIQ_TO_MCAP_RATIO = 0.6;

export function recordTokenSighting(result: ScanResult) {
  if (!result.contractAddress) return;
  if (isGarbageKeyword(result.keyword)) return;

  const mcap = result.mcap || 0;
  if (mcap > 0 && mcap < MIN_TRACK_MCAP) return;
  if (mcap > 500_000) return;

  const hasOnchain = (result.platforms || []).some((p) =>
    ["pumpfun", "dexscreener", "birdeye"].includes(p),
  );
  const isCeleb = !!result.celebMention || result.onCeleb;
  if (!hasOnchain && !isCeleb) return;

  const tier = result.twoXTier;
  if (!isCeleb) {
    if (!tier || tier === "LOW" || tier === "SKIP") return;
    if (tier === "MEDIUM" && (result.crossPlatforms ?? 0) < 2) return;
  } else {
    if (tier === "SKIP") return;
    if (!hasOnchain && tier === "LOW") return;
  }

  if ((result.priceChange24h ?? 0) < MIN_24H_CHANGE) return;

  if (
    (result.liquidity ?? 0) > 0 &&
    (result.liquidity ?? 0) < MIN_TRACK_LIQUIDITY
  )
    return;

  if (mcap > 0 && (result.liquidity ?? 0) > 0) {
    const liqRatio = (result.liquidity ?? 0) / mcap;
    if (liqRatio > MAX_LIQ_TO_MCAP_RATIO) return;
  }

  const h = loadHistory();
  const key = result.keyword;
  const now = Date.now();
  const crossPlatforms =
    result.crossPlatforms ?? (result.platforms || []).length;

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
      twoXTier: tier,
      twoXScore: result.twoXScore,
      crossPlatforms,
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
    if (tier) h[key].twoXTier = tier;
    if (result.twoXScore !== undefined) h[key].twoXScore = result.twoXScore;
    h[key].crossPlatforms = Math.max(
      h[key].crossPlatforms ?? 0,
      crossPlatforms,
    );

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

  postToServerHistory(result, mcap, tier, crossPlatforms);
}

async function postToServerHistory(
  result: ScanResult,
  mcap: number,
  tier: string | undefined,
  crossPlatforms: number,
) {
  const payload = {
    keyword: result.keyword,
    displayName: result.tokenName,
    tokenSymbol: result.tokenSymbol,
    tokenImageUrl: result.tokenImageUrl,
    contractAddress: result.contractAddress,
    celebMention: result.celebMention,
    aiContext: result.aiContext,
    platforms: result.platforms ?? [],
    mcap,
    twoXTier: tier ?? "MEDIUM",
    crossPlatforms,
  };

  // ── Retry helper — 2 attempts with 2s delay ──────────────────────────────
  async function fetchWithRetry(
    url: string,
    options: RequestInit,
    attempts = 2,
    delayMs = 2000,
  ): Promise<Response | null> {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(url, options);
        if (res.ok) return res;
        console.warn(
          `[postToServerHistory] ${url} attempt ${i + 1} returned HTTP ${res.status}`,
        );
      } catch (err) {
        console.warn(
          `[postToServerHistory] ${url} attempt ${i + 1} network error:`,
          err,
        );
      }
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    console.error(
      `[postToServerHistory] ${url} failed after ${attempts} attempts — token ${result.keyword} not recorded`,
    );
    return null;
  }

  // ── 1. Post to /api/history ───────────────────────────────────────────────
  let isNewToken = false;
  const historyRes = await fetchWithRetry("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!historyRes) return; // both attempts failed — bail out

  try {
    const data = await historyRes.json();
    isNewToken = data.isNew === true;
  } catch (err) {
    console.error(
      "[postToServerHistory] failed to parse /api/history response:",
      err,
    );
    return;
  }

  if (!isNewToken) return;

  // ── 2. AI scoring ─────────────────────────────────────────────────────────
  let aiScore = 50;
  let aiTier: "HOT" | "WATCH" | "SKIP" = "WATCH";
  let aiReason = "";

  const scoreRes = await fetchWithRetry("/api/ai-score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      keyword: result.keyword,
      contractAddress: result.contractAddress,
      mcap,
      tier: tier ?? "MEDIUM",
      platforms: result.platforms ?? [],
      celebMention: result.celebMention,
      aiContext: result.aiContext,
      liquidity: result.liquidity,
      priceChange24h: result.priceChange24h,
      crossPlatforms,
    }),
  });

  if (scoreRes) {
    try {
      const scoreData = await scoreRes.json();
      if (typeof scoreData.score === "number") aiScore = scoreData.score;
      if (
        scoreData.tier === "HOT" ||
        scoreData.tier === "WATCH" ||
        scoreData.tier === "SKIP"
      ) {
        aiTier = scoreData.tier;
      }
      if (typeof scoreData.reason === "string") aiReason = scoreData.reason;
    } catch (err) {
      console.error(
        "[postToServerHistory] failed to parse /api/ai-score response:",
        err,
      );
    }
  }

  // ── 3. Update localStorage with AI score ─────────────────────────────────
  const h = loadHistory();
  if (h[result.keyword]) {
    h[result.keyword].aiScore = aiScore;
    h[result.keyword].aiTier = aiTier;
    saveHistory(h);
  }

  // ── 4. Persist AI score back to server ───────────────────────────────────
  await fetchWithRetry("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, aiScore, aiTier }),
  });

  if (aiTier === "SKIP") return;

  // ── 5. Telegram alert ─────────────────────────────────────────────────────
  await fetchWithRetry("/api/alert/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "entry",
      symbol: (result.tokenSymbol ?? result.keyword).toUpperCase(),
      keyword: result.keyword,
      mcap,
      contractAddress: result.contractAddress,
      celebMention: result.celebMention,
      aiContext: result.aiContext,
      platforms: result.platforms ?? [],
      twoXTier: tier ?? "MEDIUM",
      seenAt: Date.now(),
      aiScore,
      aiTier,
      aiReason,
    }),
  });
}

function getAgeDisplay(ageMinutes: number | undefined) {
  if (ageMinutes === undefined)
    return { label: "", color: "#555", isStale: false, isFresh: false };
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
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
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
  unknown: "#555",
};

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
          border: "1px solid #2a2a2a",
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

function ConvictionBadge({ tier, score }: { tier?: string; score?: number }) {
  if (!tier || tier === "SKIP" || tier === "LOW") return null;
  const cfg =
    tier === "ULTRA"
      ? { label: "🔥 ULTRA", color: "#ffd700", bg: "#120c00" }
      : tier === "HIGH"
        ? { label: "⚡ HIGH", color: "#00c47a", bg: "#001610" }
        : { label: "✦ MED", color: "#ffaa00", bg: "#0e0800" };
  return (
    <span
      style={{
        fontSize: 8,
        fontWeight: 700,
        ...MONO,
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.color}44`,
        padding: "1px 5px",
        borderRadius: 2,
        letterSpacing: "0.06em",
      }}
    >
      {cfg.label}
      {score !== undefined ? ` ${score}` : ""}
    </span>
  );
}

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

  const backendScore = item.twoXScore;
  const backendTier = item.twoXTier;

  let confidence: number;
  let confidenceLabel: string;
  let confidenceColor: string;

  if (backendScore !== undefined && backendTier && backendTier !== "SKIP") {
    confidence = backendScore;
    if (backendTier === "ULTRA") {
      confidenceLabel = "ULTRA HIGH";
      confidenceColor = "#ffd700";
    } else if (backendTier === "HIGH") {
      confidenceLabel = "HIGH";
      confidenceColor = "#00c47a";
    } else if (backendTier === "MEDIUM") {
      confidenceLabel = "MODERATE";
      confidenceColor = "#ffaa00";
    } else {
      confidenceLabel = "LOW";
      confidenceColor = "#ff6600";
    }
  } else {
    const hasCeleb = item.onCeleb;
    const hasAI = item.onAI;
    const hasOnchain = platforms.some((p) =>
      ["pumpfun", "dexscreener"].includes(p),
    );
    const hasSocial = platforms.some((p) =>
      ["reddit", "twitter", "google-trends", "youtube", "kym"].includes(p),
    );
    const platformCount = platforms.length;

    confidence = 20;
    confidenceLabel = "SPECULATIVE";
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
        borderTop: "1px solid #111",
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
              color: "#666",
              fontSize: 9,
              ...MONO,
              letterSpacing: "0.14em",
            }}
          >
            WRAITH CONFIDENCE
          </span>
          <span
            style={{
              color: confidenceColor,
              fontSize: 11,
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
            background: "#1a1a1a",
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
            color: "#555",
            fontSize: 8,
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
                  fontSize: 9,
                  fontWeight: 700,
                  ...MONO,
                  letterSpacing: "0.1em",
                }}
              >
                {sig.label}
              </div>
              <div
                style={{
                  color: "#666",
                  fontSize: 10,
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
          <div style={{ color: "#444", fontSize: 10, ...MONO }}>
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
                fontSize: 8,
                ...MONO,
                color: PLATFORM_META[p].color,
                border: `1px solid ${PLATFORM_META[p].color}33`,
                padding: "2px 6px",
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

// ─── 10 MINUTE SCAN INTERVAL ──────────────────────────────────────────────────
const REFRESH_INTERVAL = 600; // 10 minutes (was 90s)

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
    | "all"
    | "celeb"
    | "new"
    | "viral"
    | "social"
    | "onchain"
    | "safe"
    | "fresh"
    | "ultra"
  >("all");
  const [expandedDecision, setExpandedDecision] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

      // ─── PRUNE STALE TOKENS BEFORE EACH SCAN ──────────────────────────────
      pruneStaleTokens();

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
        if (axios.isAxiosError(err) && err.response?.status === 429) {
          setError("Rate limit — wait ~2 min before next scan");
          setAutoScan(false);
        } else {
          setError(`Scan failed: ${msg}`);
        }
      } finally {
        setLoading(false);
        loadingRef.current = false;
        setTimeout(() => setProgress(0), 600);
      }
    },
    [selectedMeme, onSelectMeme, enrichWithTokenMeta],
  );

  useEffect(() => {
    const cached =
      typeof window !== "undefined"
        ? JSON.parse(localStorage.getItem("wraith_token_history_v2") || "{}")
        : {};
    const hasRecent = Object.values(cached).some(
      (e: any) => Date.now() - (e as any).seenAt < 5 * 60 * 1000,
    );
    if (!hasRecent) {
      fetchTrends();
    } else {
      setLastScan("cached");
      setCountdown(REFRESH_INTERVAL);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return { label: "WATCH", color: "#555" };
  };

  const filtered = trends.filter((t) => {
    const p = t.platforms || [];
    if (filter === "celeb") return t.onCeleb || p.includes("celebrity");
    if (filter === "new") return t.isNewCoin;
    if (filter === "fresh") return (t.ageMinutes || Infinity) < 1440;
    if (filter === "ultra")
      return t.twoXTier === "ULTRA" || t.twoXTier === "HIGH";
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
  const ultraCount = trends.filter(
    (t) => t.twoXTier === "ULTRA" || t.twoXTier === "HIGH",
  ).length;

  const TABS: { key: typeof filter; label: string; color?: string }[] = [
    { key: "all", label: "ALL" },
    { key: "ultra", label: "🔥 ULTRA/HIGH", color: "#ffd700" },
    { key: "celeb", label: "⭐ CELEB", color: "#ffd700" },
    { key: "fresh", label: "⚡ FRESH", color: "#00c47a" },
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

  // Format countdown as mm:ss for 10min display
  const countdownDisplay =
    countdown >= 60
      ? `${Math.floor(countdown / 60)}m ${countdown % 60}s`
      : `${countdown}s`;

  return (
    <div
      style={{
        background: "#060606",
        border: "1px solid #1a1a1a",
        borderRadius: 8,
        overflow: "hidden",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          borderBottom: "1px solid #1a1a1a",
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
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.18em",
                ...MONO,
              }}
            >
              WRAITH SCANNER
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
                fontSize: 10,
                ...MONO,
              }}
            >
              {loading ? "SCANNING" : enriching ? "ENRICHING" : "LIVE"}
            </span>
            {!loading && ultraCount > 0 && (
              <span
                style={{
                  fontSize: 9,
                  ...MONO,
                  color: "#ffd700",
                  border: "1px solid #ffd70033",
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: "#120c0022",
                }}
              >
                🔥 {ultraCount} HOT
              </span>
            )}
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
          <div style={{ color: "#666", fontSize: 10, marginTop: 3, ...MONO }}>
            {loading
              ? scanLog[scanLog.length - 1] || "Initializing..."
              : enriching
                ? "Fetching real token names + images from DexScreener..."
                : lastScan
                  ? `${lastScan} · ${trends.length} signals · next scan ${countdownDisplay}`
                  : "Elon · Trump · TikTok · YouTube · Reddit · Pump.fun · DexScreener"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => setAutoScan((v) => !v)}
            style={{
              background: autoScan ? "#001a08" : "#111",
              border: `1px solid ${autoScan ? "#00c47a44" : "#222"}`,
              color: autoScan ? "#00c47a" : "#555",
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

      {/* Progress bar */}
      {loading && (
        <div
          style={{
            background: "#050505",
            borderBottom: "1px solid #111",
            padding: "10px 16px",
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
                    color: step === i ? "#e8490f" : step > i ? "#444" : "#333",
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

      {/* Filter tabs */}
      <div
        style={{
          padding: "5px 10px",
          borderBottom: "1px solid #111",
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
                color: active ? col : "#555",
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
              color: "#222",
              fontSize: 28,
              ...MONO,
              letterSpacing: "0.3em",
            }}
          >
            WRAITH
          </div>
          <div style={{ color: "#444", fontSize: 10, ...MONO }}>
            {filter === "celeb"
              ? "NO CELEB SIGNALS"
              : filter === "safe"
                ? "NO SAFE TOKENS"
                : filter === "fresh"
                  ? "NO FRESH TOKENS YET — SCAN NOW"
                  : filter === "ultra"
                    ? "NO HIGH/ULTRA CONVICTION TOKENS YET"
                    : "HUNTING..."}
          </div>
        </div>
      )}

      {/* Token list */}
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
            <div key={t.keyword} style={{ borderBottom: "1px solid #0d0d0d" }}>
              <button
                onClick={() => {
                  onSelectMeme(t);
                  setExpandedDecision(isExpanded ? null : t.keyword);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
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
                  opacity: qualityWarning ? 0.6 : ageDisplay.isStale ? 0.4 : 1,
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
                      color: "#444",
                      fontSize: 10,
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
                        marginBottom: 3,
                      }}
                    >
                      <span
                        style={{
                          color: isCeleb
                            ? "#ffd700"
                            : ageDisplay.isStale
                              ? "#666"
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
                            color: "#555",
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
                      <ConvictionBadge tier={t.twoXTier} score={t.twoXScore} />
                      {ageDisplay.label && (
                        <span
                          style={{
                            fontSize: 8,
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
                            fontSize: 8,
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
                            fontSize: 8,
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
                            fontSize: 8,
                            color: "#555",
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
                                fontSize: 8,
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
                            fontSize: 8,
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
                          color: "#ffd70066",
                          ...MONO,
                          marginBottom: 2,
                          maxWidth: 200,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap" as const,
                        }}
                      >
                        ⭐ {t.aiContext.slice(0, 55)}
                      </div>
                    )}
                    {!isCeleb && t.aiContext && (
                      <div
                        style={{
                          fontSize: 9,
                          color: "#555",
                          ...MONO,
                          maxWidth: 200,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap" as const,
                          marginBottom: 2,
                        }}
                      >
                        ✦ {t.aiContext.slice(0, 55)}
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
                            fontSize: 10,
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
                          style={{ fontSize: 9, color: "#3a8a60", ...MONO }}
                        >
                          ${(t.liquidity / 1000).toFixed(0)}K liq
                        </span>
                      ) : null}
                      {t.mcap ? (
                        <span style={{ fontSize: 9, color: "#555", ...MONO }}>
                          mc $
                          {t.mcap >= 1000
                            ? (t.mcap / 1000).toFixed(0) + "K"
                            : t.mcap}
                        </span>
                      ) : null}
                      <span style={{ fontSize: 8, color: "#444", ...MONO }}>
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
                  <span style={{ color: "#555", fontSize: 9, ...MONO }}>
                    {t.score.toLocaleString()}
                  </span>
                  <span
                    style={{
                      color: isExpanded ? "#e8490f" : "#444",
                      fontSize: 9,
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

      {/* Footer */}
      {trends.length > 0 && (
        <div
          style={{
            borderTop: "1px solid #111",
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
            <span style={{ color: "#ffd70066", fontSize: 9, ...MONO }}>
              🔥 {ultraCount} hot
            </span>
            <span style={{ color: "#ffd70066", fontSize: 9, ...MONO }}>
              ⭐ {celebCount}
            </span>
            <span style={{ color: "#00c47a66", fontSize: 9, ...MONO }}>
              ⚡ {freshCount} fresh
            </span>
            <span style={{ color: "#ff660066", fontSize: 9, ...MONO }}>
              viral {viralCount}
            </span>
            <span style={{ color: "#00c47a55", fontSize: 9, ...MONO }}>
              SAFE: {trends.filter((t) => t.rugRisk === "low").length}
            </span>
          </div>
          <span
            style={{
              color: autoScan ? "#00c47a66" : "#333",
              fontSize: 9,
              ...MONO,
            }}
          >
            {autoScan ? `AUTO ${countdownDisplay}` : "AUTO OFF"}
          </span>
        </div>
      )}
    </div>
  );
}
