import { NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

async function safeFetch(url: string, ms = 8000): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json, text/html, */*",
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return r.ok ? r : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

function computeSafetyScore(params: {
  rugRisk: string;
  liquidity: number;
  mcap: number;
  priceChange1h: number;
  crossPlatforms: number;
  hasContract: boolean;
}): {
  score: number;
  breakdown: { label: string; pass: boolean; detail: string }[];
} {
  const checks: {
    label: string;
    pass: boolean;
    detail: string;
    weight: number;
  }[] = [];

  const rugPass = params.rugRisk === "low";
  const rugMed = params.rugRisk === "medium";
  checks.push({
    label: "RUGCHECK SCAN",
    pass: rugPass,
    weight: 35,
    detail: rugPass
      ? "Passed Rugcheck.xyz — no mint/freeze authority issues"
      : rugMed
        ? "Medium risk detected — check manually before buying"
        : params.rugRisk === "high"
          ? "DANGER: High rug risk flags detected"
          : "Not yet checked — no contract address",
  });

  const liqPass = params.liquidity >= 10000;
  checks.push({
    label: "LIQUIDITY DEPTH",
    pass: liqPass,
    weight: 20,
    detail:
      params.liquidity > 0
        ? `$${(params.liquidity / 1000).toFixed(1)}K — ${params.liquidity >= 50000 ? "strong" : params.liquidity >= 10000 ? "adequate" : "very low — easy to drain"}`
        : "No liquidity data available",
  });

  const pricePass = params.priceChange1h < 400 && params.priceChange1h > -70;
  checks.push({
    label: "PRICE SANITY",
    pass: pricePass,
    weight: 15,
    detail:
      params.priceChange1h !== 0
        ? `1h: ${params.priceChange1h > 0 ? "+" : ""}${params.priceChange1h.toFixed(0)}% — ${params.priceChange1h > 400 ? "already 4x'd, likely too late" : params.priceChange1h < -70 ? "dumping hard" : "within normal range"}`
        : "No price data yet",
  });

  const crossPass = params.crossPlatforms >= 2;
  checks.push({
    label: "MULTI-SOURCE VERIFY",
    pass: crossPass,
    weight: 20,
    detail: `Detected on ${params.crossPlatforms} source(s) — ${params.crossPlatforms >= 4 ? "very strong confirmation" : params.crossPlatforms >= 2 ? "good confirmation" : "single source — treat with skepticism"}`,
  });

  checks.push({
    label: "CONTRACT EXISTS",
    pass: params.hasContract,
    weight: 10,
    detail: params.hasContract
      ? "Token is deployed on-chain"
      : "No contract yet — pre-launch viral trend",
  });

  let score = 0;
  let maxScore = 0;
  for (const c of checks) {
    maxScore += c.weight;
    if (c.pass) score += c.weight;
    else if (c.label === "RUGCHECK SCAN" && params.rugRisk === "medium")
      score += c.weight * 0.4;
    else if (c.label === "LIQUIDITY DEPTH" && params.liquidity > 3000)
      score += c.weight * 0.4;
  }

  return {
    score: Math.round((score / maxScore) * 100),
    breakdown: checks.map(({ label, pass, detail }) => ({
      label,
      pass,
      detail,
    })),
  };
}

function buildPrediction(
  safetyScore: number,
  crossPlatforms: number,
  mcap: number,
  isViral: boolean,
  isCeleb: boolean,
): { prediction: "strong" | "moderate" | "weak" | "avoid"; reason: string } {
  if (safetyScore < 30)
    return {
      prediction: "avoid",
      reason:
        "Too many red flags — high probability of rug or dump. Do not invest.",
    };
  if (isCeleb && safetyScore >= 50)
    return {
      prediction: "strong",
      reason:
        "Celebrity-backed trend with acceptable safety profile. These move fast — act quickly or it's too late.",
    };
  if (safetyScore >= 70 && crossPlatforms >= 3 && mcap < 500000)
    return {
      prediction: "strong",
      reason: `Strong signal: safe token, trending on ${crossPlatforms}+ platforms, low mcap means high upside potential.`,
    };
  if (safetyScore >= 50 && crossPlatforms >= 2)
    return {
      prediction: "moderate",
      reason:
        "Moderate signal: passes basic safety checks and confirmed on multiple sources. DYOR before buying.",
    };
  if (isViral && safetyScore >= 40)
    return {
      prediction: "moderate",
      reason:
        "Viral trend with acceptable safety profile. Watch for a coin to launch if none exists yet.",
    };
  return {
    prediction: "weak",
    reason:
      "Weak signal: limited cross-platform confirmation or marginal safety score. High risk.",
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("keyword") || "";
  const contract = searchParams.get("contract") || "";
  const platformsStr = searchParams.get("platforms") || "";
  const context = searchParams.get("context") || "";
  const celebMention = searchParams.get("celebMention") || "";
  const mcap = parseFloat(searchParams.get("mcap") || "0");
  const liquidity = parseFloat(searchParams.get("liquidity") || "0");
  const rugRisk = searchParams.get("rugRisk") || "unknown";
  const priceChange1h = parseFloat(searchParams.get("priceChange1h") || "0");
  const platforms = platformsStr ? platformsStr.split(",") : [];
  const crossPlatforms = platforms.length;
  const isCeleb = !!celebMention;
  const isViral = platforms.some((p) =>
    ["google-trends", "youtube", "kym", "tiktok", "celebrity"].includes(p),
  );

  const { score: safetyScore, breakdown: safetyBreakdown } = computeSafetyScore(
    {
      rugRisk,
      liquidity,
      mcap,
      priceChange1h,
      crossPlatforms,
      hasContract: !!contract,
    },
  );

  const { prediction, reason: predictionReason } = buildPrediction(
    safetyScore,
    crossPlatforms,
    mcap,
    isViral,
    isCeleb,
  );

  // Evidence links
  const evidenceLinks: { url: string; platform: string; title: string }[] = [];

  const [redditRes, newsRes, ytRes, ytSearch] = await Promise.all([
    safeFetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&sort=hot&limit=5&raw_json=1`,
    ),
    safeFetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(keyword + (celebMention ? ` ${celebMention}` : " coin OR meme OR viral"))}&hl=en-US&gl=US&ceid=US:en`,
    ),
    safeFetch(
      `https://www.youtube.com/feeds/videos.xml?search_query=${encodeURIComponent(keyword + (celebMention ? ` ${celebMention}` : ""))}`,
    ),
    celebMention
      ? safeFetch(
          `https://news.google.com/rss/search?q=${encodeURIComponent(celebMention + " tweet post today")}&hl=en-US&gl=US&ceid=US:en`,
        )
      : Promise.resolve(null),
  ]);

  if (redditRes) {
    try {
      const data = await redditRes.json();
      for (const post of (data?.data?.children || []).slice(0, 4)) {
        const p = post.data;
        if (!p.url || !p.title) continue;
        evidenceLinks.push({
          url: `https://reddit.com${p.permalink}`,
          platform: "reddit",
          title: `r/${p.subreddit} — ${p.title.slice(0, 80)} (${p.score} upvotes)`,
        });
      }
    } catch {
      /* skip */
    }
  }

  if (newsRes) {
    try {
      const xml = await newsRes.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items.slice(0, 5)) {
        const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
        const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
        const title = (titleMatch?.[1] || "")
          .replace(/<!\[CDATA\[|\]\]>/g, "")
          .replace(/<[^>]+>/g, "")
          .trim();
        const link = (linkMatch?.[1] || "").trim();
        if (title && link)
          evidenceLinks.push({
            url: link,
            platform: "google-news",
            title: title.slice(0, 100),
          });
      }
    } catch {
      /* skip */
    }
  }

  if (ytRes) {
    try {
      const xml = await ytRes.text();
      const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
      for (const entry of entries.slice(0, 3)) {
        const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
        const idMatch = entry.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/);
        const title = (titleMatch?.[1] || "")
          .replace(/<!\[CDATA\[|\]\]>/g, "")
          .trim();
        const videoId = idMatch?.[1]?.trim();
        if (title && videoId)
          evidenceLinks.push({
            url: `https://youtube.com/watch?v=${videoId}`,
            platform: "youtube",
            title: title.slice(0, 100),
          });
      }
    } catch {
      /* skip */
    }
  }

  if (ytSearch) {
    try {
      const xml = await ytSearch.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items.slice(0, 3)) {
        const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
        const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
        const title = (titleMatch?.[1] || "")
          .replace(/<!\[CDATA\[|\]\]>/g, "")
          .replace(/<[^>]+>/g, "")
          .trim();
        const link = (linkMatch?.[1] || "").trim();
        if (title && link)
          evidenceLinks.push({
            url: link,
            platform: "celebrity",
            title: `🌟 ${celebMention}: ${title.slice(0, 80)}`,
          });
      }
    } catch {
      /* skip */
    }
  }

  if (contract) {
    evidenceLinks.push({
      url: `https://dexscreener.com/solana/${contract}`,
      platform: "dexscreener",
      title: `$${keyword.toUpperCase()} on DexScreener — live chart & trades`,
    });
  }

  // Gemini AI analysis — REAL analysis, not echo
  let aiAnalysis = "";
  if (GEMINI_API_KEY && keyword) {
    try {
      const celebContext = celebMention
        ? `\nKEY FACT: ${celebMention} is connected to this trend. Find EXACTLY what they said/did and when.`
        : "";

      // Build a prompt that forces real research, not just echoing context
      const prompt = `You are a Solana meme coin analyst. Search the web for current information about "$${keyword.toUpperCase()}" RIGHT NOW.

DO NOT just repeat this context string back to me: "${context}"
Instead, SEARCH FOR and find NEW information about this token/trend.

Known data:
- Token: $${keyword.toUpperCase()}
- Market cap: ${mcap ? `$${(mcap / 1000).toFixed(0)}K` : "unknown"}
- Liquidity: ${liquidity ? `$${(liquidity / 1000).toFixed(0)}K` : "unknown"}
- Platforms found on: ${platforms.join(", ") || "unknown"}
- Safety score: ${safetyScore}/100
- Rug risk: ${rugRisk}
- 1h price change: ${priceChange1h ? `${priceChange1h > 0 ? "+" : ""}${priceChange1h.toFixed(0)}%` : "unknown"}${celebContext}

Write 3 paragraphs of ORIGINAL analysis based on what you find:

PARAGRAPH 1 — VIRAL ORIGIN: What is the EXACT viral moment, tweet, TikTok, news event, or meme that created buzz around "$${keyword.toUpperCase()}"? Search for it. Name dates, accounts, view counts. If it's a new coin, where was it launched and what is the theme?

PARAGRAPH 2 — RISK REALITY CHECK: Look at the on-chain data. Is the liquidity real? What does the price action tell you? Is this coin already 10x'd (too late) or early (opportunity)? Any red flags? Be brutally specific.

PARAGRAPH 3 — TRADER'S VERDICT: Based on market cap (${mcap ? `$${(mcap / 1000).toFixed(0)}K` : "unknown"}), should someone buy NOW, WAIT, or AVOID? If buy, at what conditions? Give a real recommendation with numbers.

Max 220 words. Be direct. No hedging. No fluff.`;

      const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.25, maxOutputTokens: 700 },
        }),
        signal: AbortSignal.timeout(22000),
      });

      if (res.ok) {
        const data = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        // Ensure we got actual analysis and not just a repeat of context
        if (raw.length > 100 && !raw.startsWith(context.slice(0, 30))) {
          aiAnalysis = raw;
        } else if (raw.length > 100) {
          // It echoed context, try to strip it and use what's left
          aiAnalysis = raw.replace(context.slice(0, 50), "").trim() || raw;
        }
      }
    } catch {
      /* silent */
    }
  }

  // Fallback: build a meaningful analysis from the data we have
  if (!aiAnalysis || aiAnalysis.length < 80) {
    const mcapLabel =
      mcap >= 1_000_000
        ? `$${(mcap / 1_000_000).toFixed(1)}M`
        : mcap >= 1000
          ? `$${(mcap / 1000).toFixed(0)}K`
          : mcap
            ? `$${mcap}`
            : "unknown";
    const liqLabel =
      liquidity >= 1000
        ? `$${(liquidity / 1000).toFixed(0)}K`
        : liquidity
          ? `$${liquidity}`
          : "unknown";
    const platformList = platforms.join(", ") || "unknown";

    aiAnalysis =
      `$${keyword.toUpperCase()} was detected across ${crossPlatforms} platform(s): ${platformList}. ${context ? context : "No specific viral trigger identified — may be purely on-chain activity."}\n\n` +
      `On-chain snapshot: market cap ${mcapLabel}, liquidity ${liqLabel}, rug risk ${rugRisk}. ` +
      `${liquidity < 10000 && liquidity > 0 ? "⚠ Liquidity is very low — this can be drained in seconds. " : ""}` +
      `${priceChange1h > 200 ? `⚠ Already up ${priceChange1h.toFixed(0)}% in 1h — may be late. ` : ""}` +
      `Safety score ${safetyScore}/100 — ${safetyScore >= 70 ? "passes basic checks" : safetyScore >= 40 ? "use caution" : "high risk, do not buy"}.\n\n` +
      `Verdict: ${predictionReason}`;
  }

  return NextResponse.json({
    safetyScore,
    safetyBreakdown,
    prediction,
    predictionReason,
    links: evidenceLinks,
    aiAnalysis,
  });
}
