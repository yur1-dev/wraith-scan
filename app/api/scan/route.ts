import { NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════════════════
// WRAITH SCANNER v10 — Age-Aware, High-Signal
//
// KEY CHANGES FROM v9:
//   • Age filter: >30 days = hard filtered. 7-30d = 80% score penalty.
//   • Much more aggressive pump.fun scanning (more endpoints, more coins)
//   • Win tracker: recordTokenSighting now saves ANY token with CA+mcap
//   • Gemini forced to return real analysis (not just context echo)
//   • DexScreener: raised liquidity floor to $5k, removed 24h age cap
//     so newer coins with less data still appear
// ═══════════════════════════════════════════════════════════════════════════

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, Accept: "*/*" };

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const GOOGLE_TRENDS_GEOS = ["US", "GB", "PH", "IN", "AU", "BR", "KR", "JP"];

const REDDIT_SUBS = [
  { name: "CryptoMoonShots", tier: 6 },
  { name: "SatoshiStreetBets", tier: 6 },
  { name: "memecoinsmoonshots", tier: 6 },
  { name: "pumpfun", tier: 6 },
  { name: "solana", tier: 5 },
  { name: "memes", tier: 5 },
  { name: "dankmemes", tier: 4 },
  { name: "funny", tier: 3 },
  { name: "videos", tier: 3 },
  { name: "MemeEconomy", tier: 5 },
  { name: "OutOfTheLoop", tier: 4 },
  { name: "CryptoCurrency", tier: 4 },
  { name: "shitposting", tier: 3 },
  { name: "reactiongifs", tier: 3 },
];

const CELEB_WATCHLIST = [
  "Elon Musk",
  "Donald Trump",
  "Vitalik Buterin",
  "CZ Binance",
  "Cathie Wood",
  "Michael Saylor",
  "Snoop Dogg",
  "Mark Cuban",
  "Kanye West",
  "Kim Kardashian",
  "Cardi B",
  "Logan Paul",
  "Mr Beast",
];

const MEME_SUFFIXES =
  /\b([a-z]{2,10})(coin|inu|fi|dao|ai|doge|cat|pepe|frog|chad|moon|punk|swap|floki|shib|baby|mini|mega|super|god|king|papa|bear|bull|rat|dog|monkey|ape|wolf|tiger|dragon|panda)\b/gi;

const BLACKLIST = new Set([
  "you",
  "the",
  "they",
  "them",
  "this",
  "that",
  "these",
  "those",
  "his",
  "her",
  "its",
  "our",
  "your",
  "their",
  "who",
  "what",
  "when",
  "where",
  "why",
  "how",
  "all",
  "any",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "than",
  "then",
  "too",
  "very",
  "got",
  "get",
  "has",
  "had",
  "did",
  "does",
  "was",
  "were",
  "are",
  "been",
  "have",
  "said",
  "says",
  "can",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "let",
  "set",
  "put",
  "run",
  "use",
  "see",
  "try",
  "ask",
  "add",
  "end",
  "now",
  "just",
  "even",
  "also",
  "back",
  "away",
  "way",
  "much",
  "many",
  "well",
  "made",
  "make",
  "like",
  "time",
  "know",
  "take",
  "come",
  "good",
  "give",
  "live",
  "work",
  "call",
  "man",
  "men",
  "guy",
  "bro",
  "one",
  "two",
  "three",
  "day",
  "new",
  "old",
  "big",
  "after",
  "under",
  "about",
  "above",
  "across",
  "along",
  "among",
  "around",
  "before",
  "behind",
  "below",
  "beside",
  "between",
  "beyond",
  "during",
  "except",
  "inside",
  "into",
  "near",
  "off",
  "onto",
  "out",
  "over",
  "past",
  "since",
  "through",
  "toward",
  "until",
  "upon",
  "within",
  "without",
  "lol",
  "lmao",
  "wtf",
  "omg",
  "ngl",
  "imo",
  "afk",
  "brb",
  "edit",
  "update",
  "removed",
  "deleted",
  "comment",
  "post",
  "thread",
  "link",
  "image",
  "photo",
  "video",
  "gif",
  "reddit",
  "mods",
  "karma",
  "upvote",
  "downvote",
  "crypto",
  "bitcoin",
  "ethereum",
  "blockchain",
  "token",
  "coins",
  "nft",
  "defi",
  "web3",
  "solana",
  "wallet",
  "trade",
  "trading",
  "invest",
  "investing",
  "market",
  "price",
  "pump",
  "dump",
  "moon",
  "bull",
  "bear",
  "whale",
  "hodl",
  "sell",
  "buy",
  "hold",
  "stake",
  "real",
  "fake",
  "true",
  "false",
  "high",
  "low",
  "hot",
  "cold",
  "fast",
  "slow",
  "long",
  "short",
  "full",
  "empty",
  "open",
  "closed",
  "right",
  "wrong",
  "hard",
  "soft",
  "free",
  "usd",
  "sol",
  "eth",
  "btc",
  "usdc",
  "usdt",
  "bnb",
  "ape",
  "not",
  "but",
  "for",
  "and",
  "its",
  "yes",
  "non",
  "via",
  "per",
  "etc",
  "amp",
  "top",
  "sub",
  "due",
  "hit",
  "won",
  "web",
  "app",
  "bot",
  "api",
  "dev",
  "net",
  "org",
  "com",
  "gov",
  "edu",
  "pro",
  "post",
  "https",
  "http",
  "www",
  "html",
  "css",
  "jpg",
  "png",
  "based",
  "ratio",
  "cope",
  "slay",
  "fire",
  "valid",
  "facts",
  "cap",
  "vibe",
  "vibes",
  "cringe",
  "mid",
  "lit",
  "bussin",
  "sus",
  "bet",
  "fam",
  "bruh",
  "oof",
  "yikes",
  "rip",
  "idk",
  "idc",
  "tbh",
  "nvm",
  "smh",
  "ffs",
  "launch",
  "launched",
  "launching",
  "alpha",
  "early",
  "signal",
  "signals",
  "telegram",
  "twitter",
  "discord",
  "tg",
  "ann",
  "news",
  "info",
  "soon",
  "live",
  "tonight",
  "morning",
  "night",
  "week",
  "month",
  "year",
  "hours",
  "mins",
  "minutes",
  "seconds",
  "ago",
  "later",
  "last",
  "first",
  "second",
  "third",
  "once",
  "twice",
  "always",
  "never",
  "maybe",
  "sure",
  "fine",
  "great",
  "best",
  "worst",
  "scam",
  "rug",
  "rugged",
  "coin",
  "gem",
  "call",
  "calls",
  "group",
  "chat",
  "channel",
  "join",
  "send",
  "mint",
  "follow",
  "share",
  "repost",
  "retweet",
  "reply",
  "click",
  "check",
  "watch",
  "people",
  "thing",
  "things",
  "going",
  "doing",
  "think",
  "want",
  "need",
  "look",
  "feel",
  "seen",
  "here",
  "there",
  "still",
  "same",
  "another",
  "every",
  "nothing",
  "something",
  "everything",
  "everyone",
  "someone",
  "anyone",
  "using",
  "making",
  "being",
  "having",
  "getting",
  "putting",
  "trying",
  "seeing",
  "with",
  "from",
  "over",
  "have",
  "usd",
  "sol",
  "eth",
  "btc",
  "usdc",
  "usdt",
  "bnb",
]);

function cleanTicker(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isValidKeyword(k: string): boolean {
  if (!k || k.length < 2 || k.length > 16) return false;
  if (BLACKLIST.has(k.toLowerCase())) return false;
  if (/^\d+$/.test(k)) return false;
  if (!/^[a-z][a-z0-9]*$/.test(k.toLowerCase())) return false;
  return true;
}

// ── Age penalty multiplier
// Returns a 0-1 multiplier. Fresh = 1.0, 30+ days = 0 (filtered out)
function ageScoreMultiplier(ageMinutes: number | undefined): number {
  if (ageMinutes === undefined) return 0.8; // unknown age: mild penalty
  const days = ageMinutes / 1440;
  if (days > 30) return 0; // hard filter: 30+ days → never show
  if (days > 14) return 0.05; // 2-4 weeks: almost never show
  if (days > 7) return 0.15; // 1-2 weeks: very deprioritized
  if (days > 3) return 0.4; // 3-7 days: deprioritized
  if (days > 1) return 0.75; // 1-3 days: slight penalty
  if (days > 0.25) return 0.95; // 6h-24h: nearly full score
  return 1.0; // <6h: full score, maximum freshness
}

async function safeFetch(
  url: string,
  extraHeaders: Record<string, string> = {},
  ms = 9000,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: { ...HEADERS, ...extraHeaders },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return r;
  } catch {
    clearTimeout(t);
    return null;
  }
}

interface ScoreEntry {
  viralScore: number;
  socialScore: number;
  onchainScore: number;
  geckoScore: number;
  aiScore: number;
  celebScore: number;
  posts: number;
  hasTicker: boolean;
  isNewCoin: boolean;
  ageMinutes?: number;
  sources: string[];
  platforms: string[];
  mcap?: number;
  volume?: number;
  liquidity?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  contractAddress?: string;
  rugRisk?: "low" | "medium" | "high" | "unknown";
  rugDetails?: string;
  aiContext?: string;
  viralContext?: string;
  celebMention?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 0 — Gemini AI
// ─────────────────────────────────────────────────────────────────────────────
interface GeminiCoin {
  ticker: string;
  name?: string;
  context: string;
  platforms: string[];
  score: number;
  isViral?: boolean;
  celebMention?: string;
  estimatedAgeDays?: number; // NEW: ask Gemini to estimate how old the trend is
}

async function scanWithGemini(): Promise<{
  coins: GeminiCoin[];
  success: boolean;
  error?: string;
}> {
  if (!GEMINI_API_KEY)
    return { coins: [], success: false, error: "No GEMINI_API_KEY" };

  const prompt = `You are a real-time viral trend scanner for Solana meme coins. Search the web RIGHT NOW using Google Search.

TODAY'S DATE: ${new Date().toUTCString()}

TASK 1 — CELEBRITY & INFLUENCER POSTS (highest priority):
Search for posts from the LAST 48 HOURS from: ${CELEB_WATCHLIST.join(", ")}
Only include if the post is from the last 48 hours. Skip old news.

TASK 2 — VIRAL INTERNET MOMENTS (last 24-72 hours only):
Search TikTok trending NOW, YouTube trending TODAY, Reddit front page TODAY
Search Google Trends spikes from the last 24 hours
Viral news events, memes, games, movies, animals trending RIGHT NOW

TASK 3 — FRESH SOLANA MEME COINS (launched in the last 72 hours):
New pump.fun launches with social buzz
$TICKER mentions on r/CryptoMoonShots, r/SatoshiStreetBets from last 24h
New coins trending on DexScreener Solana (under 72 hours old)

IMPORTANT: Skip anything older than 7 days. We want FRESH signals only.

Return ONLY valid JSON, no markdown:
{"coins":[
  {
    "ticker":"WORD",
    "name":"Full name",
    "context":"Very specific reason with source and timing (e.g. 'Elon tweeted about WORD 2hrs ago' or 'TikTok sound WORD has 5M views since yesterday')",
    "platforms":["twitter","tiktok","youtube","reddit","pumpfun"],
    "score":85,
    "isViral":true,
    "celebMention":"Elon Musk",
    "estimatedAgeDays":0.1
  }
]}

Rules:
- ticker: 2-12 chars, letters/numbers only
- score: 1-100 (celebrity last 48h = 90+, fresh viral = 70+, coin buzz = 50+)
- estimatedAgeDays: how old is the trend/coin in days (0.1 = few hours, 1 = yesterday, 7 = week old)
- isViral: true if trend not yet a confirmed coin
- celebMention: name of celeb (omit if none)
- Max 30 items, freshest and hottest first
- Be SPECIFIC in context — name the actual tweet/video/post and when it happened`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 3000 },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const err = await res.text();
      return {
        coins: [],
        success: false,
        error: `Gemini ${res.status}: ${err.slice(0, 150)}`,
      };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    let parsed: { coins: GeminiCoin[] };
    try {
      parsed = JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      if (!m)
        return { coins: [], success: false, error: "Bad JSON from Gemini" };
      parsed = JSON.parse(m[0]);
    }

    const coins = (parsed.coins || [])
      .filter((c: GeminiCoin) => {
        if (!c.ticker || !isValidKeyword(cleanTicker(c.ticker))) return false;
        // Filter out anything Gemini estimates as older than 14 days
        if (c.estimatedAgeDays !== undefined && c.estimatedAgeDays > 14)
          return false;
        return true;
      })
      .map((c: GeminiCoin) => ({
        ...c,
        ticker: cleanTicker(c.ticker),
        score: Math.min(Math.max(c.score || 50, 1), 100),
      }));

    return { coins, success: true };
  } catch (e) {
    return { coins: [], success: false, error: String(e) };
  }
}

async function scanGeminiCryptoNews(): Promise<{
  coins: GeminiCoin[];
  success: boolean;
}> {
  if (!GEMINI_API_KEY) return { coins: [], success: false };

  const prompt = `Search the web for RIGHT NOW (today ${new Date().toDateString()}):

1. Breaking crypto news from last 24 hours driving new meme coin trends
2. Viral animal videos, weird news, events that went viral TODAY
3. Politician or government memes going viral in the last 48 hours
4. New game, movie, show, pop culture moment trending TODAY
5. Sports moments going viral (athlete celebrations, funny moments) from last 24h
6. Any Solana ecosystem news from last 48 hours

SKIP anything older than 7 days.

Return ONLY valid JSON:
{"coins":[{"ticker":"WORD","context":"Specific source/reason with timing","platforms":["reddit","twitter"],"score":70,"isViral":true,"estimatedAgeDays":0.5}]}

Max 15 items. Freshest first. No preamble, no markdown.`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.15, maxOutputTokens: 1500 },
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) return { coins: [], success: false };
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    let parsed: { coins: GeminiCoin[] };
    try {
      parsed = JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      if (!m) return { coins: [], success: false };
      parsed = JSON.parse(m[0]);
    }

    const coins = (parsed.coins || [])
      .filter((c: GeminiCoin) => {
        if (!c.ticker || !isValidKeyword(cleanTicker(c.ticker))) return false;
        if (c.estimatedAgeDays !== undefined && c.estimatedAgeDays > 14)
          return false;
        return true;
      })
      .map((c: GeminiCoin) => ({
        ...c,
        ticker: cleanTicker(c.ticker),
        score: Math.min(Math.max(c.score || 50, 1), 100),
      }));

    return { coins, success: true };
  } catch {
    return { coins: [], success: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 1 — Google Trends (8 regions)
// ─────────────────────────────────────────────────────────────────────────────
async function scanGoogleTrends(): Promise<{
  results: { keyword: string; score: number }[];
  count: number;
}> {
  const wordMap = new Map<string, number>();

  await Promise.all(
    GOOGLE_TRENDS_GEOS.map(async (geo) => {
      try {
        const r = await safeFetch(
          `https://trends.google.com/trending/rss?geo=${geo}`,
          { Accept: "application/rss+xml, text/xml" },
          8000,
        );
        if (!r) return;
        const xml = await r.text();
        const titleMatches =
          xml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g) || [];
        const trafficMatches =
          xml.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/g) || [];

        for (let i = 0; i < titleMatches.length; i++) {
          const title = titleMatches[i]
            .replace(/<title><!\[CDATA\[/, "")
            .replace(/\]\]><\/title>/, "")
            .toLowerCase()
            .trim();
          const traffic =
            parseInt(
              (trafficMatches[i] || "")
                .replace(/<[^>]*>/g, "")
                .replace(/[^0-9]/g, ""),
            ) || 5000;

          const words = title.split(/[\s\-_,.()/!?'"]+/);
          for (const w of words) {
            const clean = cleanTicker(w);
            if (isValidKeyword(clean))
              wordMap.set(clean, (wordMap.get(clean) || 0) + traffic);
          }
          for (let j = 0; j < words.length - 1; j++) {
            const compound = cleanTicker(words[j] + words[j + 1]);
            if (
              compound.length >= 4 &&
              compound.length <= 16 &&
              isValidKeyword(compound)
            ) {
              wordMap.set(
                compound,
                (wordMap.get(compound) || 0) + traffic * 1.5,
              );
            }
          }
        }
      } catch {
        /* skip */
      }
    }),
  );

  const results = Array.from(wordMap.entries()).map(([keyword, traffic]) => ({
    keyword,
    score: Math.min(traffic * 0.08, 60000),
  }));
  return { results, count: results.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 2 — Google News RSS
// ─────────────────────────────────────────────────────────────────────────────
async function scanGoogleNews(): Promise<{
  results: { keyword: string; score: number; context: string }[];
  count: number;
}> {
  const wordMap = new Map<string, { score: number; context: string }>();

  const queries = [
    "solana meme coin",
    "pump.fun new coin",
    "viral meme coin 2025",
    "crypto meme trending",
    "new solana token launch",
    "viral internet meme today",
    "trending meme social media",
    "Elon Musk meme tweet",
    "Donald Trump viral post",
    "celebrity meme coin",
    "TikTok trending today",
    "viral video trending",
    "meme coin pump",
    "solana new token trending",
    "crypto twitter viral",
  ];

  await Promise.all(
    queries.map(async (query) => {
      try {
        const r = await safeFetch(
          `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
          { Accept: "application/rss+xml, text/xml" },
          8000,
        );
        if (!r) return;
        const xml = await r.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

        for (const item of items.slice(0, 15)) {
          const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
          const title = (titleMatch?.[1] || "")
            .replace(/<!\[CDATA\[|\]\]>/g, "")
            .replace(/<[^>]+>/g, "")
            .toLowerCase();

          const isCelebQuery =
            query.includes("Elon") ||
            query.includes("Trump") ||
            query.includes("celebrity");
          const scoreMultiplier = isCelebQuery ? 2.5 : 1.0;

          const words = title.split(/[\s\-_,.()/!?'"]+/);
          for (const w of words) {
            const clean = cleanTicker(w);
            if (isValidKeyword(clean)) {
              const ex = wordMap.get(clean);
              wordMap.set(clean, {
                score: (ex?.score || 0) + 3000 * scoreMultiplier,
                context: ex?.context || title.slice(0, 80),
              });
            }
          }
          for (let j = 0; j < words.length - 1; j++) {
            const compound = cleanTicker(words[j] + words[j + 1]);
            if (
              compound.length >= 4 &&
              compound.length <= 16 &&
              isValidKeyword(compound)
            ) {
              const ex = wordMap.get(compound);
              wordMap.set(compound, {
                score: (ex?.score || 0) + 5000 * scoreMultiplier,
                context: ex?.context || title.slice(0, 80),
              });
            }
          }
          for (const m of title.matchAll(/\$([a-zA-Z][a-zA-Z0-9]{1,11})\b/g)) {
            const ticker = cleanTicker(m[1]);
            if (isValidKeyword(ticker)) {
              const ex = wordMap.get(ticker);
              wordMap.set(ticker, {
                score: (ex?.score || 0) + 12000 * scoreMultiplier,
                context: ex?.context || title.slice(0, 80),
              });
            }
          }
        }
      } catch {
        /* skip */
      }
    }),
  );

  const results = Array.from(wordMap.entries()).map(
    ([keyword, { score, context }]) => ({
      keyword,
      score,
      context,
    }),
  );
  return { results, count: results.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 3 — YouTube Trending
// ─────────────────────────────────────────────────────────────────────────────
async function scanYouTubeTrending(): Promise<{
  results: { keyword: string; score: number }[];
  count: number;
}> {
  const wordMap = new Map<string, number>();
  const feeds = [
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=US&hl=en",
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=GB&hl=en",
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=PH&hl=en",
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=BR&hl=en",
  ];

  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const r = await safeFetch(
          feed,
          { Accept: "application/atom+xml, text/xml" },
          8000,
        );
        if (!r) return;
        const xml = await r.text();
        const titleMatches = xml.match(/<title>([\s\S]*?)<\/title>/g) || [];

        for (const titleTag of titleMatches.slice(1, 30)) {
          const title = titleTag
            .replace(/<\/?title>/g, "")
            .replace(/<!\[CDATA\[|\]\]>/g, "")
            .toLowerCase();
          const words = title.split(/[\s\-_,.()/!?'"#@]+/);

          for (const w of words) {
            const clean = cleanTicker(w);
            if (isValidKeyword(clean))
              wordMap.set(clean, (wordMap.get(clean) || 0) + 8000);
          }
          for (let j = 0; j < words.length - 1; j++) {
            const compound = cleanTicker(words[j] + words[j + 1]);
            if (
              compound.length >= 4 &&
              compound.length <= 16 &&
              isValidKeyword(compound)
            ) {
              wordMap.set(compound, (wordMap.get(compound) || 0) + 12000);
            }
          }
        }
      } catch {
        /* skip */
      }
    }),
  );

  return {
    results: Array.from(wordMap.entries()).map(([keyword, score]) => ({
      keyword,
      score,
    })),
    count: wordMap.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 4 — Know Your Meme
// ─────────────────────────────────────────────────────────────────────────────
async function scanKnowYourMeme(): Promise<{
  results: { keyword: string; score: number; context: string }[];
  count: number;
}> {
  const results: { keyword: string; score: number; context: string }[] = [];
  try {
    const r = await safeFetch(
      "https://knowyourmeme.com/memes/trending",
      { Accept: "text/html,*/*" },
      8000,
    );
    if (!r) return { results, count: 0 };
    const html = await r.text();
    const titleMatches =
      html.match(
        /class="entry-grid-body[^"]*"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/g,
      ) || [];

    for (const block of titleMatches.slice(0, 20)) {
      const nameMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
      if (!nameMatch) continue;
      const name = nameMatch[1]
        .replace(/<[^>]+>/g, "")
        .trim()
        .toLowerCase();
      for (const w of name.split(/[\s\-_,.()/!?'"]+/)) {
        const clean = cleanTicker(w);
        if (isValidKeyword(clean))
          results.push({
            keyword: clean,
            score: 25000,
            context: `KYM trending: ${name}`,
          });
      }
      const compound = cleanTicker(name.replace(/\s+/g, ""));
      if (
        compound.length >= 3 &&
        compound.length <= 16 &&
        isValidKeyword(compound)
      ) {
        results.push({
          keyword: compound,
          score: 40000,
          context: `KYM trending meme: ${name}`,
        });
      }
    }
  } catch {
    /* silent */
  }
  return { results, count: results.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 5 — Hacker News
// ─────────────────────────────────────────────────────────────────────────────
async function scanHackerNews(): Promise<{
  results: { keyword: string; score: number; context: string }[];
  count: number;
}> {
  const results: { keyword: string; score: number; context: string }[] = [];
  try {
    const r = await safeFetch(
      "https://hacker-news.firebaseio.com/v0/topstories.json",
      {},
      5000,
    );
    if (!r) return { results, count: 0 };
    const ids: number[] = await r.json();

    const stories = await Promise.all(
      ids.slice(0, 20).map(async (id) => {
        const sr = await safeFetch(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
          {},
          4000,
        );
        if (!sr) return null;
        return sr.json();
      }),
    );

    for (const story of stories) {
      if (!story?.title) continue;
      const title = story.title.toLowerCase();
      const points = story.score || 0;
      if (points < 100) continue;

      for (const w of title.split(/[\s\-_,.()/!?'"]+/)) {
        const clean = cleanTicker(w);
        if (isValidKeyword(clean) && clean.length >= 4) {
          results.push({
            keyword: clean,
            score: points * 20,
            context: `HN trending: ${story.title.slice(0, 60)}`,
          });
        }
      }
    }
  } catch {
    /* silent */
  }
  return { results, count: results.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 6 — Reddit
// ─────────────────────────────────────────────────────────────────────────────
async function scanReddit(sub: string, tier: number) {
  const posts: {
    title: string;
    score: number;
    flair: string;
    comments: number;
  }[] = [];
  for (const endpoint of [
    `https://www.reddit.com/r/${sub}/hot.json?limit=100&raw_json=1`,
    `https://www.reddit.com/r/${sub}/new.json?limit=50&raw_json=1`,
  ]) {
    try {
      const r = await safeFetch(endpoint);
      if (!r) continue;
      const data = await r.json();
      for (const p of data?.data?.children || []) {
        posts.push({
          title: p.data.title || "",
          score: p.data.score || 0,
          flair: p.data.link_flair_text || "",
          comments: p.data.num_comments || 0,
        });
      }
    } catch {
      /* continue */
    }
  }
  return { sub, tier, posts };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 7 — Pump.fun (more aggressive scanning)
// ─────────────────────────────────────────────────────────────────────────────
async function scanPumpFun() {
  const results: {
    keyword: string;
    score: number;
    isNew: boolean;
    ageMinutes: number;
    mcap: number;
    volume: number;
    contractAddress?: string;
  }[] = [];

  // More endpoints including king-of-the-hill and graduated
  const endpoints = [
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=reply_count&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins/king-of-the-hill?includeNsfw=false",
    // Slightly older page too for volume runners
    "https://frontend-api.pump.fun/coins?offset=50&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
  ];

  for (const url of endpoints) {
    try {
      const r = await safeFetch(url, {}, 10000);
      if (!r) continue;
      const data = await r.json();
      const coins = Array.isArray(data) ? data : [data];

      for (const coin of coins) {
        const sym = cleanTicker(coin.symbol || "");
        const mcap = coin.usd_market_cap || 0;
        const replies = coin.reply_count || 0;
        const ageMinutes = Math.floor(
          (Date.now() - (coin.created_timestamp || Date.now())) / 60000,
        );
        const volume = coin.volume || 0;

        // Extended window: allow up to 7 days (10080 min) but apply age penalty
        if (ageMinutes > 10080) continue;
        if (mcap === 0 && replies === 0) continue;

        const ageMult = ageScoreMultiplier(ageMinutes);
        if (ageMult === 0) continue;

        const freshBonus =
          ageMinutes < 30
            ? 5.0
            : ageMinutes < 120
              ? 3.5
              : ageMinutes < 360
                ? 2.0
                : ageMinutes < 1440
                  ? 1.5
                  : 1.0;

        const activityScore =
          (replies * 900 + Math.min(mcap, 100000) * 0.12 + volume * 0.05) *
          freshBonus *
          ageMult;

        if (isValidKeyword(sym))
          results.push({
            keyword: sym,
            score: activityScore,
            isNew: ageMinutes < 1440,
            ageMinutes,
            mcap,
            volume,
            contractAddress: coin.mint,
          });
      }
    } catch {
      /* continue */
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 8 — DexScreener (extended age window, lower floor)
// ─────────────────────────────────────────────────────────────────────────────
async function scanDexScreener() {
  const results: {
    keyword: string;
    score: number;
    hasTicker: boolean;
    mcap?: number;
    liquidity?: number;
    priceChange1h?: number;
    priceChange24h?: number;
    volume24h?: number;
    ageMinutes?: number;
    contractAddress?: string;
  }[] = [];

  for (const q of [
    "solana meme",
    "pump fun solana",
    "new solana gem",
    "solana viral",
  ]) {
    try {
      const r = await safeFetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
      );
      if (!r) continue;
      const data = await r.json();

      // Extended to 7 days (604800000ms), removed 24h cap
      const pairs = (data?.pairs || []).filter(
        (p: { chainId: string; fdv?: number; pairCreatedAt?: number }) =>
          p.chainId === "solana" &&
          (p.fdv || 0) < 10_000_000 &&
          p.pairCreatedAt &&
          Date.now() - p.pairCreatedAt < 604800000, // 7 days
      );

      for (const pair of pairs.slice(0, 30)) {
        const sym = cleanTicker(pair.baseToken?.symbol || "");
        const liq = pair.liquidity?.usd || 0;
        const vol24h = pair.volume?.h24 || 0;
        const change1h = pair.priceChange?.h1 || 0;
        const change24h = pair.priceChange?.h24 || 0;
        const ageMinutes = pair.pairCreatedAt
          ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000)
          : undefined;

        // Lowered liquidity floor to $5k, kept sanity checks
        if (liq < 5000 || change1h > 500 || !isValidKeyword(sym)) continue;

        const ageMult = ageScoreMultiplier(ageMinutes);
        if (ageMult === 0) continue;

        results.push({
          keyword: sym,
          score:
            (vol24h * 0.4 + liq * 0.3 + Math.max(change24h, 0) * 120) * ageMult,
          hasTicker: true,
          mcap: pair.fdv,
          liquidity: liq,
          priceChange1h: change1h,
          priceChange24h: change24h,
          volume24h: vol24h,
          ageMinutes,
          contractAddress: pair.baseToken?.address,
        });
      }
    } catch {
      /* continue */
    }
  }

  // Token profiles (boosted tokens)
  try {
    const r = await safeFetch(
      "https://api.dexscreener.com/token-profiles/latest/v1",
    );
    if (r) {
      const data = await r.json();
      for (const token of (data || []).slice(0, 30)) {
        if (token.chainId !== "solana") continue;
        const m = (token.description || "")
          .toLowerCase()
          .match(/\$([a-z][a-z0-9]{1,11})\b/);
        if (m?.[1] && isValidKeyword(m[1]))
          results.push({
            keyword: m[1],
            score: 20000,
            hasTicker: true,
            contractAddress: token.tokenAddress,
          });
      }
    }
  } catch {
    /* continue */
  }

  // Top boosted
  try {
    const r = await safeFetch(
      "https://api.dexscreener.com/token-boosts/top/v1",
    );
    if (r) {
      const data = await r.json();
      for (const token of (data || []).slice(0, 20)) {
        if (token.chainId !== "solana") continue;
        const m = (token.description || "")
          .toLowerCase()
          .match(/\$([a-z][a-z0-9]{1,11})\b/);
        if (m?.[1] && isValidKeyword(m[1]))
          results.push({
            keyword: m[1],
            score: 15000 + (token.totalAmount || 0),
            hasTicker: true,
            contractAddress: token.tokenAddress,
          });
      }
    }
  } catch {
    /* continue */
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 9 — CoinGecko + CMC
// ─────────────────────────────────────────────────────────────────────────────
async function scanCoinGecko() {
  const results: { keyword: string; score: number; isNew: boolean }[] = [];
  try {
    const r = await safeFetch(
      "https://api.coingecko.com/api/v3/search/trending",
    );
    if (r) {
      const data = await r.json();
      for (const { item } of data?.coins || []) {
        const sym = cleanTicker(item.symbol || "");
        if (isValidKeyword(sym))
          results.push({
            keyword: sym,
            score: Math.max(40000 - (item.score ?? 10) * 3500, 3000),
            isNew: false,
          });
      }
    }
  } catch {
    /* continue */
  }

  try {
    const r = await safeFetch(
      "https://api.coingecko.com/api/v3/coins/list/new",
    );
    if (r) {
      const data: { symbol: string; activated_at: number }[] = await r.json();
      const now = Date.now() / 1000;
      for (const coin of (data || []).slice(0, 50)) {
        const sym = cleanTicker(coin.symbol || "");
        const ageHours = (now - (coin.activated_at || now)) / 3600;
        const ageMult = ageScoreMultiplier(ageHours * 60);
        if (isValidKeyword(sym) && ageMult > 0)
          results.push({
            keyword: sym,
            score: 15000 * (ageHours < 24 ? 2.0 : 1.3) * ageMult,
            isNew: ageHours < 72,
          });
      }
    }
  } catch {
    /* continue */
  }
  return results;
}

async function scanCMCNew() {
  const results: { keyword: string; score: number }[] = [];
  try {
    const r = await safeFetch(
      "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing/new?start=1&limit=50&convertId=2781",
      { Referer: "https://coinmarketcap.com/" },
    );
    if (!r) return results;
    const data = await r.json();
    for (const coin of data?.data?.recentlyAdded || []) {
      const sym = cleanTicker(coin.symbol || "");
      const vol = coin.volume24h || coin.statistics?.volume24h || 0;
      if (isValidKeyword(sym) && vol > 0)
        results.push({ keyword: sym, score: Math.min(vol * 0.001, 25000) });
    }
  } catch {
    /* continue */
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rugcheck
// ─────────────────────────────────────────────────────────────────────────────
async function checkRug(contractAddress: string): Promise<{
  risk: "low" | "medium" | "high" | "unknown";
  details: string;
}> {
  try {
    const r = await safeFetch(
      `https://api.rugcheck.xyz/v1/tokens/${contractAddress}/report/summary`,
      {},
      5000,
    );
    if (!r) return { risk: "unknown", details: "unavailable" };
    const data = await r.json();
    const score = data?.score || 0;
    const risks = (data?.risks || []) as { name: string; level: string }[];
    const highRisks = risks
      .filter((r) => r.level === "danger")
      .map((r) => r.name);
    const medRisks = risks.filter((r) => r.level === "warn").map((r) => r.name);

    if (highRisks.length > 0)
      return { risk: "high", details: highRisks.slice(0, 2).join(", ") };
    if (score > 5000 || medRisks.length >= 3)
      return {
        risk: "medium",
        details: medRisks.slice(0, 2).join(", ") || "moderate risk",
      };
    if (score > 0) return { risk: "low", details: "passed rugcheck" };
    return { risk: "unknown", details: "no data" };
  } catch {
    return { risk: "unknown", details: "failed" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
export async function GET() {
  const scoreMap = new Map<string, ScoreEntry>();
  const logs: string[] = [];

  const upsert = (
    word: string,
    amount: number,
    platform: string,
    sourceLabel: string,
    field: keyof Pick<
      ScoreEntry,
      | "viralScore"
      | "socialScore"
      | "onchainScore"
      | "geckoScore"
      | "aiScore"
      | "celebScore"
    >,
    opts: Partial<
      Pick<
        ScoreEntry,
        | "hasTicker"
        | "isNewCoin"
        | "ageMinutes"
        | "mcap"
        | "volume"
        | "liquidity"
        | "priceChange1h"
        | "priceChange24h"
        | "contractAddress"
        | "aiContext"
        | "viralContext"
        | "celebMention"
      >
    > = {},
  ) => {
    const key = word.toLowerCase().trim();
    if (!isValidKeyword(key) || amount <= 0) return;

    const existing = scoreMap.get(key);
    if (existing) {
      (existing[field] as number) += amount;
      existing.posts += 1;
      if (!existing.sources.includes(sourceLabel))
        existing.sources.push(sourceLabel);
      if (!existing.platforms.includes(platform))
        existing.platforms.push(platform);
      if (opts.hasTicker) existing.hasTicker = true;
      if (opts.isNewCoin) existing.isNewCoin = true;
      if (
        opts.ageMinutes !== undefined &&
        (existing.ageMinutes === undefined ||
          opts.ageMinutes < existing.ageMinutes)
      )
        existing.ageMinutes = opts.ageMinutes;
      if (opts.mcap && !existing.mcap) existing.mcap = opts.mcap;
      if (opts.volume) existing.volume = opts.volume;
      if (opts.liquidity && !existing.liquidity)
        existing.liquidity = opts.liquidity;
      if (
        opts.priceChange1h !== undefined &&
        existing.priceChange1h === undefined
      )
        existing.priceChange1h = opts.priceChange1h;
      if (
        opts.priceChange24h !== undefined &&
        existing.priceChange24h === undefined
      )
        existing.priceChange24h = opts.priceChange24h;
      if (opts.contractAddress && !existing.contractAddress)
        existing.contractAddress = opts.contractAddress;
      if (opts.aiContext && !existing.aiContext)
        existing.aiContext = opts.aiContext;
      if (opts.viralContext && !existing.viralContext)
        existing.viralContext = opts.viralContext;
      if (opts.celebMention && !existing.celebMention)
        existing.celebMention = opts.celebMention;
    } else {
      const entry: ScoreEntry = {
        viralScore: 0,
        socialScore: 0,
        onchainScore: 0,
        geckoScore: 0,
        aiScore: 0,
        celebScore: 0,
        posts: 1,
        hasTicker: opts.hasTicker || false,
        isNewCoin: opts.isNewCoin || false,
        ageMinutes: opts.ageMinutes,
        sources: [sourceLabel],
        platforms: [platform],
        mcap: opts.mcap,
        volume: opts.volume,
        liquidity: opts.liquidity,
        priceChange1h: opts.priceChange1h,
        priceChange24h: opts.priceChange24h,
        contractAddress: opts.contractAddress,
        aiContext: opts.aiContext,
        viralContext: opts.viralContext,
        celebMention: opts.celebMention,
      };
      (entry[field] as number) = amount;
      scoreMap.set(key, entry);
    }
  };

  // Fire all sources
  const [
    geminiData,
    geminiNewsData,
    googleTrendsData,
    googleNewsData,
    youtubeTrendingData,
    kymData,
    hnData,
    pumpResults,
    dexResults,
    geckoResults,
    cmcResults,
    ...redditResults
  ] = await Promise.all([
    scanWithGemini(),
    scanGeminiCryptoNews(),
    scanGoogleTrends(),
    scanGoogleNews(),
    scanYouTubeTrending(),
    scanKnowYourMeme(),
    scanHackerNews(),
    scanPumpFun(),
    scanDexScreener(),
    scanCoinGecko(),
    scanCMCNew(),
    ...REDDIT_SUBS.map((s) => scanReddit(s.name, s.tier)),
  ]);

  // Process Gemini
  if (geminiData.success) {
    for (const coin of geminiData.coins) {
      const isCeleb = !!coin.celebMention;
      // Apply age penalty from Gemini's estimate
      const ageMult =
        coin.estimatedAgeDays !== undefined
          ? ageScoreMultiplier(coin.estimatedAgeDays * 1440)
          : 0.9;
      if (ageMult === 0) continue;

      const baseScore = coin.score * (isCeleb ? 6000 : 4000) * ageMult;
      const field = isCeleb ? "celebScore" : "aiScore";

      upsert(
        coin.ticker,
        baseScore,
        isCeleb ? "celebrity" : "ai",
        isCeleb ? `Celebrity: ${coin.celebMention}` : "Gemini AI",
        field,
        {
          hasTicker: !coin.isViral,
          isNewCoin: coin.platforms?.includes("pumpfun"),
          aiContext: coin.context,
          viralContext: coin.isViral ? coin.context : undefined,
          celebMention: coin.celebMention,
        },
      );

      const entry = scoreMap.get(coin.ticker);
      if (entry)
        for (const plat of coin.platforms || []) {
          if (!entry.platforms.includes(plat)) entry.platforms.push(plat);
        }
    }
    const celebCount = geminiData.coins.filter((c) => c.celebMention).length;
    logs.push(
      `[Gemini AI] ✓ ${geminiData.coins.length} results — ${celebCount} celeb — ${geminiData.coins.filter((c) => c.isViral).length} viral`,
    );
  } else {
    logs.push(`[Gemini AI] ✗ ${geminiData.error}`);
  }

  if (geminiNewsData.success) {
    for (const coin of geminiNewsData.coins) {
      const ageMult =
        coin.estimatedAgeDays !== undefined
          ? ageScoreMultiplier(coin.estimatedAgeDays * 1440)
          : 0.9;
      if (ageMult === 0) continue;
      upsert(
        coin.ticker,
        coin.score * 3500 * ageMult,
        "ai",
        "Gemini News",
        "aiScore",
        {
          aiContext: coin.context,
          viralContext: coin.isViral ? coin.context : undefined,
        },
      );
    }
    logs.push(`[Gemini News] ✓ ${geminiNewsData.coins.length} signals`);
  }

  for (const g of googleTrendsData.results)
    upsert(g.keyword, g.score, "google-trends", "Google Trends", "viralScore");
  logs.push(`[Google Trends] ${googleTrendsData.count} words`);

  for (const g of googleNewsData.results)
    upsert(g.keyword, g.score, "google-news", "Google News", "viralScore", {
      viralContext: g.context,
    });
  logs.push(`[Google News] ${googleNewsData.count} keywords`);

  for (const y of youtubeTrendingData.results)
    upsert(y.keyword, y.score, "youtube", "YouTube Trending", "viralScore");
  logs.push(`[YouTube] ${youtubeTrendingData.count} keywords`);

  for (const k of kymData.results)
    upsert(k.keyword, k.score, "kym", "Know Your Meme", "viralScore", {
      viralContext: k.context,
    });
  logs.push(`[KYM] ${kymData.count} memes`);

  for (const h of hnData.results)
    upsert(h.keyword, h.score, "hackernews", "Hacker News", "viralScore", {
      viralContext: h.context,
    });
  logs.push(`[HN] ${hnData.count} keywords`);

  for (const p of pumpResults)
    upsert(p.keyword, p.score, "pumpfun", "Pump.fun", "onchainScore", {
      hasTicker: true,
      isNewCoin: p.isNew,
      ageMinutes: p.ageMinutes,
      mcap: p.mcap,
      volume: p.volume,
      contractAddress: p.contractAddress,
    });
  logs.push(`[Pump.fun] ${pumpResults.length} signals`);

  for (const d of dexResults)
    upsert(d.keyword, d.score, "dexscreener", "DexScreener", "onchainScore", {
      hasTicker: d.hasTicker,
      isNewCoin: true,
      mcap: d.mcap,
      liquidity: d.liquidity,
      priceChange1h: d.priceChange1h,
      priceChange24h: d.priceChange24h,
      volume: d.volume24h,
      contractAddress: d.contractAddress,
      ageMinutes: d.ageMinutes,
    });
  logs.push(`[DexScreener] ${dexResults.length} pairs`);

  for (const g of geckoResults)
    upsert(g.keyword, g.score, "coingecko", "CoinGecko", "geckoScore", {
      hasTicker: true,
      isNewCoin: g.isNew,
    });
  logs.push(`[CoinGecko] ${geckoResults.length} signals`);

  for (const c of cmcResults)
    upsert(c.keyword, c.score, "cmc", "CMC New", "geckoScore", {
      hasTicker: true,
      isNewCoin: true,
    });
  logs.push(`[CMC] ${cmcResults.length} listings`);

  let totalRedditTickers = 0;
  for (const { sub, tier, posts } of redditResults) {
    for (const { title, score: upvotes, flair, comments } of posts) {
      const heat = Math.max(upvotes, 1) + comments * 2;
      const full = `${title} ${flair}`.toLowerCase();

      for (const m of full.match(/\$([a-z][a-z0-9]{1,11})\b/g) || []) {
        const ticker = cleanTicker(m.replace("$", ""));
        if (isValidKeyword(ticker)) {
          upsert(ticker, heat * 8 * tier, "reddit", `r/${sub}`, "socialScore", {
            hasTicker: true,
          });
          totalRedditTickers++;
        }
      }
      for (const m of full.match(MEME_SUFFIXES) || []) {
        const compound = cleanTicker(m);
        if (isValidKeyword(compound))
          upsert(
            compound,
            heat * 4 * tier,
            "reddit",
            `r/${sub}`,
            "socialScore",
          );
      }
      if (upvotes > 5000) {
        for (const w of full.split(/[\s\-_,.()/!?'"#@]+/)) {
          const clean = cleanTicker(w);
          if (isValidKeyword(clean) && clean.length >= 4)
            upsert(
              clean,
              heat * 1.5 * tier,
              "reddit",
              `r/${sub}`,
              "socialScore",
            );
        }
      }
    }
  }
  logs.push(
    `[Reddit] ${REDDIT_SUBS.length} subs — ${totalRedditTickers} $TICKER mentions`,
  );

  // Rugcheck top onchain tokens
  const onchainWithCA = Array.from(scoreMap.entries())
    .filter(
      ([, v]) =>
        v.contractAddress &&
        (v.platforms.includes("dexscreener") ||
          v.platforms.includes("pumpfun")),
    )
    .sort(([, a], [, b]) => b.onchainScore - a.onchainScore)
    .slice(0, 15);

  const rugChecks = await Promise.all(
    onchainWithCA.map(async ([key, v]) => {
      const r = await checkRug(v.contractAddress!);
      return { key, ...r };
    }),
  );
  for (const { key, risk, details } of rugChecks) {
    const e = scoreMap.get(key);
    if (e) {
      e.rugRisk = risk;
      e.rugDetails = details;
    }
  }
  logs.push(`[Rugcheck] ${rugChecks.length} tokens checked`);

  // Final scoring with age penalty baked into onchain scores already
  const results = Array.from(scoreMap.entries())
    .map(([keyword, v]) => {
      const platformCount = v.platforms.length;
      const crossBonus =
        platformCount >= 5
          ? 3.5
          : platformCount >= 4
            ? 2.6
            : platformCount >= 3
              ? 1.8
              : platformCount >= 2
                ? 1.3
                : 1.0;
      const tickerBonus = v.hasTicker ? 3.5 : 1.0;
      const newCoinBonus = v.isNewCoin ? 2.2 : 1.0;
      const aiBonus = v.aiScore > 0 ? 2.5 : 1.0;
      const celebBonus = v.celebScore > 0 ? 8.0 : 1.0;

      const viralPlatforms = v.platforms.filter((p) =>
        [
          "google-trends",
          "google-news",
          "youtube",
          "kym",
          "tiktok",
          "celebrity",
        ].includes(p),
      ).length;
      const viralBonus =
        viralPlatforms >= 3
          ? 4.0
          : viralPlatforms >= 2
            ? 2.5
            : viralPlatforms >= 1
              ? 1.5
              : 1.0;

      const rugPenalty =
        v.rugRisk === "high" ? 0.1 : v.rugRisk === "medium" ? 0.6 : 1.0;

      const mentionWeight = Math.log2(v.posts + 2);
      const liqBonus = v.liquidity
        ? v.liquidity > 50000
          ? 1.5
          : v.liquidity > 20000
            ? 1.3
            : v.liquidity > 5000
              ? 1.1
              : 0.7
        : 1.0;

      // Apply age penalty at final scoring level too (belt+suspenders)
      const globalAgeMult = ageScoreMultiplier(v.ageMinutes);

      const raw =
        v.viralScore * 2.0 +
        v.socialScore * 1.5 +
        v.onchainScore * 2.8 +
        v.geckoScore * 2.0 +
        v.aiScore * 4.5 +
        v.celebScore * 7.0;

      const final = Math.round(
        raw *
          mentionWeight *
          tickerBonus *
          crossBonus *
          newCoinBonus *
          aiBonus *
          celebBonus *
          viralBonus *
          rugPenalty *
          liqBonus *
          globalAgeMult,
      );

      let ageLabel: string | undefined;
      if (v.ageMinutes !== undefined) {
        const days = v.ageMinutes / 1440;
        ageLabel =
          v.ageMinutes < 60
            ? `${v.ageMinutes}m old`
            : v.ageMinutes < 1440
              ? `${Math.floor(v.ageMinutes / 60)}h old`
              : days < 7
                ? `${Math.floor(days)}d old`
                : `${Math.floor(days)}d old ⚠`; // warn if old
      }

      return {
        keyword,
        score: final,
        posts: v.posts,
        source:
          v.sources.length > 3
            ? `${v.sources.slice(0, 2).join(" + ")} +${v.sources.length - 2}`
            : v.sources.join(" + ") || "unknown",
        hasTicker: v.hasTicker,
        isNewCoin: v.isNewCoin,
        crossPlatforms: platformCount,
        platforms: v.platforms,
        ageLabel,
        ageMinutes: v.ageMinutes,
        mcap: v.mcap,
        volume: v.volume,
        liquidity: v.liquidity,
        priceChange1h: v.priceChange1h,
        priceChange24h: v.priceChange24h,
        contractAddress: v.contractAddress,
        rugRisk: v.rugRisk,
        rugDetails: v.rugDetails,
        aiContext: v.aiContext || v.viralContext,
        celebMention: v.celebMention,
        onAI: v.platforms.includes("ai"),
        onCeleb: v.platforms.includes("celebrity"),
        onTwitter:
          v.platforms.includes("twitter") ||
          v.platforms.includes("google-news"),
        onTelegram: v.platforms.includes("telegram"),
        onDex:
          v.platforms.includes("dexscreener") ||
          v.platforms.includes("pumpfun"),
        isViralTrend: viralPlatforms >= 1,
        ageDays: v.ageMinutes !== undefined ? v.ageMinutes / 1440 : undefined,
      };
    })
    .filter((r) => {
      // Hard age filter: never show 30+ day tokens
      if (r.ageDays !== undefined && r.ageDays > 30) return false;
      // Hard rug filter
      if (r.rugRisk === "high") return false;
      if (r.priceChange1h !== undefined && r.priceChange1h > 800) return false;

      const hasCeleb = r.onCeleb;
      const hasRealAI = r.onAI && r.aiContext && r.aiContext.length > 20;
      const hasMultiSource = r.crossPlatforms >= 3;
      const hasOnchainPlusSocial =
        r.onDex &&
        (r.platforms || []).some((p: string) =>
          [
            "reddit",
            "google-trends",
            "youtube",
            "kym",
            "twitter",
            "google-news",
          ].includes(p),
        );
      const hasOnchainPlusAI = r.onDex && r.onAI;
      const isHighScore = r.score >= 500000;

      // Single-source DEX-only: block unless celeb
      if (r.onDex && r.crossPlatforms === 1 && !hasCeleb) return false;
      // Pure viral with no onchain AND no AI: block
      if (!r.onDex && !hasCeleb && !hasRealAI) return false;

      return (
        hasCeleb ||
        hasRealAI ||
        hasMultiSource ||
        hasOnchainPlusSocial ||
        hasOnchainPlusAI ||
        isHighScore
      );
    })
    .sort((a, b) => {
      const aBoost =
        (a.onCeleb ? 5.0 : 1) *
        (a.onAI ? 2.0 : 1) *
        (a.isViralTrend && a.onDex ? 3.0 : 1) *
        (a.isNewCoin && a.crossPlatforms >= 2 ? 1.4 : 1);
      const bBoost =
        (b.onCeleb ? 5.0 : 1) *
        (b.onAI ? 2.0 : 1) *
        (b.isViralTrend && b.onDex ? 3.0 : 1) *
        (b.isNewCoin && b.crossPlatforms >= 2 ? 1.4 : 1);
      return b.score * bBoost - a.score * aBoost;
    })
    .slice(0, 60);

  const celebCount = results.filter((r) => r.onCeleb).length;
  logs.push(
    `[Done] ${results.length} results — ${celebCount} celeb — ${results.filter((r) => r.isViralTrend).length} viral — ${results.filter((r) => r.onDex).length} on-chain`,
  );

  return NextResponse.json({
    results,
    logs,
    scannedAt: new Date().toISOString(),
  });
}
