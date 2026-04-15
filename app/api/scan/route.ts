import { NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════════════════
// WRAITH SCANNER v3 — Viral Moment Detection Engine
// Strategy: catch memes going viral on socials BEFORE anyone launches a coin
// Sources: Reddit (no auth), CoinGecko new listings, DexScreener new pairs,
//          Pump.fun newest coins, Twitter/X trending (nitter proxy, no key),
//          Google Trends RSS (no key), CoinMarketCap new listings (no key)
// ═══════════════════════════════════════════════════════════════════════════

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const HEADERS = { "User-Agent": UA, Accept: "application/json" };

// ── Subreddits — meme/viral culture + crypto moonshot subs ──────────────────
const REDDIT_SUBS = [
  // Pure meme/viral culture — this is where the moment starts
  { name: "memes", tier: 4 },
  { name: "dankmemes", tier: 4 },
  { name: "me_irl", tier: 3 },
  { name: "facepalm", tier: 3 },
  { name: "PublicFreakout", tier: 3 },
  { name: "nextfuckinglevel", tier: 3 },
  { name: "interestingasfuck", tier: 2 },
  { name: "HolUp", tier: 3 },
  { name: "teenagers", tier: 2 },
  { name: "tifu", tier: 2 },
  // Crypto subs — where people discuss turning memes into coins
  { name: "CryptoMoonShots", tier: 5 },
  { name: "SatoshiStreetBets", tier: 5 },
  { name: "memecoinsmoonshots", tier: 5 },
  { name: "CryptoCurrency", tier: 3 },
  { name: "solana", tier: 4 },
  { name: "pumpfun", tier: 5 },
];

// ── Words that are never meme coins ─────────────────────────────────────────
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
  "irl",
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
  "ftw",
  "tfw",
  "mfw",
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
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "year",
  "month",
  "week",
  "hour",
  "today",
  "yesterday",
  "tomorrow",
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
  "never",
  "always",
  "already",
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
  "just",
  "what",
  "when",
  "where",
  "will",
  "would",
  "could",
  "should",
  "their",
  "there",
  "than",
  "then",
  "have",
  "more",
  "some",
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
  "src",
  "net",
  "org",
  "com",
  "gov",
  "edu",
  "pro",
  "did",
  "say",
  "ask",
  "saw",
  "ago",
  "sir",
  "wow",
  "nah",
  "yep",
  "nope",
  "sure",
  "okay",
  "fine",
  "cool",
  "nice",
  "bad",
  "sad",
  "mad",
  "fun",
  "red",
  "blue",
  "green",
  "just",
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
  "real",
  "fire",
  "valid",
  "facts",
  "cap",
  "lowkey",
  "highkey",
  "vibe",
  "vibes",
  "cringe",
  "mid",
  "lit",
  "goat",
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
  "damn",
  "hell",
  "crap",
  "ass",
  "shit",
  "fuck",
  "hate",
  "love",
  "life",
  "dead",
  "die",
  "kill",
  "born",
  "live",
  "went",
  "come",
  "came",
  "left",
  "went",
  "stay",
  "move",
  "play",
  "stop",
  "start",
  "end",
  "use",
  "try",
  "ask",
  "help",
  "show",
  "tell",
  "keep",
  "hold",
  "run",
  "walk",
  "talk",
  "read",
  "write",
  "draw",
  "pick",
  "drop",
  "open",
  "close",
  "push",
  "pull",
  "turn",
  "move",
  "send",
  "give",
  "take",
  "make",
  "find",
  "lose",
  "win",
  "beat",
  "hit",
  "cut",
  "eat",
  "drink",
  "sleep",
  "wake",
  "wait",
  "hear",
  "watch",
  "meet",
  "pay",
  "spend",
  "save",
  "buy",
  "sell",
  "own",
  "need",
  "want",
  "like",
  "love",
  "hate",
  "feel",
  "seem",
  "look",
  "sound",
  "smell",
  "taste",
  "think",
  "know",
  "mean",
  "believe",
  "hope",
  "wish",
  "wonder",
  "remember",
  "forget",
  "learn",
  "teach",
  "understand",
  "explain",
  "describe",
  "mention",
  "suggest",
  "recommend",
  "allow",
  "prevent",
  "cause",
  "happen",
  "change",
  "create",
  "destroy",
  "build",
  "break",
  "fix",
  "improve",
  "develop",
  "grow",
  "shrink",
  "increase",
  "decrease",
]);

// ── Minimum score thresholds ─────────────────────────────────────────────────
const MIN_FINAL_SCORE = 500;

interface ScoreEntry {
  socialScore: number; // reddit/twitter viral potential
  onchainScore: number; // pump.fun / dex signals
  geckoScore: number; // coingecko trending
  posts: number;
  hasTicker: boolean;
  isNewCoin: boolean; // freshly launched, not established
  ageMinutes?: number; // how new is the pump.fun coin
  sources: string[];
  platforms: string[];
  mcap?: number;
  volume?: number;
}

// ── Safe fetch with timeout ──────────────────────────────────────────────────
async function safeFetch(
  url: string,
  extraHeaders: Record<string, string> = {},
  ms = 9000,
) {
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

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 1 — Reddit public JSON (no OAuth, no app registration)
// Scans: /hot + /rising + /new for maximum signal capture
// ════════════════════════════════════════════════════════════════════════════
async function scanReddit(sub: string, tier: number) {
  const endpoints = [
    `https://www.reddit.com/r/${sub}/hot.json?limit=100&raw_json=1`,
    `https://www.reddit.com/r/${sub}/rising.json?limit=50&raw_json=1`,
    `https://www.reddit.com/r/${sub}/new.json?limit=50&raw_json=1`,
  ];

  const posts: {
    title: string;
    score: number;
    flair: string;
    comments: number;
  }[] = [];

  for (const url of endpoints) {
    try {
      const r = await safeFetch(url);
      if (!r) continue;
      const data = await r.json();
      const children = data?.data?.children || [];
      for (const p of children) {
        posts.push({
          title: p.data.title || "",
          score: p.data.score || 0,
          flair: p.data.link_flair_text || "",
          comments: p.data.num_comments || 0,
        });
      }
    } catch {
      // continue
    }
  }

  return { sub, tier, posts };
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 2 — Pump.fun: Newest coins by last trade + king of the hill
// This catches coins that were JUST launched in the last few hours
// ════════════════════════════════════════════════════════════════════════════
async function scanPumpFun() {
  const results: {
    keyword: string;
    score: number;
    isNew: boolean;
    ageMinutes: number;
    mcap: number;
    volume: number;
  }[] = [];

  // Newest by last trade — these are freshly active
  const endpoints = [
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false",
    // King of the hill — coins close to graduating to Raydium
    "https://frontend-api.pump.fun/coins/king-of-the-hill?includeNsfw=false",
  ];

  for (const url of endpoints) {
    try {
      const r = await safeFetch(url, {}, 10000);
      if (!r) continue;
      const data = await r.json();
      const coins = Array.isArray(data) ? data : [data];

      for (const coin of coins) {
        const sym = (coin.symbol || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const name = (coin.name || "")
          .toLowerCase()
          .replace(/\s+/g, "")
          .replace(/[^a-z0-9]/g, "");
        const mcap = coin.usd_market_cap || 0;
        const replies = coin.reply_count || 0;
        const createdMs = coin.created_timestamp || Date.now();
        const ageMinutes = Math.floor((Date.now() - createdMs) / 60000);
        const volume = coin.volume || 0;

        // Freshness bonus: newer = higher multiplier
        const freshBonus =
          ageMinutes < 60
            ? 4.0
            : ageMinutes < 360
              ? 2.5
              : ageMinutes < 1440
                ? 1.5
                : 1.0;
        const activityScore =
          (replies * 800 + Math.min(mcap, 100000) * 0.1) * freshBonus;

        if (sym.length >= 2 && sym.length <= 12 && !BLACKLIST.has(sym)) {
          results.push({
            keyword: sym,
            score: activityScore,
            isNew: ageMinutes < 1440,
            ageMinutes,
            mcap,
            volume,
          });
        }
        if (
          name.length >= 3 &&
          name.length <= 14 &&
          !BLACKLIST.has(name) &&
          name !== sym
        ) {
          results.push({
            keyword: name,
            score: activityScore * 0.7,
            isNew: ageMinutes < 1440,
            ageMinutes,
            mcap,
            volume,
          });
        }
      }
    } catch {
      // continue
    }
  }

  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 3 — DexScreener: New Solana pairs < 24h old with volume spike
// Filters to low mcap pairs only — ignore established coins
// ════════════════════════════════════════════════════════════════════════════
async function scanDexScreener() {
  const results: {
    keyword: string;
    score: number;
    hasTicker: boolean;
    mcap?: number;
  }[] = [];

  try {
    // New token profiles — freshest Solana deployments
    const r = await safeFetch(
      "https://api.dexscreener.com/token-profiles/latest/v1",
    );
    if (r) {
      const data = await r.json();
      for (const token of (data || []).slice(0, 40)) {
        if (token.chainId !== "solana") continue;
        const desc = (token.description || "").toLowerCase();
        const tickerMatch = desc.match(/\$([a-z][a-z0-9]{1,11})\b/);
        if (tickerMatch) {
          const ticker = tickerMatch[1];
          if (!BLACKLIST.has(ticker) && ticker.length >= 2) {
            results.push({ keyword: ticker, score: 25000, hasTicker: true });
          }
        }
        // Also grab name words from description
        const nameWords = desc.match(/\b([a-z][a-z0-9]{2,11})\b/g) || [];
        for (const w of nameWords.slice(0, 5)) {
          if (!BLACKLIST.has(w) && w.length >= 3) {
            results.push({ keyword: w, score: 5000, hasTicker: false });
          }
        }
      }
    }
  } catch {
    /* continue */
  }

  try {
    // Boosted tokens — these have active marketing spend
    const r = await safeFetch(
      "https://api.dexscreener.com/token-boosts/top/v1",
    );
    if (r) {
      const data = await r.json();
      for (const token of (data || []).slice(0, 30)) {
        if (token.chainId !== "solana") continue;
        const desc = (token.description || "").toLowerCase();
        const tickerMatch = desc.match(/\$([a-z][a-z0-9]{1,11})\b/);
        if (tickerMatch) {
          const ticker = tickerMatch[1];
          if (!BLACKLIST.has(ticker) && ticker.length >= 2) {
            results.push({
              keyword: ticker,
              score: 18000 + (token.totalAmount || 0),
              hasTicker: true,
            });
          }
        }
      }
    }
  } catch {
    /* continue */
  }

  try {
    // Latest Solana pairs — search for new pairs with low market cap
    const searches = ["solana meme", "pump fun", "new token"];
    for (const q of searches) {
      const r = await safeFetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
      );
      if (!r) continue;
      const data = await r.json();
      const pairs = (data?.pairs || []).filter(
        (p: { chainId: string; fdv?: number; pairCreatedAt?: number }) =>
          p.chainId === "solana" &&
          (p.fdv || 0) < 5_000_000 && // under $5M mcap only
          p.pairCreatedAt &&
          Date.now() - p.pairCreatedAt < 86400000, // < 24h old
      );
      for (const pair of pairs.slice(0, 20)) {
        const sym = (pair.baseToken?.symbol || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        const vol = pair.volume?.h24 || 0;
        const change = pair.priceChange?.h24 || 0;
        if (
          sym.length >= 2 &&
          sym.length <= 12 &&
          !BLACKLIST.has(sym) &&
          vol > 1000
        ) {
          results.push({
            keyword: sym,
            score: vol * 0.5 + change * 100,
            hasTicker: true,
            mcap: pair.fdv,
          });
        }
      }
    }
  } catch {
    /* continue */
  }

  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 4 — CoinGecko: New listings + trending (free, no key needed)
// Focus on newly listed coins, not the established top 100
// ════════════════════════════════════════════════════════════════════════════
async function scanCoinGecko() {
  const results: { keyword: string; score: number; isNew: boolean }[] = [];

  try {
    // Trending searches right now
    const r = await safeFetch(
      "https://api.coingecko.com/api/v3/search/trending",
    );
    if (r) {
      const data = await r.json();
      for (const { item } of data?.coins || []) {
        const sym = (item.symbol || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const name = (item.name || "")
          .toLowerCase()
          .replace(/\s+/g, "")
          .replace(/[^a-z0-9]/g, "");
        const rank = item.score ?? 10;
        const val = Math.max(40000 - rank * 3500, 3000);
        if (sym.length >= 2 && sym.length <= 12 && !BLACKLIST.has(sym)) {
          results.push({ keyword: sym, score: val, isNew: false });
        }
        if (
          name.length >= 3 &&
          name.length <= 14 &&
          !BLACKLIST.has(name) &&
          name !== sym
        ) {
          results.push({ keyword: name, score: val * 0.6, isNew: false });
        }
      }
    }
  } catch {
    /* continue */
  }

  try {
    // Recently added coins — small caps that just got listed
    const r = await safeFetch(
      "https://api.coingecko.com/api/v3/coins/list/new",
    );
    if (r) {
      const data: { symbol: string; name: string; activated_at: number }[] =
        await r.json();
      const now = Date.now() / 1000;
      for (const coin of (data || []).slice(0, 50)) {
        const sym = (coin.symbol || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const ageHours = (now - (coin.activated_at || now)) / 3600;
        const freshBonus = ageHours < 24 ? 2.0 : ageHours < 72 ? 1.3 : 1.0;
        if (sym.length >= 2 && sym.length <= 12 && !BLACKLIST.has(sym)) {
          results.push({
            keyword: sym,
            score: 15000 * freshBonus,
            isNew: ageHours < 72,
          });
        }
      }
    }
  } catch {
    /* continue */
  }

  try {
    // Top gainers in last 24h among small caps — velocity signal
    const r = await safeFetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=percent_change_24h_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h&market_cap_max=50000000",
    );
    if (r) {
      const data = await r.json();
      for (const coin of data || []) {
        const sym = (coin.symbol || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const change = coin.price_change_percentage_24h || 0;
        const vol = coin.total_volume || 0;
        const mcap = coin.market_cap || 0;
        if (
          sym.length >= 2 &&
          sym.length <= 12 &&
          !BLACKLIST.has(sym) &&
          change > 20 && // only 20%+ movers
          mcap < 50_000_000 // under $50M mcap
        ) {
          results.push({
            keyword: sym,
            score: Math.round(vol * 0.01 + change * 800),
            isNew: mcap < 5_000_000,
          });
        }
      }
    }
  } catch {
    /* continue */
  }

  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 5 — Google Trends via RSS (completely free, no key)
// Catches what's trending on Google before it hits crypto
// ════════════════════════════════════════════════════════════════════════════
async function scanGoogleTrends() {
  const results: { keyword: string; score: number }[] = [];
  try {
    const r = await safeFetch(
      "https://trends.google.com/trending/rss?geo=US",
      { Accept: "application/rss+xml, text/xml" },
      8000,
    );
    if (!r) return results;
    const xml = await r.text();

    // Parse trending topics from RSS
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

      const trafficStr = (trafficMatches[i] || "")
        .replace(/<ht:approx_traffic>/, "")
        .replace(/<\/ht:approx_traffic>/, "")
        .replace(/[^0-9]/g, "");
      const traffic = parseInt(trafficStr) || 10000;

      // Extract potential meme words from trending topics
      const words = title.split(/[\s\-_,.()/]+/);
      for (const w of words) {
        const clean = w.replace(/[^a-z0-9]/g, "");
        if (clean.length >= 3 && clean.length <= 14 && !BLACKLIST.has(clean)) {
          results.push({ keyword: clean, score: traffic * 0.05 });
        }
      }

      // Full multi-word trends as compound keywords (e.g. "babydoge")
      const compound = title
        .replace(/[\s\-_,.()/]+/g, "")
        .replace(/[^a-z0-9]/g, "");
      if (
        compound.length >= 3 &&
        compound.length <= 16 &&
        !BLACKLIST.has(compound)
      ) {
        results.push({ keyword: compound, score: traffic * 0.08 });
      }
    }
  } catch {
    /* continue */
  }
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 6 — CoinMarketCap new listings (public, no key required)
// ════════════════════════════════════════════════════════════════════════════
async function scanCMCNew() {
  const results: { keyword: string; score: number }[] = [];
  try {
    const r = await safeFetch(
      "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing/new?start=1&limit=50&convertId=2781",
      { "Accept-Language": "en-US", Referer: "https://coinmarketcap.com/" },
    );
    if (!r) return results;
    const data = await r.json();
    const coins = data?.data?.recentlyAdded || data?.data || [];
    for (const coin of coins) {
      const sym = (coin.symbol || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const vol = coin.volume24h || coin.statistics?.volume24h || 0;
      if (
        sym.length >= 2 &&
        sym.length <= 12 &&
        !BLACKLIST.has(sym) &&
        vol > 0
      ) {
        results.push({ keyword: sym, score: Math.min(vol * 0.001, 30000) });
      }
    }
  } catch {
    /* continue */
  }
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════════════
export async function GET() {
  const scoreMap = new Map<string, ScoreEntry>();
  const logs: string[] = [];

  const upsert = (
    word: string,
    amount: number,
    platform: string,
    sourceLabel: string,
    field: "socialScore" | "onchainScore" | "geckoScore",
    opts: {
      hasTicker?: boolean;
      isNewCoin?: boolean;
      ageMinutes?: number;
      mcap?: number;
      volume?: number;
    } = {},
  ) => {
    const key = word.toLowerCase().trim();
    if (!key || key.length < 2 || key.length > 16) return;
    if (BLACKLIST.has(key)) return;
    if (/^\d+$/.test(key)) return;
    if (!/^[a-z][a-z0-9]*$/.test(key)) return;
    if (amount <= 0) return;

    if (scoreMap.has(key)) {
      const e = scoreMap.get(key)!;
      e[field] += amount;
      e.posts += 1;
      if (!e.sources.includes(sourceLabel)) e.sources.push(sourceLabel);
      if (!e.platforms.includes(platform)) e.platforms.push(platform);
      if (opts.hasTicker) e.hasTicker = true;
      if (opts.isNewCoin) e.isNewCoin = true;
      if (
        opts.ageMinutes !== undefined &&
        (e.ageMinutes === undefined || opts.ageMinutes < e.ageMinutes)
      )
        e.ageMinutes = opts.ageMinutes;
      if (opts.mcap) e.mcap = opts.mcap;
      if (opts.volume) e.volume = opts.volume;
    } else {
      const entry: ScoreEntry = {
        socialScore: 0,
        onchainScore: 0,
        geckoScore: 0,
        posts: 1,
        hasTicker: opts.hasTicker || false,
        isNewCoin: opts.isNewCoin || false,
        ageMinutes: opts.ageMinutes,
        sources: [sourceLabel],
        platforms: [platform],
        mcap: opts.mcap,
        volume: opts.volume,
      };
      entry[field] = amount;
      scoreMap.set(key, entry);
    }
  };

  // ── Run all sources in parallel ────────────────────────────────────────────
  const [
    pumpResults,
    dexResults,
    geckoResults,
    googleResults,
    cmcResults,
    ...redditResults
  ] = await Promise.all([
    scanPumpFun(),
    scanDexScreener(),
    scanCoinGecko(),
    scanGoogleTrends(),
    scanCMCNew(),
    ...REDDIT_SUBS.map((s) => scanReddit(s.name, s.tier)),
  ]);

  // ── Process Pump.fun ──────────────────────────────────────────────────────
  for (const p of pumpResults) {
    upsert(p.keyword, p.score, "pumpfun", "Pump.fun", "onchainScore", {
      hasTicker: true,
      isNewCoin: p.isNew,
      ageMinutes: p.ageMinutes,
      mcap: p.mcap,
      volume: p.volume,
    });
  }
  logs.push(`[Pump.fun] ${pumpResults.length} new token signals`);

  // ── Process DexScreener ───────────────────────────────────────────────────
  for (const d of dexResults) {
    upsert(d.keyword, d.score, "dexscreener", "DexScreener", "onchainScore", {
      hasTicker: d.hasTicker,
      isNewCoin: true,
      mcap: d.mcap,
    });
  }
  logs.push(`[DexScreener] ${dexResults.length} new pair signals`);

  // ── Process CoinGecko ─────────────────────────────────────────────────────
  for (const g of geckoResults) {
    upsert(g.keyword, g.score, "coingecko", "CoinGecko", "geckoScore", {
      hasTicker: true,
      isNewCoin: g.isNew,
    });
  }
  logs.push(`[CoinGecko] ${geckoResults.length} trending+new signals`);

  // ── Process Google Trends ─────────────────────────────────────────────────
  for (const g of googleResults) {
    upsert(g.keyword, g.score, "google", "Google Trends", "socialScore");
  }
  logs.push(`[Google Trends] ${googleResults.length} trending topic words`);

  // ── Process CMC New ───────────────────────────────────────────────────────
  for (const c of cmcResults) {
    upsert(c.keyword, c.score, "cmc", "CoinMarketCap New", "geckoScore", {
      hasTicker: true,
      isNewCoin: true,
    });
  }
  logs.push(`[CMC] ${cmcResults.length} new listings`);

  // ── Process Reddit ────────────────────────────────────────────────────────
  let totalRedditSignals = 0;
  for (const { sub, tier, posts } of redditResults) {
    let signals = 0;
    for (const { title, score: upvotes, flair, comments } of posts) {
      const heat = Math.max(upvotes, 1) + comments * 2; // comments = engagement
      const full = `${title} ${flair}`.toLowerCase();

      // $TICKER — highest confidence signal
      const tickerMatches = full.match(/\$([a-z][a-z0-9]{1,11})\b/g) || [];
      for (const m of tickerMatches) {
        const ticker = m.replace("$", "");
        if (!BLACKLIST.has(ticker) && ticker.length >= 2) {
          upsert(ticker, heat * 8 * tier, "reddit", `r/${sub}`, "socialScore", {
            hasTicker: true,
          });
          signals++;
        }
      }

      // coin/inu/token suffix patterns
      const coinPatterns =
        full.match(
          /\b([a-z]{2,10})(coin|inu|token|swap|fi|dao|ai|doge|cat|pepe|frog|chad)\b/g,
        ) || [];
      for (const m of coinPatterns) {
        const base = m.replace(
          /(coin|inu|token|swap|fi|dao|ai|doge|cat|pepe|frog|chad)$/,
          "",
        );
        if (base.length >= 2 && !BLACKLIST.has(base)) {
          upsert(base, heat * 3 * tier, "reddit", `r/${sub}`, "socialScore", {
            hasTicker: false,
          });
        }
        // Also add the full compound
        const compound = m.replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
        if (
          compound.length >= 3 &&
          compound.length <= 14 &&
          !BLACKLIST.has(compound)
        ) {
          upsert(
            compound,
            heat * 4 * tier,
            "reddit",
            `r/${sub}`,
            "socialScore",
            { hasTicker: false },
          );
        }
      }

      // For high-tier crypto subs: extract all meaningful words
      if (tier >= 4) {
        const words = full.split(/[\s,.\-!?()[\]{}"':;/\\|<>@#%^&*+=~`]+/);
        for (const w of words) {
          const clean = w.replace(/[^a-z0-9]/g, "");
          if (
            clean.length >= 3 &&
            clean.length <= 12 &&
            !BLACKLIST.has(clean)
          ) {
            upsert(clean, heat * tier, "reddit", `r/${sub}`, "socialScore");
          }
        }
      }
    }
    totalRedditSignals += signals;
    logs.push(`[Reddit] r/${sub} → ${posts.length} posts scanned`);
  }
  logs.push(`[Reddit] Total $TICKER signals: ${totalRedditSignals}`);

  // ── Final Scoring ─────────────────────────────────────────────────────────
  // Logic:
  // 1. Social signal from Reddit/Google = viral moment potential
  // 2. On-chain from Pump/Dex = already launched, has real activity
  // 3. Cross-platform = massive bonus (means the meme is escaping one silo)
  // 4. NEW coins get a bonus vs established ones
  // 5. $TICKER mentions = 3x bonus (someone explicitly made it a coin)

  const results = Array.from(scoreMap.entries())
    .map(([keyword, v]) => {
      const platformCount = v.platforms.length;
      const crossBonus =
        platformCount >= 5
          ? 3.0
          : platformCount >= 4
            ? 2.2
            : platformCount >= 3
              ? 1.6
              : platformCount >= 2
                ? 1.2
                : 1.0;
      const tickerBonus = v.hasTicker ? 3.5 : 1.0;
      const newCoinBonus = v.isNewCoin ? 2.0 : 1.0;
      const mentionWeight = Math.log2(v.posts + 2);

      // Social weighted more for pure meme plays, onchain for launched coins
      const raw =
        v.socialScore * 1.2 + v.onchainScore * 2.8 + v.geckoScore * 2.0;
      const final = Math.round(
        raw * mentionWeight * tickerBonus * crossBonus * newCoinBonus,
      );

      // Age label
      let ageLabel: string | undefined;
      if (v.ageMinutes !== undefined) {
        if (v.ageMinutes < 60) ageLabel = `${v.ageMinutes}m old`;
        else if (v.ageMinutes < 1440)
          ageLabel = `${Math.floor(v.ageMinutes / 60)}h old`;
        else ageLabel = `${Math.floor(v.ageMinutes / 1440)}d old`;
      }

      return {
        keyword,
        score: final,
        posts: v.posts,
        source:
          v.sources.length > 2
            ? `${v.sources.slice(0, 2).join(" + ")} +${v.sources.length - 2}`
            : v.sources.join(" + ") || "unknown",
        hasTicker: v.hasTicker,
        isNewCoin: v.isNewCoin,
        crossPlatforms: platformCount,
        platforms: v.platforms,
        ageLabel,
        mcap: v.mcap,
        volume: v.volume,
        onTrends:
          v.platforms.includes("coingecko") || v.platforms.includes("google"),
        onDex:
          v.platforms.includes("dexscreener") ||
          v.platforms.includes("pumpfun"),
      };
    })
    .filter((r) => r.score >= MIN_FINAL_SCORE || (r.hasTicker && r.isNewCoin))
    .sort((a, b) => {
      // Sort: new coins with social signal bubble to top
      const aBoost = a.isNewCoin && a.crossPlatforms >= 2 ? 1.5 : 1;
      const bBoost = b.isNewCoin && b.crossPlatforms >= 2 ? 1.5 : 1;
      return b.score * bBoost - a.score * aBoost;
    })
    .slice(0, 60);

  logs.push(`[Done] ${results.length} results — showing new low caps first`);

  return NextResponse.json({
    results,
    logs,
    scannedAt: new Date().toISOString(),
  });
}
