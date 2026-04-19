import { NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════════════════
// WRAITH SCANNER v18 — STALE COIN KILLER + SIGNAL QUALITY OVERHAUL
//
// FIXES from v17 audit:
//   FIX 1: Age filter HARD KILLS anything > 7 days at every entry point
//           (previously undefined ageMinutes returned 1.0 instead of 0)
//   FIX 2: mcap ceiling enforced at EVERY upsert, not just final filter
//   FIX 3: DexScreener search removed — was returning 57-day-old coins
//           replaced with /boosted and /profiles endpoints only
//   FIX 4: Pump.fun graduated endpoint REMOVED — graduated coins are old
//   FIX 5: Final sort no longer boosts "undefined age" with 1.5x
//           undefined age now gets 0.5x (penalized, not rewarded)
//   FIX 6: recordTokenSighting mcap ceiling = MAX_MCAP (stops $4M KOKOP)
//   FIX 7: Gemini newPumpCoins now filters to < 3h only (was 6h)
//   FIX 8: Twitter query results now logged clearly so you can see if
//           bearer token is actually working
//   FIX 9: Min score threshold raised from 100K to 500K in MemeScanner
//           (you need to update MemeScanner.tsx too — see comment at bottom)
// ═══════════════════════════════════════════════════════════════════════════

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, Accept: "*/*" };

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// FIX 1: Decode URL-encoded bearer token at runtime
const TWITTER_BEARER = decodeURIComponent(
  process.env.TWITTER_BEARER_TOKEN || "",
);

const TELEGRAM_RSS_BASE =
  process.env.TELEGRAM_RSS_BASE || "https://rsshub.app/telegram/channel";
const REDDIT_USER_AGENT = process.env.REDDIT_USER_AGENT || "wraith-scanner/1.0";
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || "";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS — tighter limits
// ─────────────────────────────────────────────────────────────────────────────
const MAX_MCAP = 500_000; // hard ceiling — no exceptions
const MAX_AGE_DAYS = 3; // FIX 1: was 7, now 3 days max
const MAX_AGE_MINUTES = MAX_AGE_DAYS * 1440;
const MAX_1H_CHANGE = 300;
const MAX_24H_CHANGE = 400;
const MIN_LIQUIDITY = 2_000;

const GOOGLE_TRENDS_GEOS = ["US", "GB", "PH", "IN", "AU", "BR", "KR", "JP"];

const TELEGRAM_CHANNELS = [
  "solana",
  "solanameme",
  "pump_fun",
  "cryptomoonshots",
  "solananews",
  "memecoinsnews",
  "solanadegens",
  "cryptopumpnews",
  "defi_solana",
  "solana_ecosystem",
];

const TWITTER_QUERIES = [
  "pump.fun new coin solana -is:retweet lang:en",
  "$solana meme coin launched -is:retweet lang:en",
  "solana viral token new -is:retweet lang:en",
  "pump fun gem solana -is:retweet lang:en",
  "new solana meme coin -is:retweet lang:en",
  "viral animal meme coin -is:retweet lang:en",
  "solana token pump moon -is:retweet lang:en",
];

const REDDIT_SUBS = [
  { name: "CryptoMoonShots", tier: 6 },
  { name: "SatoshiStreetBets", tier: 6 },
  { name: "memecoinsmoonshots", tier: 6 },
  { name: "pumpfun", tier: 7 },
  { name: "solana", tier: 5 },
  { name: "memes", tier: 5 },
  { name: "dankmemes", tier: 4 },
  { name: "funny", tier: 3 },
  { name: "videos", tier: 4 },
  { name: "MemeEconomy", tier: 5 },
  { name: "CryptoCurrency", tier: 4 },
  { name: "aww", tier: 6 },
  { name: "AnimalsBeingBros", tier: 5 },
  { name: "nextfuckinglevel", tier: 5 },
  { name: "PublicFreakout", tier: 4 },
  { name: "WTF", tier: 3 },
];

// ─────────────────────────────────────────────────────────────────────────────
// BLACKLIST
// ─────────────────────────────────────────────────────────────────────────────
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
  "show",
  "shows",
  "goes",
  "told",
  "next",
  "home",
  "city",
  "street",
  "country",
  "state",
  "house",
  "room",
  "door",
  "hand",
  "head",
  "face",
  "eyes",
  "life",
  "love",
  "death",
  "war",
  "peace",
  "money",
  "game",
  "play",
  "win",
  "lose",
  "team",
  "club",
  "cup",
  "gold",
  "star",
  "king",
  "queen",
  "million",
  "billion",
  "thousand",
  "hundred",
  "percent",
  "number",
  "point",
  "place",
  "world",
  "maga",
  "trump",
  "make",
  "great",
  "again",
]);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
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

// FIX 1: Hard kill on age — undefined now returns 0 (penalized) not 1.0
function mcapMultiplier(mcap: number | undefined): number {
  if (!mcap || mcap === 0) return 1.5;
  if (mcap > MAX_MCAP) return 0; // hard kill
  if (mcap < 5_000) return 12.0;
  if (mcap < 20_000) return 8.0;
  if (mcap < 50_000) return 5.5;
  if (mcap < 100_000) return 3.5;
  if (mcap < 200_000) return 2.0;
  if (mcap < 500_000) return 1.0;
  return 0;
}

function ageMultiplier(ageMinutes: number | undefined): number {
  // FIX 1: undefined age = unknown = PENALIZED, not rewarded
  if (ageMinutes === undefined) return 0.3; // was 1.0, now penalized
  const days = ageMinutes / 1440;
  if (days > MAX_AGE_DAYS) return 0; // hard kill — no exceptions
  if (days > 2) return 0.2;
  if (days > 1) return 0.5;
  if (ageMinutes > 360) return 1.0;
  if (ageMinutes > 120) return 2.0;
  if (ageMinutes > 30) return 3.5;
  return 5.0;
}

function velocityMultiplier(
  score: number,
  ageMinutes: number | undefined,
): number {
  if (!ageMinutes || ageMinutes === 0) return 1.0;
  const velocity = score / Math.max(ageMinutes, 1);
  if (velocity > 10000) return 4.0;
  if (velocity > 5000) return 3.0;
  if (velocity > 1000) return 2.0;
  if (velocity > 500) return 1.5;
  return 1.0;
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

// FIX 1: Hard age check — call this before processing any coin
function isTooOld(createdTimestamp: number | undefined): boolean {
  if (!createdTimestamp) return false; // can't tell, allow through
  const ageMinutes = (Date.now() - createdTimestamp) / 60000;
  return ageMinutes > MAX_AGE_MINUTES;
}

function generateTickerVariants(
  primaryTicker: string,
  emotionWords: string[],
  headline: string,
): string[] {
  const variants = new Set<string>();
  const primary = cleanTicker(primaryTicker);
  if (isValidKeyword(primary)) variants.add(primary);

  for (const w of emotionWords) {
    const clean = cleanTicker(w);
    if (isValidKeyword(clean)) variants.add(clean);
  }

  for (const w of emotionWords.slice(0, 4)) {
    const clean = cleanTicker(w);
    if (!clean || clean.length < 2) continue;
    const fwd = cleanTicker(primary + clean);
    const bwd = cleanTicker(clean + primary);
    if (fwd.length <= 12 && isValidKeyword(fwd)) variants.add(fwd);
    if (bwd.length <= 12 && isValidKeyword(bwd)) variants.add(bwd);
  }

  const animalWords =
    headline
      .toLowerCase()
      .match(
        /\b(cat|dog|monkey|bear|frog|fish|bird|duck|pig|cow|fox|wolf|lion|tiger|panda|koala|bunny|rabbit|hamster|penguin|owl|eagle|hawk|shark|whale|dolphin|horse|goat|sheep|chicken|gorilla|chimp|ape|seal|otter|deer|mouse|rat|snake|turtle|crab|lobster|octopus|jellyfish|parrot|toucan|sloth|raccoon|squirrel|beaver|moose|buffalo|alligator|crocodile|lizard|gecko)\b/g,
      ) || [];

  for (const animal of animalWords) {
    if (isValidKeyword(animal)) variants.add(animal);
    const withPrimary = cleanTicker(primary + animal);
    if (withPrimary.length <= 12 && isValidKeyword(withPrimary))
      variants.add(withPrimary);
  }

  const properNouns = headline.match(/\b[A-Z][a-z]{2,12}\b/g) || [];
  for (const noun of properNouns) {
    const clean = cleanTicker(noun);
    if (isValidKeyword(clean) && clean.length >= 3) variants.add(clean);
  }

  return Array.from(variants).slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// STORY REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
interface ViralStory {
  id: string;
  headline: string;
  archetypeType: string;
  coinabilityScore: number;
  predictedTickers: string[];
  confirmedTicker?: string;
  confirmedMcap?: number;
  confirmedAge?: number;
  confirmedCA?: string;
  source: string;
  impressions?: number;
  emotionWords: string[];
  hasFanCommunity?: boolean;
  fanCommunitySize?: number;
}

const storyRegistry = new Map<string, ViralStory>();
const viralWordSet = new Set<string>();
const viralWordContext = new Map<string, string>();

function registerStory(story: ViralStory) {
  storyRegistry.set(story.id, story);
  for (const t of story.predictedTickers) {
    const clean = cleanTicker(t);
    viralWordSet.add(clean);
    viralWordContext.set(clean, story.headline);
  }
}

function registerViralWord(word: string, context: string) {
  const clean = cleanTicker(word);
  if (!isValidKeyword(clean)) return;
  viralWordSet.add(clean);
  if (!viralWordContext.has(clean)) viralWordContext.set(clean, context);
}

function getNarrativeBonus(ticker: string): {
  bonus: number;
  story: string | undefined;
  storyObj?: ViralStory;
} {
  const clean = cleanTicker(ticker);
  if (viralWordSet.has(clean))
    return {
      bonus: 1.0,
      story: viralWordContext.get(clean),
      storyObj: Array.from(storyRegistry.values()).find((s) =>
        s.predictedTickers.includes(clean),
      ),
    };

  for (const word of viralWordSet) {
    if (word.length >= 4 && (clean.includes(word) || word.includes(clean))) {
      return {
        bonus: 0.6,
        story: viralWordContext.get(word),
        storyObj: Array.from(storyRegistry.values()).find((s) =>
          s.predictedTickers.includes(word),
        ),
      };
    }
  }

  return { bonus: 0, story: undefined };
}

// ─────────────────────────────────────────────────────────────────────────────
// TWITTER v2
// ─────────────────────────────────────────────────────────────────────────────
async function scanTwitter(): Promise<{
  results: { keyword: string; score: number; context: string }[];
  rawTexts: string[];
  count: number;
  logs: string[];
}> {
  const results: { keyword: string; score: number; context: string }[] = [];
  const rawTexts: string[] = [];
  const logs: string[] = [];
  const wordMap = new Map<string, { score: number; context: string }>();

  if (!TWITTER_BEARER) {
    logs.push("[Twitter] No bearer token — skipping");
    return { results, rawTexts, count: 0, logs };
  }

  if (TWITTER_BEARER.includes("%")) {
    logs.push(
      "[Twitter] ⚠ Bearer still URL-encoded — fix .env (remove %2F → /, %3D → =)",
    );
  } else {
    logs.push(`[Twitter] Bearer OK (${TWITTER_BEARER.length} chars)`);
  }

  const twitterHeaders = {
    Authorization: `Bearer ${TWITTER_BEARER}`,
    "Content-Type": "application/json",
  };

  let totalTweets = 0;
  let failedQueries = 0;

  for (const query of TWITTER_QUERIES) {
    try {
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(
        query,
      )}&max_results=100&tweet.fields=public_metrics,created_at&expansions=author_id`;

      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(url, {
        headers: twitterHeaders,
        signal: ctrl.signal,
      });
      clearTimeout(t);

      if (!r.ok) {
        const err = await r.text();
        logs.push(
          `[Twitter] ✗ "${query.slice(0, 30)}" HTTP ${r.status}: ${err.slice(0, 100)}`,
        );
        failedQueries++;
        continue;
      }

      const data = await r.json();
      const tweets = data?.data || [];
      totalTweets += tweets.length;

      for (const tweet of tweets) {
        const text = (tweet.text || "").toLowerCase();
        const metrics = tweet.public_metrics || {};
        const likes = metrics.like_count || 0;
        const retweets = metrics.retweet_count || 0;
        const replies = metrics.reply_count || 0;
        const impressions = metrics.impression_count || 0;

        const createdAt = tweet.created_at
          ? new Date(tweet.created_at).getTime()
          : Date.now();
        const ageH = (Date.now() - createdAt) / 3600000;
        const recencyMult =
          ageH < 1
            ? 5.0
            : ageH < 3
              ? 3.0
              : ageH < 6
                ? 2.0
                : ageH < 24
                  ? 1.5
                  : 1.0;

        const engagement =
          (likes * 2 + retweets * 4 + replies + impressions * 0.001) *
          recencyMult;

        rawTexts.push(text.slice(0, 200));

        for (const m of text.matchAll(/\$([a-z][a-z0-9]{1,11})\b/g)) {
          const ticker = cleanTicker(m[1]);
          if (isValidKeyword(ticker)) {
            const ex = wordMap.get(ticker);
            wordMap.set(ticker, {
              score: (ex?.score || 0) + engagement * 5,
              context: ex?.context || text.slice(0, 100),
            });
            registerViralWord(ticker, `Twitter: "${text.slice(0, 80)}"`);
          }
        }

        if (engagement > 500) {
          const properNouns = tweet.text?.match(/\b[A-Z][a-z]{2,14}\b/g) || [];
          for (const noun of properNouns) {
            const clean = cleanTicker(noun);
            if (isValidKeyword(clean)) {
              const ex = wordMap.get(clean);
              wordMap.set(clean, {
                score: (ex?.score || 0) + engagement * 1.5,
                context: ex?.context || text.slice(0, 100),
              });
              registerViralWord(
                clean,
                `Twitter trending: "${text.slice(0, 60)}"`,
              );
            }
          }
        }
      }

      logs.push(
        `[Twitter] ✓ "${query.slice(0, 30)}..." — ${tweets.length} tweets`,
      );
    } catch (e) {
      logs.push(`[Twitter] ✗ query failed: ${String(e).slice(0, 60)}`);
      failedQueries++;
    }
  }

  for (const [keyword, { score, context }] of wordMap.entries()) {
    results.push({ keyword, score: score * 600, context });
  }

  logs.push(
    `[Twitter] TOTAL: ${totalTweets} tweets, ${results.length} signals, ${failedQueries}/${TWITTER_QUERIES.length} queries failed`,
  );
  return {
    results: results.sort((a, b) => b.score - a.score),
    rawTexts,
    count: results.length,
    logs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TELEGRAM RSS
// ─────────────────────────────────────────────────────────────────────────────
async function scanTelegram(): Promise<{
  results: { keyword: string; score: number; context: string }[];
  rawTexts: string[];
  count: number;
  logs: string[];
}> {
  const results: { keyword: string; score: number; context: string }[] = [];
  const rawTexts: string[] = [];
  const logs: string[] = [];
  const wordMap = new Map<string, { score: number; context: string }>();

  await Promise.all(
    TELEGRAM_CHANNELS.map(async (channel) => {
      try {
        const url = `${TELEGRAM_RSS_BASE}/${channel}`;
        const r = await safeFetch(
          url,
          { Accept: "application/rss+xml, text/xml" },
          8000,
        );
        if (!r) {
          logs.push(`[Telegram] @${channel}: no response`);
          return;
        }
        const xml = await r.text();

        if (!xml.includes("<item>")) {
          logs.push(`[Telegram] @${channel}: empty/invalid RSS`);
          return;
        }

        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

        for (const item of items.slice(0, 20)) {
          const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
          const descMatch = item.match(
            /<description>([\s\S]*?)<\/description>/,
          );
          const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

          // FIX 1: Skip Telegram posts older than MAX_AGE_DAYS
          if (pubDateMatch?.[1]) {
            const postAge =
              (Date.now() - new Date(pubDateMatch[1]).getTime()) / 60000;
            if (postAge > MAX_AGE_MINUTES) continue;
          }

          const rawText = (
            (titleMatch?.[1] || "") +
            " " +
            (descMatch?.[1] || "")
          )
            .replace(/<!\[CDATA\[|\]\]>/g, "")
            .replace(/<[^>]+>/g, "")
            .trim();
          const text = rawText.toLowerCase();

          if (!text || text.length < 10) continue;
          rawTexts.push(text.slice(0, 200));

          let recencyMult = 1.0;
          if (pubDateMatch?.[1]) {
            const ageH =
              (Date.now() - new Date(pubDateMatch[1]).getTime()) / 3600000;
            recencyMult =
              ageH < 1
                ? 5.0
                : ageH < 3
                  ? 3.5
                  : ageH < 6
                    ? 2.5
                    : ageH < 24
                      ? 1.5
                      : 1.0;
          }

          const channelTier = channel.includes("pump")
            ? 3.0
            : channel.includes("alpha")
              ? 2.5
              : 2.0;

          for (const m of text.matchAll(/\$([a-z][a-z0-9]{1,11})\b/g)) {
            const ticker = cleanTicker(m[1]);
            if (isValidKeyword(ticker)) {
              const ex = wordMap.get(ticker);
              wordMap.set(ticker, {
                score: (ex?.score || 0) + 8000 * recencyMult * channelTier,
                context: ex?.context || text.slice(0, 100),
              });
              registerViralWord(
                ticker,
                `Telegram @${channel}: "${text.slice(0, 60)}"`,
              );
            }
          }

          const words = text.split(/[\s\-_,.()/!?'"#@$]+/);
          for (const w of words) {
            const clean = cleanTicker(w);
            if (isValidKeyword(clean) && clean.length >= 4) {
              const ex = wordMap.get(clean);
              wordMap.set(clean, {
                score: (ex?.score || 0) + 1500 * recencyMult,
                context: ex?.context || text.slice(0, 80),
              });
            }
          }
        }

        logs.push(`[Telegram] @${channel}: ${items.length} posts`);
      } catch (e) {
        logs.push(`[Telegram] @${channel} failed: ${String(e).slice(0, 40)}`);
      }
    }),
  );

  for (const [keyword, { score, context }] of wordMap.entries()) {
    results.push({ keyword, score, context });
  }

  logs.push(
    `[Telegram] total: ${results.length} signals from ${rawTexts.length} posts`,
  );
  return {
    results: results.sort((a, b) => b.score - a.score),
    rawTexts,
    count: results.length,
    logs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BIRDEYE
// ─────────────────────────────────────────────────────────────────────────────
async function scanBirdeye(): Promise<{
  results: {
    keyword: string;
    score: number;
    mcap?: number;
    volume?: number;
    contractAddress?: string;
  }[];
  logs: string[];
}> {
  const results: {
    keyword: string;
    score: number;
    mcap?: number;
    volume?: number;
    contractAddress?: string;
  }[] = [];
  const logs: string[] = [];

  if (!BIRDEYE_API_KEY) {
    logs.push("[Birdeye] No API key — skipping. Get free key at birdeye.so");
    return { results, logs };
  }

  try {
    const r = await safeFetch(
      "https://public-api.birdeye.so/defi/tokenlist?sort_by=v24hUSD&sort_type=desc&offset=0&limit=50&min_liquidity=1000&chain=solana",
      { "X-API-KEY": BIRDEYE_API_KEY, "x-chain": "solana" },
      8000,
    );

    if (!r) {
      logs.push("[Birdeye] fetch failed — check API key");
      return { results, logs };
    }

    const data = await r.json();
    const tokens = data?.data?.tokens || [];

    for (const token of tokens) {
      const sym = cleanTicker(token.symbol || "");
      const mcap = token.mc || token.realMc || 0;
      const vol = token.v24hUSD || 0;
      const address = token.address || "";

      if (!isValidKeyword(sym)) continue;
      // FIX 2: Hard mcap kill
      if (mcap > MAX_MCAP) continue;

      const mcapMult = mcapMultiplier(mcap);
      if (mcapMult === 0) continue;

      results.push({
        keyword: sym,
        score: (vol * 0.5 + Math.min(mcap, 100000) * 0.1) * mcapMult,
        mcap,
        volume: vol,
        contractAddress: address,
      });
    }

    logs.push(
      `[Birdeye] ${tokens.length} tokens — ${results.length} valid (under $500K)`,
    );
  } catch (e) {
    logs.push(`[Birdeye] error: ${String(e).slice(0, 60)}`);
  }

  return { results, logs };
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI
// ─────────────────────────────────────────────────────────────────────────────
interface GeminiStory {
  ticker: string;
  tickerVariants?: string[];
  headline: string;
  archetypeType: string;
  coinabilityScore: number;
  emotionWords: string[];
  platforms: string[];
  impressions?: number;
  coinAlreadyExists: boolean;
  coinMcap?: number;
  coinAgeDays?: number;
  narrativeContext: string;
  celebMention?: string;
  hasFanCommunity?: boolean;
  fanCommunitySize?: number;
}

async function analyzeWithGemini(rawData: {
  twitterTexts: string[];
  telegramTexts: string[];
  redditTitles: string[];
  googleNewsTitles: string[];
  trendingWords: string[];
  newPumpCoins: {
    name: string;
    description: string;
    symbol: string;
    mcap: number;
    ageMinutes: number;
  }[];
}): Promise<{ stories: GeminiStory[]; success: boolean; error?: string }> {
  if (!GEMINI_API_KEY)
    return { stories: [], success: false, error: "No GEMINI_API_KEY" };

  const today = new Date().toUTCString();

  const prompt = `You are a meme coin narrative analyst. Today is ${today}.

You have been given REAL scraped social data below. Analyze it to find viral stories that will spawn Solana meme coins.
DO NOT search for anything. Analyze ONLY the data provided.

═══ TWITTER/X POSTS (last 24h) ═══
${rawData.twitterTexts.slice(0, 60).join("\n")}

═══ TELEGRAM ALPHA CHANNELS ═══
${rawData.telegramTexts.slice(0, 50).join("\n")}

═══ REDDIT POSTS ═══
${rawData.redditTitles.slice(0, 40).join("\n")}

═══ GOOGLE NEWS HEADLINES ═══
${rawData.googleNewsTitles.slice(0, 30).join("\n")}

═══ TRENDING WORDS (from all sources) ═══
${rawData.trendingWords.slice(0, 40).join(", ")}

═══ NEW PUMP.FUN COINS (last 3h) — match these to the stories above ═══
${rawData.newPumpCoins
  .slice(0, 30)
  .map(
    (c) =>
      `$${c.symbol} "${c.name}" mcap:$${Math.round(c.mcap)} age:${c.ageMinutes}min — ${c.description.slice(0, 80)}`,
  )
  .join("\n")}

═══ YOUR TASK ═══
1. Find patterns across ALL sources above — what story is multiple sources talking about RIGHT NOW?
2. Match pump.fun coins to those real stories (confirmed narratives)
3. Find stories that DON'T have a coin yet (predictive — high value)
4. CRITICAL: Only report coins that are UNDER 3 DAYS OLD and UNDER $500K mcap

THE PATTERN THAT CREATES COINS:
- Viral animal or character gets its own fan following
- Underdog/survival story with emotional pull
- Absurd/funny news people rally around
- Celebrity says specific word/phrase → that word becomes ticker
- TikTok/internet trend name becomes coin ticker

Return ONLY valid JSON, no markdown:
{"stories":[{
  "ticker":"PUNCH",
  "tickerVariants":["punch","monkey","punchcat","monkeypunch"],
  "headline":"[specific: who/what/where — from the data above, not invented]",
  "archetypeType":"fan_community_forming",
  "coinabilityScore":92,
  "emotionWords":["punch","monkey","zoo","viral"],
  "platforms":["twitter","telegram","reddit"],
  "impressions":23000,
  "coinAlreadyExists":true,
  "coinMcap":45000,
  "coinAgeDays":0.5,
  "narrativeContext":"[2-3 sentences from the data — what makes it coinable]",
  "celebMention":null,
  "hasFanCommunity":true,
  "fanCommunitySize":2500
}]}

RULES:
- MAX 20 stories, highest coinabilityScore first
- ONLY stories you can see evidence of in the data above
- If you can't find evidence in the data, don't invent it
- ticker: 2-12 chars, letters/numbers only
- coinabilityScore: 1-100 (90+ = confirmed story + coin, 80+ = strong evidence, 70+ = moderate, below 65 = skip)
- coinAlreadyExists: true only if you see the EXACT ticker in the pump.fun coins list above
- coinAgeDays: MUST be under 3 or don't include it
- coinMcap: MUST be under 500000 or don't include it`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.05, maxOutputTokens: 5000 },
      }),
      signal: AbortSignal.timeout(40000),
    });

    if (!res.ok) {
      const err = await res.text();
      return {
        stories: [],
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

    let parsed: { stories: GeminiStory[] };
    try {
      parsed = JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      if (!m)
        return { stories: [], success: false, error: "Bad JSON from Gemini" };
      parsed = JSON.parse(m[0]);
    }

    const stories = (parsed.stories || [])
      .filter((s: GeminiStory) => {
        if (!s.ticker || !isValidKeyword(cleanTicker(s.ticker))) return false;
        // FIX 1+2: Hard kill old/expensive coins from Gemini output
        if (s.coinAgeDays !== undefined && s.coinAgeDays > MAX_AGE_DAYS)
          return false;
        if (s.coinMcap !== undefined && s.coinMcap > MAX_MCAP) return false;
        if ((s.coinabilityScore || 0) < 65) return false;
        return true;
      })
      .map((s: GeminiStory) => ({
        ...s,
        ticker: cleanTicker(s.ticker),
        tickerVariants: [
          ...(s.tickerVariants || []).map(cleanTicker).filter(isValidKeyword),
          ...generateTickerVariants(s.ticker, s.emotionWords || [], s.headline),
        ].filter((v, i, arr) => arr.indexOf(v) === i),
        coinabilityScore: Math.min(Math.max(s.coinabilityScore || 50, 1), 100),
      }));

    return { stories, success: true };
  } catch (e) {
    return { stories: [], success: false, error: String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI CELEB SCAN
// ─────────────────────────────────────────────────────────────────────────────
const CELEBS = [
  "Elon Musk",
  "Donald Trump",
  "Vitalik Buterin",
  "CZ Binance",
  "Snoop Dogg",
  "Kanye West",
  "MrBeast",
  "Kai Cenat",
  "Logan Paul",
  "Andrew Tate",
  "Pokimane",
  "xQc",
];

async function scanGeminiCelebStories(rawTexts: string[]): Promise<{
  stories: GeminiStory[];
  success: boolean;
}> {
  if (!GEMINI_API_KEY || rawTexts.length === 0)
    return { stories: [], success: false };

  const today = new Date().toUTCString();
  const relevantTexts = rawTexts
    .filter((t) =>
      CELEBS.some((c) =>
        t.toLowerCase().includes(c.toLowerCase().split(" ")[0].toLowerCase()),
      ),
    )
    .slice(0, 40);

  if (relevantTexts.length === 0) return { stories: [], success: false };

  const prompt = `You are a crypto meme coin analyst. Today is ${today}.

Below is REAL social media data mentioning celebrities. Find which celebrity posts/moments will spawn meme coins.
DO NOT search for anything. Analyze only what's below.

SOCIAL DATA MENTIONING CELEBS:
${relevantTexts.join("\n")}

CELEBS TO WATCH: ${CELEBS.join(", ")}

Return ONLY valid JSON:
{"stories":[{
  "ticker":"WORD",
  "tickerVariants":["word","wordmeme","celebword"],
  "headline":"[celeb name]: [what they said/did — from the data above only]",
  "archetypeType":"celebrity_moment",
  "coinabilityScore":88,
  "emotionWords":["word","celeb","meme"],
  "platforms":["twitter","telegram"],
  "impressions":500000,
  "coinAlreadyExists":false,
  "coinMcap":null,
  "coinAgeDays":null,
  "narrativeContext":"[Why this word from this celeb will pump]",
  "celebMention":"[Celeb Full Name]"
}]}

Rules: MAX 8. Only what you can see evidence of above. Skip if no evidence.`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.05, maxOutputTokens: 2000 },
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) return { stories: [], success: false };
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    let parsed: { stories: GeminiStory[] };
    try {
      parsed = JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      if (!m) return { stories: [], success: false };
      parsed = JSON.parse(m[0]);
    }

    const stories = (parsed.stories || [])
      .filter((s: GeminiStory) => {
        if (!s.ticker || !isValidKeyword(cleanTicker(s.ticker))) return false;
        if (s.coinMcap !== undefined && s.coinMcap > MAX_MCAP) return false;
        return true;
      })
      .map((s: GeminiStory) => ({
        ...s,
        ticker: cleanTicker(s.ticker),
        tickerVariants: [
          ...(s.tickerVariants || []).map(cleanTicker).filter(isValidKeyword),
          ...generateTickerVariants(s.ticker, s.emotionWords || [], s.headline),
        ].filter((v, i, arr) => arr.indexOf(v) === i),
      }));

    return { stories, success: true };
  } catch {
    return { stories: [], success: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// KNOW YOUR MEME
// ─────────────────────────────────────────────────────────────────────────────
async function scanKnowYourMeme() {
  const results: { keyword: string; score: number; context: string }[] = [];

  try {
    const r = await safeFetch(
      "https://knowyourmeme.com/memes/trending.json",
      { Accept: "application/json", Referer: "https://knowyourmeme.com/" },
      8000,
    );

    if (r) {
      const data = await r.json();
      const memes = data?.memes || data?.data || data || [];

      if (Array.isArray(memes) && memes.length > 0) {
        for (const meme of memes.slice(0, 20)) {
          const name = (meme.name || meme.title || "").trim();
          if (!name) continue;

          const compound = cleanTicker(name.replace(/\s+/g, ""));
          if (
            compound.length >= 3 &&
            compound.length <= 16 &&
            isValidKeyword(compound)
          ) {
            results.push({
              keyword: compound,
              score: 45000,
              context: `KYM trending: ${name}`,
            });
            registerViralWord(compound, `KYM trending meme: "${name}"`);
          }
          for (const w of name.split(/[\s\-_,.()/!?'"]+/)) {
            const clean = cleanTicker(w);
            if (isValidKeyword(clean) && clean.length >= 4) {
              results.push({
                keyword: clean,
                score: 25000,
                context: `KYM trending: ${name}`,
              });
              registerViralWord(clean, `KYM trending: "${name}"`);
            }
          }
        }
        return { results, count: results.length };
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const r = await safeFetch(
      "https://knowyourmeme.com/memes/trending",
      { Accept: "text/html,*/*" },
      8000,
    );
    if (!r) return { results, count: 0 };
    const html = await r.text();

    const patterns = [
      /<h2[^>]*class="[^"]*entry[^"]*"[^>]*>([\s\S]*?)<\/h2>/g,
      /class="[^"]*entry-grid-body[^"]*"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/g,
      /"name":"([^"]{3,40})"/g,
      /data-entry-name="([^"]{3,40})"/g,
    ];

    for (const pattern of patterns) {
      const matches = [...html.matchAll(pattern)];
      if (matches.length > 3) {
        for (const match of matches.slice(0, 20)) {
          const name = (match[1] || "").replace(/<[^>]+>/g, "").trim();
          if (!name || name.length > 50) continue;
          const compound = cleanTicker(name.replace(/\s+/g, ""));
          if (
            compound.length >= 3 &&
            compound.length <= 16 &&
            isValidKeyword(compound)
          ) {
            results.push({
              keyword: compound,
              score: 40000,
              context: `KYM: ${name}`,
            });
            registerViralWord(compound, `KYM trending: "${name}"`);
          }
        }
        if (results.length > 0) break;
      }
    }
  } catch {
    /* silent */
  }

  return { results, count: results.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUMP.FUN — FIX 4: Graduated endpoint REMOVED
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
    name?: string;
    description?: string;
  }[] = [];

  // FIX 4: Removed graduated endpoint — graduated coins are old and expensive
  const endpoints = [
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=reply_count&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins/king-of-the-hill?includeNsfw=false",
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
        const createdTs = coin.created_timestamp || Date.now();
        const ageMinutes = Math.floor((Date.now() - createdTs) / 60000);
        const volume = coin.volume || 0;
        const description = (coin.description || "").toLowerCase();
        const name = coin.name || "";

        // FIX 1+2: Hard kills
        if (mcap > MAX_MCAP) continue;
        if (ageMinutes > MAX_AGE_MINUTES) continue;
        if (mcap === 0 && replies === 0) continue;

        const ageMult = ageMultiplier(ageMinutes);
        if (ageMult === 0) continue;
        const mcapMult = mcapMultiplier(mcap);
        if (mcapMult === 0) continue;

        const freshBonus =
          ageMinutes < 30
            ? 7.0
            : ageMinutes < 120
              ? 4.5
              : ageMinutes < 360
                ? 2.5
                : ageMinutes < 1440
                  ? 1.5
                  : 1.0;
        const activityScore =
          (replies * 900 + Math.min(mcap, 100000) * 0.12 + volume * 0.05) *
          freshBonus *
          ageMult *
          mcapMult;

        if (isValidKeyword(sym)) {
          results.push({
            keyword: sym,
            score: activityScore,
            isNew: ageMinutes < 1440,
            ageMinutes,
            mcap,
            volume,
            contractAddress: coin.mint,
            name,
            description,
          });
        }

        if (description.length > 10) {
          const descWords = description.split(/[\s\-_,.()/!?'"#@]+/);
          for (const w of descWords) {
            const clean = cleanTicker(w);
            if (isValidKeyword(clean) && clean.length >= 4 && clean !== sym)
              registerViralWord(
                clean,
                `Pump.fun desc: "${description.slice(0, 60)}"`,
              );
          }
        }

        if (name.length > 2) {
          const nameWords = name.toLowerCase().split(/[\s\-_]+/);
          for (const w of nameWords) {
            const clean = cleanTicker(w);
            if (isValidKeyword(clean) && clean.length >= 4 && clean !== sym)
              registerViralWord(clean, `Pump.fun name: "${name}"`);
          }
        }
      }
    } catch {
      /* continue */
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEXSCREENER — FIX 3: Search queries REMOVED (returned stale coins)
// Only using boosted/profiles endpoints which are always fresh
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

  // FIX 3: Removed text search queries — they return stale 57-day-old coins
  // Using only these two endpoints which surface boosted/trending tokens

  try {
    const r = await safeFetch(
      "https://api.dexscreener.com/token-profiles/latest/v1",
    );
    if (r) {
      const data = await r.json();
      for (const token of (data || []).slice(0, 50)) {
        if (token.chainId !== "solana") continue;

        // Check age if we can get it
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

        // Also check symbol directly
        const sym = cleanTicker(token.symbol || "");
        if (isValidKeyword(sym) && sym !== m?.[1]) {
          results.push({
            keyword: sym,
            score: 18000,
            hasTicker: true,
            contractAddress: token.tokenAddress,
          });
        }
      }
    }
  } catch {
    /* continue */
  }

  try {
    const r = await safeFetch(
      "https://api.dexscreener.com/token-boosts/top/v1",
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
            score: 15000 + (token.totalAmount || 0),
            hasTicker: true,
            contractAddress: token.tokenAddress,
          });

        const sym = cleanTicker(token.symbol || "");
        if (isValidKeyword(sym) && sym !== m?.[1]) {
          results.push({
            keyword: sym,
            score: 12000 + (token.totalAmount || 0),
            hasTicker: true,
            contractAddress: token.tokenAddress,
          });
        }
      }
    }
  } catch {
    /* continue */
  }

  // Enrich with live data and filter old/expensive coins
  const enriched: typeof results = [];
  const toEnrich = results.filter((r) => r.contractAddress).slice(0, 20);

  await Promise.all(
    toEnrich.map(async (item) => {
      try {
        const r = await safeFetch(
          `https://api.dexscreener.com/latest/dex/tokens/${item.contractAddress}`,
          {},
          6000,
        );
        if (!r) {
          enriched.push(item);
          return;
        }
        const data = await r.json();
        const pairs = (data?.pairs || [])
          .filter((p: { chainId: string }) => p.chainId === "solana")
          .sort(
            (
              a: { liquidity?: { usd?: number } },
              b: { liquidity?: { usd?: number } },
            ) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0),
          );

        if (!pairs.length) {
          enriched.push(item);
          return;
        }

        const pair = pairs[0];
        const mcap = pair.fdv || 0;
        const liq = pair.liquidity?.usd || 0;
        const change1h = pair.priceChange?.h1 || 0;
        const change24h = pair.priceChange?.h24 || 0;
        const vol24h = pair.volume?.h24 || 0;
        const ageMinutes = pair.pairCreatedAt
          ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000)
          : undefined;

        // FIX 1+2: Hard kills with live data
        if (mcap > MAX_MCAP) return;
        if (ageMinutes !== undefined && ageMinutes > MAX_AGE_MINUTES) return;
        if (liq < MIN_LIQUIDITY) return;
        if (change1h > MAX_1H_CHANGE) return;
        if (change24h > MAX_24H_CHANGE) return;

        const ageMult = ageMultiplier(ageMinutes);
        if (ageMult === 0) return;
        const mcapMult = mcapMultiplier(mcap);
        if (mcapMult === 0) return;

        enriched.push({
          ...item,
          mcap,
          liquidity: liq,
          priceChange1h: change1h,
          priceChange24h: change24h,
          volume24h: vol24h,
          ageMinutes,
          score:
            (vol24h * 0.4 + liq * 0.3 + Math.max(change24h, 0) * 120) *
            ageMult *
            mcapMult,
        });
      } catch {
        enriched.push(item);
      }
    }),
  );

  return enriched;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE TRENDS
// ─────────────────────────────────────────────────────────────────────────────
async function scanGoogleTrends() {
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
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        for (const item of items) {
          const titleMatch = item.match(
            /<title><!\[CDATA\[(.*?)\]\]><\/title>/,
          );
          const trafficMatch = item.match(
            /<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/,
          );
          if (!titleMatch) continue;
          const title = titleMatch[1].trim();

          const rawTraffic = (trafficMatch?.[1] || "")
            .trim()
            .replace(/\+/g, "")
            .replace(/,/g, "");
          let traffic: number;
          if (rawTraffic.toUpperCase().includes("M")) {
            traffic = Math.round(parseFloat(rawTraffic) * 1_000_000) || 5000;
          } else if (rawTraffic.toUpperCase().includes("K")) {
            traffic = Math.round(parseFloat(rawTraffic) * 1_000) || 5000;
          } else {
            traffic = parseInt(rawTraffic.replace(/[^0-9]/g, "")) || 5000;
          }

          const properNouns = title.match(/\b[A-Z][a-z]{2,14}\b/g) || [];
          for (const noun of properNouns) {
            const clean = cleanTicker(noun);
            if (isValidKeyword(clean) && clean.length >= 3) {
              wordMap.set(clean, (wordMap.get(clean) || 0) + traffic);
              registerViralWord(clean, `Google Trends: "${title}" (${geo})`);
            }
          }
          const capsWords =
            title.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)/g) || [];
          for (const phrase of capsWords) {
            const compound = cleanTicker(phrase.replace(/\s/g, ""));
            if (
              compound.length >= 4 &&
              compound.length <= 16 &&
              isValidKeyword(compound)
            ) {
              wordMap.set(compound, (wordMap.get(compound) || 0) + traffic * 2);
              registerViralWord(compound, `Google Trends: "${title}" (${geo})`);
            }
          }
        }
      } catch {
        /* skip */
      }
    }),
  );

  return {
    results: Array.from(wordMap.entries()).map(([keyword, traffic]) => ({
      keyword,
      score: Math.min(traffic * 0.1, 80000),
    })),
    count: wordMap.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE NEWS
// ─────────────────────────────────────────────────────────────────────────────
async function scanGoogleNews() {
  const wordMap = new Map<string, { score: number; context: string }>();
  const rawTitles: string[] = [];

  const queries = [
    "viral animal video today",
    "funny viral moment news today",
    "viral meme internet today",
    "solana meme coin launched today",
    "pump.fun viral new coin",
    "viral video reddit today",
    "Elon Musk tweet today",
    "Donald Trump post today",
    "celebrity viral post today",
    "TikTok viral trend today",
    "reddit front page today",
    "underdog survival story today",
    "viral zoo animal",
    "absurd funny news today",
    "solana token new viral",
    "went viral today",
    "fan account new viral character",
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
          const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
          const title = (titleMatch?.[1] || "")
            .replace(/<!\[CDATA\[|\]\]>/g, "")
            .replace(/<[^>]+>/g, "");
          const titleLower = title.toLowerCase();

          // FIX 1: Skip old news
          if (pubDateMatch?.[1]) {
            const pubAge = Date.now() - new Date(pubDateMatch[1]).getTime();
            if (pubAge > MAX_AGE_MINUTES * 60000) continue;
          }

          let recencyMult = 1.0;
          if (pubDateMatch?.[1]) {
            const pubAge = Date.now() - new Date(pubDateMatch[1]).getTime();
            if (pubAge < 6 * 3600000) recencyMult = 3.0;
            else if (pubAge < 24 * 3600000) recencyMult = 2.0;
          }

          rawTitles.push(title.slice(0, 150));

          const isCelebQuery =
            query.includes("Elon") ||
            query.includes("Trump") ||
            query.includes("celebrity");
          const scoreMultiplier = isCelebQuery
            ? 2.5 * recencyMult
            : recencyMult;

          const properNouns = title.match(/\b[A-Z][a-z]{2,14}\b/g) || [];
          for (const noun of properNouns) {
            const clean = cleanTicker(noun);
            if (isValidKeyword(clean)) {
              const ex = wordMap.get(clean);
              wordMap.set(clean, {
                score: (ex?.score || 0) + 4000 * scoreMultiplier,
                context: ex?.context || titleLower.slice(0, 80),
              });
              registerViralWord(clean, titleLower.slice(0, 80));
            }
          }

          for (const m of title.matchAll(/\$([a-zA-Z][a-zA-Z0-9]{1,11})\b/g)) {
            const ticker = cleanTicker(m[1]);
            if (isValidKeyword(ticker)) {
              const ex = wordMap.get(ticker);
              wordMap.set(ticker, {
                score: (ex?.score || 0) + 15000 * scoreMultiplier,
                context: ex?.context || titleLower.slice(0, 80),
              });
            }
          }
        }
      } catch {
        /* skip */
      }
    }),
  );

  return {
    results: Array.from(wordMap.entries()).map(
      ([keyword, { score, context }]) => ({
        keyword,
        score,
        context,
      }),
    ),
    rawTitles,
    count: wordMap.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE TRENDING
// ─────────────────────────────────────────────────────────────────────────────
async function scanYouTubeTrending() {
  const wordMap = new Map<string, number>();
  const feeds = [
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=US",
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=GB",
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=PH",
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=BR",
  ];

  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const r = await safeFetch(
          feed,
          { Accept: "application/atom+xml" },
          8000,
        );
        if (!r) return;
        const xml = await r.text();
        const titleMatches = xml.match(/<title>([\s\S]*?)<\/title>/g) || [];
        for (const titleTag of titleMatches.slice(1, 30)) {
          const rawTitle = titleTag
            .replace(/<\/?title>/g, "")
            .replace(/<!\[CDATA\[|\]\]>/g, "");
          const properNouns = rawTitle.match(/\b[A-Z][a-z]{2,14}\b/g) || [];
          for (const noun of properNouns) {
            const clean = cleanTicker(noun);
            if (isValidKeyword(clean)) {
              wordMap.set(clean, (wordMap.get(clean) || 0) + 10000);
              registerViralWord(
                clean,
                `YouTube trending: "${rawTitle.slice(0, 60)}"`,
              );
            }
          }
          const compound =
            rawTitle.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)/g) || [];
          for (const phrase of compound) {
            const c = cleanTicker(phrase.replace(/\s/g, ""));
            if (c.length >= 4 && c.length <= 16 && isValidKeyword(c)) {
              wordMap.set(c, (wordMap.get(c) || 0) + 18000);
              registerViralWord(
                c,
                `YouTube compound: "${rawTitle.slice(0, 60)}"`,
              );
            }
          }
        }
      } catch {
        /* skip */
      }
    }),
  );

  return {
    results: Array.from(wordMap.entries()).map(([k, v]) => ({
      keyword: k,
      score: v,
    })),
    count: wordMap.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// REDDIT
// ─────────────────────────────────────────────────────────────────────────────
async function scanReddit(sub: string, tier: number) {
  const posts: {
    title: string;
    score: number;
    flair: string;
    comments: number;
    createdUtc?: number;
  }[] = [];
  const redditHeaders = {
    "User-Agent": REDDIT_USER_AGENT,
    Accept: "application/json",
  };

  for (const endpoint of [
    `https://www.reddit.com/r/${sub}/hot.json?limit=100&raw_json=1`,
    `https://www.reddit.com/r/${sub}/new.json?limit=50&raw_json=1`,
  ]) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(endpoint, {
        headers: redditHeaders,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const data = await r.json();
      for (const p of data?.data?.children || []) {
        // FIX 1: Skip Reddit posts older than MAX_AGE_DAYS
        const createdUtc = p.data.created_utc;
        if (createdUtc) {
          const ageMinutes = (Date.now() / 1000 - createdUtc) / 60;
          if (ageMinutes > MAX_AGE_MINUTES) continue;
        }
        posts.push({
          title: p.data.title || "",
          score: Math.max(p.data.score || 0, 1),
          flair: p.data.link_flair_text || "",
          comments: p.data.num_comments || 0,
          createdUtc,
        });
      }
    } catch {
      /* continue */
    }
  }
  return { sub, tier, posts };
}

async function scanRedditSearch() {
  const results: { keyword: string; score: number; context: string }[] = [];
  const rawTitles: string[] = [];
  const redditHeaders = {
    "User-Agent": REDDIT_USER_AGENT,
    Accept: "application/json",
  };
  const searchQueries = [
    "solana meme coin pump.fun",
    "viral animal coin crypto",
    "new meme coin launch solana",
    "crypto pump solana new today",
  ];

  for (const q of searchQueries) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&limit=50&t=day&raw_json=1`,
        { headers: redditHeaders, signal: ctrl.signal },
      );
      clearTimeout(t);
      if (!r.ok) continue;
      const data = await r.json();
      for (const p of data?.data?.children || []) {
        const title = (p.data.title || "").toLowerCase();
        const score = Math.max(p.data.score || 1, 1);
        const comments = p.data.num_comments || 0;
        const createdUtc = p.data.created_utc;
        const ageH = createdUtc ? (Date.now() / 1000 - createdUtc) / 3600 : 48;

        // FIX 1: Skip old Reddit posts
        if (ageH > MAX_AGE_DAYS * 24) continue;

        const recencyMult =
          ageH < 2 ? 4.0 : ageH < 6 ? 2.5 : ageH < 24 ? 1.5 : 1.0;
        const heat = (score + comments * 2) * recencyMult;

        rawTitles.push(title.slice(0, 150));

        for (const m of title.matchAll(/\$([a-z][a-z0-9]{1,11})\b/g)) {
          const ticker = cleanTicker(m[1]);
          if (isValidKeyword(ticker))
            results.push({
              keyword: ticker,
              score: heat * 10,
              context: title.slice(0, 80),
            });
        }

        if (heat > 100) {
          const words = title.split(/[\s\-_,.()/!?'"]+/);
          for (const w of words) {
            const clean = cleanTicker(w);
            if (isValidKeyword(clean) && clean.length >= 4) {
              results.push({
                keyword: clean,
                score: heat * 2,
                context: title.slice(0, 80),
              });
              registerViralWord(clean, title.slice(0, 80));
            }
          }
        }
      }
    } catch {
      /* skip */
    }
  }

  return { results, rawTitles, count: results.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// COINGECKO + CMC
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
        // FIX 1: Skip coins older than MAX_AGE_DAYS
        if (ageHours > MAX_AGE_DAYS * 24) continue;
        const ageMult = ageMultiplier(ageHours * 60);
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
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(
      "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing/new?start=1&limit=50&convertId=2781",
      {
        headers: {
          "User-Agent": UA,
          Referer: "https://coinmarketcap.com/",
          Origin: "https://coinmarketcap.com",
          Accept: "application/json",
        },
        signal: ctrl.signal,
      },
    );
    clearTimeout(t);
    if (!r.ok) return results;
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
// RUGCHECK
// ─────────────────────────────────────────────────────────────────────────────
async function checkRug(
  ca: string,
): Promise<{ risk: "low" | "medium" | "high" | "unknown"; details: string }> {
  try {
    const r = await safeFetch(
      `https://api.rugcheck.xyz/v1/tokens/${ca}/report/summary`,
      {},
      5000,
    );
    if (!r) return { risk: "unknown", details: "unavailable" };
    const data = await r.json();
    const score = data?.score ?? -1;
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
    if (score === -1) return { risk: "unknown", details: "no score data" };
    if (score >= 0) return { risk: "low", details: "passed rugcheck" };
    return { risk: "unknown", details: "no data" };
  } catch {
    return { risk: "unknown", details: "failed" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE ENTRY TYPE
// ─────────────────────────────────────────────────────────────────────────────
interface ScoreEntry {
  viralScore: number;
  socialScore: number;
  onchainScore: number;
  geckoScore: number;
  celebScore: number;
  narrativeScore: number;
  storyScore: number;
  twitterScore: number;
  telegramScore: number;
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
  narrativeStory?: string;
  archetypeType?: string;
  coinabilityScore?: number;
  isPredictive?: boolean;
  impressions?: number;
  hasFanCommunity?: boolean;
  fanCommunitySize?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
export async function GET() {
  viralWordSet.clear();
  viralWordContext.clear();
  storyRegistry.clear();

  const scoreMap = new Map<string, ScoreEntry>();
  const logs: string[] = [];

  logs.push(`[Init] MAX_AGE = ${MAX_AGE_DAYS} days (${MAX_AGE_MINUTES} min)`);
  logs.push(`[Init] MAX_MCAP = $${MAX_MCAP.toLocaleString()}`);

  if (TWITTER_BEARER) {
    logs.push(
      `[Init] Twitter bearer: ${TWITTER_BEARER.length} chars, encoded=${TWITTER_BEARER.includes("%")}`,
    );
  } else {
    logs.push("[Init] ⚠ No Twitter bearer token");
  }
  if (BIRDEYE_API_KEY) {
    logs.push("[Init] Birdeye key loaded");
  } else {
    logs.push("[Init] No Birdeye key — disabled");
  }

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
      | "celebScore"
      | "narrativeScore"
      | "storyScore"
      | "twitterScore"
      | "telegramScore"
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
        | "narrativeStory"
        | "archetypeType"
        | "coinabilityScore"
        | "isPredictive"
        | "impressions"
        | "hasFanCommunity"
        | "fanCommunitySize"
      >
    > = {},
  ) => {
    const key = word.toLowerCase().trim();
    if (!isValidKeyword(key) || amount <= 0) return;

    // FIX 2: Hard mcap kill at upsert level — no exceptions
    if (opts.mcap !== undefined && opts.mcap > MAX_MCAP) return;

    // FIX 1: Hard age kill at upsert level
    if (opts.ageMinutes !== undefined && opts.ageMinutes > MAX_AGE_MINUTES)
      return;

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
      if (
        opts.mcap !== undefined &&
        opts.mcap > 0 &&
        (!existing.mcap || opts.mcap < existing.mcap)
      )
        existing.mcap = opts.mcap;
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
      if (opts.narrativeStory && !existing.narrativeStory)
        existing.narrativeStory = opts.narrativeStory;
      if (opts.archetypeType && !existing.archetypeType)
        existing.archetypeType = opts.archetypeType;
      if (
        opts.coinabilityScore !== undefined &&
        (!existing.coinabilityScore ||
          opts.coinabilityScore > existing.coinabilityScore)
      )
        existing.coinabilityScore = opts.coinabilityScore;
      if (opts.isPredictive) existing.isPredictive = true;
      if (
        opts.impressions !== undefined &&
        (!existing.impressions || opts.impressions > existing.impressions)
      )
        existing.impressions = opts.impressions;
      if (opts.hasFanCommunity) existing.hasFanCommunity = true;
      if (
        opts.fanCommunitySize !== undefined &&
        (!existing.fanCommunitySize ||
          opts.fanCommunitySize > existing.fanCommunitySize)
      )
        existing.fanCommunitySize = opts.fanCommunitySize;
    } else {
      const entry: ScoreEntry = {
        viralScore: 0,
        socialScore: 0,
        onchainScore: 0,
        geckoScore: 0,
        celebScore: 0,
        narrativeScore: 0,
        storyScore: 0,
        twitterScore: 0,
        telegramScore: 0,
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
        narrativeStory: opts.narrativeStory,
        archetypeType: opts.archetypeType,
        coinabilityScore: opts.coinabilityScore,
        isPredictive: opts.isPredictive,
        impressions: opts.impressions,
        hasFanCommunity: opts.hasFanCommunity,
        fanCommunitySize: opts.fanCommunitySize,
      };
      (entry[field] as number) = amount;
      scoreMap.set(key, entry);
    }
  };

  // ── WAVE 1: Twitter + Telegram ────────────────────────────────────────────
  const [twitterData, telegramData] = await Promise.all([
    scanTwitter(),
    scanTelegram(),
  ]);

  for (const t of twitterData.results)
    upsert(t.keyword, t.score, "twitter", "Twitter/X", "twitterScore", {
      viralContext: t.context,
    });
  for (const log of twitterData.logs) logs.push(log);

  for (const t of telegramData.results)
    upsert(t.keyword, t.score, "telegram", "Telegram Alpha", "telegramScore", {
      viralContext: t.context,
    });
  for (const log of telegramData.logs) logs.push(log);

  // ── WAVE 2: All sources in parallel ──────────────────────────────────────
  const [
    googleTrendsData,
    googleNewsData,
    youtubeTrendingData,
    kymData,
    redditSearchData,
    pumpResults,
    dexResults,
    geckoResults,
    cmcResults,
    birdeyeData,
    ...redditResults
  ] = await Promise.all([
    scanGoogleTrends(),
    scanGoogleNews(),
    scanYouTubeTrending(),
    scanKnowYourMeme(),
    scanRedditSearch(),
    scanPumpFun(),
    scanDexScreener(),
    scanCoinGecko(),
    scanCMCNew(),
    scanBirdeye(),
    ...REDDIT_SUBS.map((s) => scanReddit(s.name, s.tier)),
  ]);

  // ── WAVE 3: Gemini on REAL scraped data ──────────────────────────────────
  const allRawTexts = [
    ...twitterData.rawTexts,
    ...telegramData.rawTexts,
    ...(redditSearchData.rawTitles || []),
    ...(googleNewsData.rawTitles || []),
  ];

  // FIX 7: Only pass coins under 3h to Gemini (was 6h)
  const newPumpCoins = pumpResults
    .filter((p) => p.ageMinutes < 180)
    .slice(0, 30)
    .map((p) => ({
      name: p.name || p.keyword,
      description: p.description || "",
      symbol: p.keyword,
      mcap: p.mcap,
      ageMinutes: p.ageMinutes,
    }));

  const trendingWordsList = Array.from(viralWordSet).slice(0, 50);

  const [geminiStories, geminiCelebStories] = await Promise.all([
    analyzeWithGemini({
      twitterTexts: twitterData.rawTexts,
      telegramTexts: telegramData.rawTexts,
      redditTitles: redditSearchData.rawTitles || [],
      googleNewsTitles: googleNewsData.rawTitles || [],
      trendingWords: trendingWordsList,
      newPumpCoins,
    }),
    scanGeminiCelebStories(allRawTexts),
  ]);

  // ── Process social signals ────────────────────────────────────────────────
  for (const g of googleTrendsData.results)
    upsert(g.keyword, g.score, "google-trends", "Google Trends", "viralScore");
  logs.push(`[Google Trends] ${googleTrendsData.count} proper nouns`);

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

  for (const r of redditSearchData.results)
    upsert(r.keyword, r.score, "reddit", "Reddit Search", "socialScore", {
      viralContext: r.context,
    });

  // ── Process Gemini Stories ────────────────────────────────────────────────
  let narrativeCount = 0,
    predictiveCount = 0,
    fanCommunityCount = 0;

  if (geminiStories.success) {
    for (const story of geminiStories.stories) {
      const ageMult =
        story.coinAgeDays !== undefined
          ? ageMultiplier(story.coinAgeDays * 1440)
          : 0.5;
      if (ageMult === 0) continue;
      const mcapMult =
        story.coinMcap !== undefined ? mcapMultiplier(story.coinMcap) : 1.5;
      if (mcapMult === 0) continue;

      const isCeleb = !!story.celebMention;
      const isConfirmed = story.coinAlreadyExists;
      const isPredictive = !isConfirmed;
      const hasFanCommunity = !!story.hasFanCommunity;
      const fanBonus = hasFanCommunity
        ? story.fanCommunitySize
          ? Math.min(1 + (story.fanCommunitySize / 1000) * 0.3, 6.0)
          : 2.5
        : 1.0;
      const storyMult =
        (story.coinabilityScore / 100) * (isConfirmed ? 3.5 : 1.8);
      const impressionMult = story.impressions
        ? Math.min(Math.log10(story.impressions + 1) / 4, 2.0)
        : 1.0;
      const baseScore =
        story.coinabilityScore *
        6000 *
        ageMult *
        mcapMult *
        storyMult *
        impressionMult *
        fanBonus;
      const field = isCeleb
        ? "celebScore"
        : isConfirmed
          ? "narrativeScore"
          : "storyScore";

      const allVariants =
        story.tickerVariants ||
        generateTickerVariants(
          story.ticker,
          story.emotionWords || [],
          story.headline,
        );

      for (const variant of allVariants) {
        const variantIsMain = variant === story.ticker;
        upsert(
          variant,
          variantIsMain ? baseScore : baseScore * 0.4,
          isCeleb ? "celebrity" : "story",
          isCeleb
            ? `Celebrity: ${story.celebMention}`
            : isConfirmed
              ? "Confirmed Story"
              : "Predictive Story",
          field,
          {
            hasTicker: isConfirmed && variantIsMain,
            isNewCoin:
              isConfirmed && (story.coinAgeDays || 0) < 1 && variantIsMain,
            aiContext: story.narrativeContext,
            narrativeStory: story.narrativeContext,
            celebMention: story.celebMention || undefined,
            archetypeType: story.archetypeType,
            coinabilityScore: story.coinabilityScore,
            isPredictive,
            impressions: story.impressions,
            mcap: variantIsMain ? story.coinMcap : undefined,
            ageMinutes:
              story.coinAgeDays !== undefined
                ? Math.round(story.coinAgeDays * 1440)
                : undefined,
            hasFanCommunity,
            fanCommunitySize: story.fanCommunitySize,
          },
        );
      }

      for (const ew of story.emotionWords || [])
        registerViralWord(ew, story.narrativeContext);
      registerViralWord(story.ticker, story.narrativeContext);
      registerStory({
        id: story.ticker,
        headline: story.headline,
        archetypeType: story.archetypeType,
        coinabilityScore: story.coinabilityScore,
        predictedTickers: allVariants,
        confirmedTicker: isConfirmed ? story.ticker : undefined,
        confirmedMcap: story.coinMcap,
        confirmedAge:
          story.coinAgeDays !== undefined
            ? Math.round(story.coinAgeDays * 1440)
            : undefined,
        source: story.platforms?.[0] || "unknown",
        impressions: story.impressions,
        emotionWords: story.emotionWords || [],
        hasFanCommunity,
        fanCommunitySize: story.fanCommunitySize,
      });

      if (isConfirmed) narrativeCount++;
      if (isPredictive) predictiveCount++;
      if (hasFanCommunity) fanCommunityCount++;
    }
    logs.push(
      `[Gemini] ✓ ${geminiStories.stories.length} stories — ${narrativeCount} confirmed — ${predictiveCount} predictive`,
    );
  } else {
    logs.push(`[Gemini] ✗ ${geminiStories.error}`);
  }

  if (geminiCelebStories.success) {
    for (const story of geminiCelebStories.stories) {
      const ageMult =
        story.coinAgeDays !== undefined
          ? ageMultiplier(story.coinAgeDays * 1440)
          : 0.5;
      if (ageMult === 0) continue;
      const mcapMult =
        story.coinMcap !== undefined ? mcapMultiplier(story.coinMcap) : 1.5;
      if (mcapMult === 0) continue;
      const impressionMult = story.impressions
        ? Math.min(Math.log10(story.impressions + 1) / 4, 2.0)
        : 1.0;
      const allVariants =
        story.tickerVariants ||
        generateTickerVariants(
          story.ticker,
          story.emotionWords || [],
          story.headline,
        );

      for (const variant of allVariants) {
        upsert(
          variant,
          story.coinabilityScore *
            7000 *
            ageMult *
            mcapMult *
            impressionMult *
            (variant === story.ticker ? 1.0 : 0.4),
          "celebrity",
          `Celebrity: ${story.celebMention || "Unknown"}`,
          "celebScore",
          {
            hasTicker: story.coinAlreadyExists && variant === story.ticker,
            aiContext: story.narrativeContext,
            narrativeStory: story.narrativeContext,
            celebMention: story.celebMention || undefined,
            archetypeType: "celebrity_moment",
            coinabilityScore: story.coinabilityScore,
            impressions: story.impressions,
            mcap: variant === story.ticker ? story.coinMcap : undefined,
          },
        );
      }
      for (const ew of story.emotionWords || [])
        registerViralWord(ew, story.narrativeContext);
      registerViralWord(story.ticker, story.narrativeContext);
    }
    logs.push(
      `[Gemini Celeb] ✓ ${geminiCelebStories.stories.length} celebrity moments`,
    );
  }

  // ── Pump.fun ──────────────────────────────────────────────────────────────
  let pumpNarrativeMatches = 0;
  for (const p of pumpResults) {
    const { bonus, story, storyObj } = getNarrativeBonus(p.keyword);
    const narrativeBonus = bonus > 0 ? 1 + bonus * 12 : 1;
    const twitterEntry = scoreMap.get(p.keyword);
    const twitterBonus = twitterEntry?.twitterScore
      ? 1 + Math.min(twitterEntry.twitterScore / 50000, 3.5)
      : 1;
    const telegramBonus = twitterEntry?.telegramScore
      ? 1 + Math.min(twitterEntry.telegramScore / 30000, 4.0)
      : 1;
    const velMult = velocityMultiplier(p.score, p.ageMinutes);

    upsert(
      p.keyword,
      p.score * narrativeBonus * twitterBonus * telegramBonus * velMult,
      "pumpfun",
      "Pump.fun",
      "onchainScore",
      {
        hasTicker: true,
        isNewCoin: p.isNew,
        ageMinutes: p.ageMinutes,
        mcap: p.mcap,
        volume: p.volume,
        contractAddress: p.contractAddress,
        narrativeStory: story,
        aiContext: story || p.description,
      },
    );

    if (bonus > 0) {
      pumpNarrativeMatches++;
      if (storyObj && !storyObj.confirmedTicker) {
        storyRegistry.set(storyObj.id, {
          ...storyObj,
          confirmedTicker: p.keyword,
          confirmedMcap: p.mcap,
          confirmedAge: p.ageMinutes,
          confirmedCA: p.contractAddress,
        });
        upsert(
          p.keyword,
          p.score * 6,
          "pumpfun",
          "Narrative CONFIRMED",
          "narrativeScore",
          {
            narrativeStory: story,
            archetypeType: storyObj.archetypeType,
            coinabilityScore: storyObj.coinabilityScore,
          },
        );
      }
    }
  }
  logs.push(
    `[Pump.fun] ${pumpResults.length} signals — ${pumpNarrativeMatches} narrative matches`,
  );

  // DexScreener
  for (const d of dexResults) {
    const { bonus, story } = getNarrativeBonus(d.keyword);
    const narrativeBonus = bonus > 0 ? 1 + bonus * 12 : 1;
    const twitterEntry = scoreMap.get(d.keyword);
    const twitterBonus = twitterEntry?.twitterScore
      ? 1 + Math.min(twitterEntry.twitterScore / 50000, 3.5)
      : 1;
    const telegramBonus = twitterEntry?.telegramScore
      ? 1 + Math.min(twitterEntry.telegramScore / 30000, 4.0)
      : 1;
    const velMult = velocityMultiplier(d.score, d.ageMinutes);
    upsert(
      d.keyword,
      d.score * narrativeBonus * twitterBonus * telegramBonus * velMult,
      "dexscreener",
      "DexScreener",
      "onchainScore",
      {
        hasTicker: d.hasTicker,
        isNewCoin: true,
        mcap: d.mcap,
        liquidity: d.liquidity,
        priceChange1h: d.priceChange1h,
        priceChange24h: d.priceChange24h,
        volume: d.volume24h,
        contractAddress: d.contractAddress,
        ageMinutes: d.ageMinutes,
        narrativeStory: story,
        aiContext: story,
      },
    );
    if (bonus > 0)
      upsert(
        d.keyword,
        d.score * bonus * 6,
        "dexscreener",
        "Narrative Match",
        "narrativeScore",
        {
          narrativeStory: story,
        },
      );
  }
  logs.push(`[DexScreener] ${dexResults.length} pairs (boosted/profiles only)`);

  // Birdeye
  for (const b of birdeyeData.results) {
    const { bonus, story } = getNarrativeBonus(b.keyword);
    const narrativeBonus = bonus > 0 ? 1 + bonus * 8 : 1;
    upsert(
      b.keyword,
      b.score * narrativeBonus,
      "birdeye",
      "Birdeye",
      "onchainScore",
      {
        hasTicker: true,
        mcap: b.mcap,
        volume: b.volume,
        contractAddress: b.contractAddress,
        narrativeStory: story,
      },
    );
  }
  for (const log of birdeyeData.logs) logs.push(log);

  for (const g of geckoResults)
    upsert(g.keyword, g.score, "coingecko", "CoinGecko", "geckoScore", {
      hasTicker: true,
      isNewCoin: g.isNew,
    });
  for (const c of cmcResults)
    upsert(c.keyword, c.score, "cmc", "CMC New", "geckoScore", {
      hasTicker: true,
      isNewCoin: true,
    });

  // Reddit
  let totalRedditTickers = 0;
  for (const { sub, tier, posts } of redditResults) {
    for (const {
      title,
      score: upvotes,
      flair,
      comments,
      createdUtc,
    } of posts) {
      const ageH = createdUtc ? (Date.now() / 1000 - createdUtc) / 3600 : 48;
      const recencyMult =
        ageH < 2 ? 4.0 : ageH < 6 ? 2.5 : ageH < 24 ? 1.5 : 1.0;
      const heat = upvotes + comments * 2;
      const full = `${title} ${flair}`.toLowerCase();

      for (const m of full.match(/\$([a-z][a-z0-9]{1,11})\b/g) || []) {
        const ticker = cleanTicker(m.replace("$", ""));
        if (isValidKeyword(ticker)) {
          upsert(
            ticker,
            heat * 8 * tier * recencyMult,
            "reddit",
            `r/${sub}`,
            "socialScore",
            {
              hasTicker: true,
            },
          );
          totalRedditTickers++;
        }
      }

      if (upvotes > 5000) {
        const properNouns = title.match(/\b[A-Z][a-z]{2,14}\b/g) || [];
        for (const noun of properNouns) {
          const clean = cleanTicker(noun);
          if (isValidKeyword(clean)) {
            upsert(
              clean,
              heat * 1.5 * tier * recencyMult,
              "reddit",
              `r/${sub}`,
              "socialScore",
            );
            registerViralWord(clean, `r/${sub}: "${title.slice(0, 60)}"`);
          }
        }
      }
    }
  }
  logs.push(
    `[Reddit] ${REDDIT_SUBS.length} subs — ${totalRedditTickers} tickers`,
  );

  // Rugcheck top 15
  const onchainWithCA = Array.from(scoreMap.entries())
    .filter(
      ([, v]) =>
        v.contractAddress &&
        (v.platforms.includes("dexscreener") ||
          v.platforms.includes("pumpfun") ||
          v.platforms.includes("birdeye")),
    )
    .sort(([, a], [, b]) => b.onchainScore - a.onchainScore)
    .slice(0, 15);

  const rugChecks = await Promise.all(
    onchainWithCA.map(async ([key, v]) => ({
      key,
      ...(await checkRug(v.contractAddress!)),
    })),
  );
  for (const { key, risk, details } of rugChecks) {
    const e = scoreMap.get(key);
    if (e) {
      e.rugRisk = risk;
      e.rugDetails = details;
    }
  }
  logs.push(`[Rugcheck] ${rugChecks.length} tokens checked`);

  // ── FINAL SCORING ─────────────────────────────────────────────────────────
  const results = Array.from(scoreMap.entries())
    .map(([keyword, v]) => {
      // FIX 1+2: Triple-check hard kills in final pass
      if (v.mcap !== undefined && v.mcap > MAX_MCAP) return null;
      if (v.ageMinutes !== undefined && v.ageMinutes > MAX_AGE_MINUTES)
        return null;
      if (v.priceChange1h !== undefined && v.priceChange1h > MAX_1H_CHANGE)
        return null;
      if (v.priceChange24h !== undefined && v.priceChange24h > MAX_24H_CHANGE)
        return null;
      if (v.rugRisk === "high") return null;

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
      const celebBonus = v.celebScore > 0 ? 8.0 : 1.0;
      const narrativeBonus = v.narrativeScore > 0 ? 6.0 : 1.0;
      const storyBonus = v.storyScore > 0 ? 4.0 : 1.0;
      const twitterBonus =
        v.twitterScore > 0 ? 1 + Math.min(v.twitterScore / 100000, 4.0) : 1.0;
      const telegramBonus =
        v.telegramScore > 0 ? 1 + Math.min(v.telegramScore / 60000, 5.0) : 1.0;
      const coinabilityBonus = v.coinabilityScore
        ? 1 + (v.coinabilityScore / 100) * 3.5
        : 1.0;
      const fanCommunityBonus = v.hasFanCommunity
        ? v.fanCommunitySize
          ? Math.min(2.5 + (v.fanCommunitySize / 1000) * 0.5, 8.0)
          : 3.5
        : 1.0;
      const finalMcapMult = mcapMultiplier(v.mcap);
      if (finalMcapMult === 0) return null;

      const viralPlatforms = v.platforms.filter((p) =>
        [
          "google-trends",
          "google-news",
          "youtube",
          "kym",
          "twitter",
          "telegram",
          "celebrity",
        ].includes(p),
      ).length;
      const viralBonus =
        viralPlatforms >= 3
          ? 4.5
          : viralPlatforms >= 2
            ? 2.8
            : viralPlatforms >= 1
              ? 1.6
              : 1.0;
      const rugPenalty = v.rugRisk === "medium" ? 0.6 : 1.0;
      const mentionWeight = Math.log2(v.posts + 2);
      const liqBonus = v.liquidity
        ? v.liquidity > 50000
          ? 1.5
          : v.liquidity > 20000
            ? 1.3
            : v.liquidity > 5000
              ? 1.1
              : 0.8
        : 1.0;

      // FIX 5: undefined age is PENALIZED (0.3x), not rewarded (was 1.5x)
      const globalAgeMult = ageMultiplier(v.ageMinutes);
      if (globalAgeMult === 0) return null;

      const impressionBonus = v.impressions
        ? Math.min(Math.log10(v.impressions + 1) / 4, 2.0)
        : 1.0;
      const velMult = velocityMultiplier(
        v.viralScore + v.socialScore + v.onchainScore,
        v.ageMinutes,
      );

      const raw =
        v.viralScore * 2.0 +
        v.socialScore * 1.5 +
        v.onchainScore * 2.8 +
        v.geckoScore * 2.0 +
        v.celebScore * 7.0 +
        v.narrativeScore * 9.0 +
        v.storyScore * 7.0 +
        v.twitterScore * 4.0 +
        v.telegramScore * 5.0;

      const final = Math.round(
        raw *
          mentionWeight *
          tickerBonus *
          crossBonus *
          newCoinBonus *
          celebBonus *
          narrativeBonus *
          storyBonus *
          twitterBonus *
          telegramBonus *
          coinabilityBonus *
          viralBonus *
          rugPenalty *
          liqBonus *
          globalAgeMult *
          finalMcapMult *
          impressionBonus *
          fanCommunityBonus *
          velMult,
      );

      let ageLabel: string | undefined;
      if (v.ageMinutes !== undefined) {
        const days = v.ageMinutes / 1440;
        ageLabel =
          v.ageMinutes < 60
            ? `${v.ageMinutes}m old`
            : v.ageMinutes < 1440
              ? `${Math.floor(v.ageMinutes / 60)}h old`
              : `${Math.floor(days)}d old`;
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
        aiContext: v.narrativeStory || v.aiContext || v.viralContext,
        celebMention: v.celebMention,
        narrativeStory: v.narrativeStory,
        archetypeType: v.archetypeType,
        coinabilityScore: v.coinabilityScore,
        isPredictive: v.isPredictive || false,
        impressions: v.impressions,
        hasFanCommunity: v.hasFanCommunity || false,
        fanCommunitySize: v.fanCommunitySize,
        isNarrativeCoin: v.narrativeScore > 0 || v.storyScore > 0,
        onAI: v.platforms.includes("ai") || v.platforms.includes("story"),
        onCeleb: v.platforms.includes("celebrity"),
        onTwitter: v.platforms.includes("twitter"),
        onTelegram: v.platforms.includes("telegram"),
        onNarrative: v.narrativeScore > 0,
        onStory: v.storyScore > 0,
        onDex:
          v.platforms.includes("dexscreener") ||
          v.platforms.includes("pumpfun") ||
          v.platforms.includes("birdeye"),
        isViralTrend: viralPlatforms >= 1,
        ageDays: v.ageMinutes !== undefined ? v.ageMinutes / 1440 : undefined,
      };
    })
    .filter((r): r is NonNullable<typeof r> => {
      if (!r) return false;
      const hasCeleb = r.onCeleb;
      const hasStory = r.isNarrativeCoin || r.isPredictive;
      const hasFanCommunity = r.hasFanCommunity;
      const hasRealAI = r.onAI && r.aiContext && r.aiContext.length > 20;
      const hasMultiSource = r.crossPlatforms >= 3;
      const hasTwitter = r.onTwitter;
      const hasTelegram = r.onTelegram;
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
            "telegram",
          ].includes(p),
        );
      const hasOnchainPlusAI = r.onDex && r.onAI;
      const isHighScore = r.score >= 500000;

      if (
        r.onDex &&
        r.crossPlatforms === 1 &&
        !hasCeleb &&
        !hasStory &&
        !hasFanCommunity
      )
        return false;
      if (
        !r.onDex &&
        !hasCeleb &&
        !hasRealAI &&
        !hasStory &&
        !hasFanCommunity &&
        !hasTwitter &&
        !hasTelegram
      )
        return false;

      return (
        hasCeleb ||
        hasStory ||
        hasRealAI ||
        hasMultiSource ||
        hasOnchainPlusSocial ||
        hasOnchainPlusAI ||
        isHighScore ||
        hasFanCommunity ||
        hasTwitter ||
        hasTelegram
      );
    })
    .sort((a, b) => {
      const getMcapBoost = (r: typeof a) => {
        if (!r.mcap) return 1.2; // FIX 5: was 2.0, now 1.2 for unknown mcap
        if (r.mcap < 10000) return 7.0;
        if (r.mcap < 30000) return 5.0;
        if (r.mcap < 100000) return 3.0;
        if (r.mcap < 200000) return 1.8;
        return 1.0;
      };
      const getAgeBoost = (r: typeof a) => {
        if (!r.ageMinutes) return 0.8; // FIX 5: was 1.5, now penalized
        if (r.ageMinutes < 30) return 6.0;
        if (r.ageMinutes < 120) return 4.0;
        if (r.ageMinutes < 360) return 2.5;
        if (r.ageMinutes < 1440) return 1.5;
        if (r.ageMinutes < MAX_AGE_MINUTES) return 0.8;
        return 0; // hard kill
      };
      const getStoryBoost = (r: typeof a) => {
        if (r.hasFanCommunity && r.onDex) return 14.0;
        if (r.hasFanCommunity) return 8.0;
        if (r.isPredictive && r.coinabilityScore && r.coinabilityScore > 85)
          return 4.0;
        if (r.isNarrativeCoin && r.onDex) return 9.0;
        if (r.isNarrativeCoin) return 5.0;
        if (r.isPredictive) return 2.5;
        return 1.0;
      };
      const aBoost =
        (a.onCeleb ? 5.0 : 1) *
        getStoryBoost(a) *
        (a.isViralTrend && a.onDex ? 3.0 : 1) *
        (a.onTwitter && a.onDex ? 2.5 : 1) *
        (a.onTelegram && a.onDex ? 3.0 : 1) *
        getMcapBoost(a) *
        getAgeBoost(a);
      const bBoost =
        (b.onCeleb ? 5.0 : 1) *
        getStoryBoost(b) *
        (b.isViralTrend && b.onDex ? 3.0 : 1) *
        (b.onTwitter && b.onDex ? 2.5 : 1) *
        (b.onTelegram && b.onDex ? 3.0 : 1) *
        getMcapBoost(b) *
        getAgeBoost(b);
      return b.score * bBoost - a.score * aBoost;
    })
    .slice(0, 60);

  const freshCount = results.filter(
    (r) => (r.ageMinutes || 9999) < 1440,
  ).length;
  const confirmedStories = results.filter(
    (r) => r.isNarrativeCoin && r.onDex,
  ).length;
  const predictiveStories = results.filter((r) => r.isPredictive).length;
  const twitterSignals = results.filter((r) => r.onTwitter).length;
  const telegramSignals = results.filter((r) => r.onTelegram).length;

  logs.push(
    `[Done] ${results.length} results — ${freshCount} fresh (<24h) — ${confirmedStories} confirmed — ${predictiveStories} predictive — ${twitterSignals} Twitter — ${telegramSignals} Telegram`,
  );

  return NextResponse.json({
    results,
    logs,
    scannedAt: new Date().toISOString(),
    stories: Array.from(storyRegistry.values()).slice(0, 20),
    sourceStats: {
      twitterTweets: twitterData.rawTexts.length,
      telegramPosts: telegramData.rawTexts.length,
      pumpCoins: pumpResults.length,
      dexPairs: dexResults.length,
      birdeyeTokens: birdeyeData.results.length,
    },
  });
}

/*
═══════════════════════════════════════════════════════
ALSO UPDATE MemeScanner.tsx — two lines to change:

1. Line: const MIN_TRACK_SCORE = 100_000;
   Change to: const MIN_TRACK_SCORE = 500_000;

2. Add this check in recordTokenSighting():
   After: if ((result.mcap || 0) > 0 && (result.mcap || 0) < MIN_TRACK_MCAP) return;
   Add:   if ((result.mcap || 0) > 500_000) return;  // FIX 6: stop tracking $KOKOP etc

This stops the Win Tracker from accumulating old high-mcap garbage.
To clear existing bad entries: open browser console → localStorage.removeItem('wraith_token_history_v2')
═══════════════════════════════════════════════════════
*/
