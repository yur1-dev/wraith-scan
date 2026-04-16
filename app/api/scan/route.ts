import { NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════════════════
// WRAITH SCANNER v5 — Real Signal Only
// Sources:
//   0. Telegram public channel previews (t.me/s/) — no bot token needed
//   1. Twitter/X via syndication.twitter.com — no API key needed
//   2. Pump.fun frontend API
//   3. DexScreener new pairs + profiles + boosts
//   4. CoinGecko trending + new listings
//   5. Google Trends RSS
//   6. Reddit
//   7. CoinMarketCap new listings
//   + Rugcheck.xyz per-token safety check (free, no key)
//   + Hard quality filters: liquidity, age, price change sanity
// ═══════════════════════════════════════════════════════════════════════════

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, Accept: "application/json" };

// ── Telegram public alpha channels (no auth, t.me/s/ is public HTML preview)
const TELEGRAM_CHANNELS = [
  "solanaalpha",
  "pumpfunalpha",
  "solana_memes_official",
  "solanamemecoins",
  "solfinder",
  "solanagemhunters",
  "newsolanatoken",
  "pepeonsolana",
  "solanadegen",
  "pumpfunsnipers",
  "solanaearlyalpha",
  "cryptomoonshots",
  "solgems100x",
  "solana_100x_gems",
  "degen_sol_alpha",
  "pumpfunlaunch",
  "solanacement",
  "sollaunchpad",
  "memecoinsniper",
];

// ── Twitter search terms for Solana meme coins (syndication endpoint)
const TWITTER_QUERIES = [
  "pump.fun just launched",
  "new solana meme coin",
  "$sol low cap gem",
  "buy on pump.fun",
  "solana 1000x",
  "new gem solana",
  "solana microcap",
  "pumpfun new launch",
];

// ── Reddit subs
const REDDIT_SUBS = [
  { name: "CryptoMoonShots", tier: 5 },
  { name: "SatoshiStreetBets", tier: 5 },
  { name: "memecoinsmoonshots", tier: 5 },
  { name: "pumpfun", tier: 5 },
  { name: "solana", tier: 4 },
  { name: "CryptoCurrency", tier: 3 },
  { name: "memes", tier: 3 },
  { name: "dankmemes", tier: 3 },
];

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
  "went",
  "come",
  "came",
  "left",
  "stay",
  "move",
  "play",
  "stop",
  "start",
  "help",
  "show",
  "tell",
  "keep",
  "hold",
  "walk",
  "talk",
  "read",
  "write",
  "draw",
  "pick",
  "drop",
  "push",
  "pull",
  "turn",
  "send",
  "find",
  "lose",
  "win",
  "beat",
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
  "own",
  "seem",
  "sound",
  "smell",
  "taste",
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
  "launch",
  "launched",
  "launching",
  "token",
  "coin",
  "gem",
  "alpha",
  "early",
  "call",
  "calls",
  "signal",
  "next",
  "up",
  "down",
  "side",
  "back",
  "into",
  "send",
  "mint",
  "join",
  "group",
  "chat",
  "channel",
  "tg",
  "telegram",
  "twitter",
  "discord",
  "announcement",
  "ann",
  "pinned",
  "message",
  "click",
  "link",
  "here",
  "check",
  "see",
  "look",
  "watch",
  "follow",
  "share",
  "like",
  "comment",
  "repost",
  "retweet",
  "rt",
  "dm",
  "dms",
  "reply",
  "thread",
  "news",
  "update",
  "info",
  "soon",
  "live",
  "now",
  "today",
  "tonight",
  "morning",
  "night",
  "week",
  "month",
  "year",
  "day",
  "time",
  "hours",
  "mins",
  "minutes",
  "seconds",
  "ago",
  "later",
  "next",
  "last",
  "first",
  "second",
  "third",
  "once",
  "twice",
  "always",
  "never",
  "maybe",
  "yes",
  "no",
  "ok",
  "okay",
  "sure",
  "fine",
  "great",
  "good",
  "bad",
  "best",
  "worst",
  "right",
  "wrong",
  "true",
  "false",
  "real",
  "fake",
  "safe",
  "scam",
  "rug",
  "rugged",
]);

const TICKER_RE = /\$([a-zA-Z][a-zA-Z0-9]{1,11})\b/g;
const WORD_RE = /\b([a-zA-Z][a-zA-Z0-9]{2,11})\b/g;

interface ScoreEntry {
  socialScore: number;
  onchainScore: number;
  geckoScore: number;
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
  twitterMentions?: number;
  telegramMentions?: number;
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

function cleanTicker(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isValidKeyword(k: string): boolean {
  if (!k || k.length < 2 || k.length > 14) return false;
  if (BLACKLIST.has(k.toLowerCase())) return false;
  if (/^\d+$/.test(k)) return false;
  if (!/^[a-z][a-z0-9]*$/.test(k.toLowerCase())) return false;
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 0 — Telegram public channel previews (t.me/s/CHANNELNAME)
// Telegram shows recent posts as HTML on the /s/ endpoint — zero auth needed.
// We scrape text content for $TICKER mentions and launch keywords.
// ════════════════════════════════════════════════════════════════════════════
async function scanTelegram(): Promise<{
  results: {
    keyword: string;
    score: number;
    mentions: number;
    channels: string[];
  }[];
  channelsHit: number;
  totalMessages: number;
}> {
  const tickerMap = new Map<string, { count: number; channels: Set<string> }>();
  let channelsHit = 0;
  let totalMessages = 0;

  const scrapeChannel = async (channel: string) => {
    try {
      const r = await safeFetch(
        `https://t.me/s/${channel}`,
        {
          Accept: "text/html,application/xhtml+xml,*/*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        8000,
      );
      if (!r) return;

      const html = await r.text();
      if (!html.includes("tgme_widget_message_text")) return;

      channelsHit++;

      // Extract message text blocks
      const msgBlocks =
        html.match(
          /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
        ) || [];
      totalMessages += msgBlocks.length;

      for (const block of msgBlocks) {
        // Strip HTML tags
        const text = block.replace(/<[^>]+>/g, " ").toLowerCase();

        // $TICKER patterns — strongest signal
        const tickerMatches = [...text.matchAll(TICKER_RE)];
        for (const m of tickerMatches) {
          const ticker = cleanTicker(m[1]);
          if (isValidKeyword(ticker)) {
            const existing = tickerMap.get(ticker) || {
              count: 0,
              channels: new Set(),
            };
            existing.count += 3; // $TICKER mention = 3 weight
            existing.channels.add(channel);
            tickerMap.set(ticker, existing);
          }
        }

        // Launch keyword patterns — "just launched X", "new gem: X", "ca: ADDR"
        const launchPatterns = [
          /(?:just launched|new gem|launching now|fresh launch|early call)[:\s]+([a-z][a-z0-9]{1,11})\b/gi,
          /(?:ticker|symbol)[:\s]+\$?([a-z][a-z0-9]{1,11})\b/gi,
          /\b([a-z][a-z0-9]{2,11})\s+(?:just launched|on pump|on solana|pumpfun)\b/gi,
        ];

        for (const pattern of launchPatterns) {
          const matches = [...text.matchAll(pattern)];
          for (const m of matches) {
            const word = cleanTicker(m[1] || m[0].split(/\s+/).pop() || "");
            if (isValidKeyword(word)) {
              const existing = tickerMap.get(word) || {
                count: 0,
                channels: new Set(),
              };
              existing.count += 5; // launch context = 5 weight
              existing.channels.add(channel);
              tickerMap.set(word, existing);
            }
          }
        }
      }
    } catch {
      // skip
    }
  };

  // Scrape all channels in parallel batches of 5
  for (let i = 0; i < TELEGRAM_CHANNELS.length; i += 5) {
    await Promise.all(TELEGRAM_CHANNELS.slice(i, i + 5).map(scrapeChannel));
  }

  const results = Array.from(tickerMap.entries()).map(
    ([keyword, { count, channels }]) => ({
      keyword,
      score: count * 8000 * (channels.size > 1 ? 1.5 : 1.0), // multi-channel bonus
      mentions: count,
      channels: Array.from(channels),
    }),
  );

  return { results, channelsHit, totalMessages };
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 1 — Twitter/X via syndication endpoint (no API key)
// twitter.com/search?q=...&src=typed_query has a public syndication layer
// that returns JSON without auth. This is what embeds use.
// ════════════════════════════════════════════════════════════════════════════
async function scanTwitter(): Promise<{
  results: { keyword: string; score: number; tweetCount: number }[];
  tweetsFound: number;
  method: string;
}> {
  const tickerMap = new Map<string, number>();
  let tweetsFound = 0;
  let method = "none";

  // Method 1: Twitter syndication search (used by embed widgets)
  const syndicationBase =
    "https://syndication.twitter.com/srv/timeline-profile/screen-name";

  // Method 2: Twitter's public search timeline (works without login for basic searches)
  const searchBase = "https://twitter.com/i/api/2/search/adaptive.json";

  // Method 3: Scrape public search pages (fallback)
  const scrapeTwitterSearch = async (query: string) => {
    try {
      // Try the public syndication search endpoint
      const encoded = encodeURIComponent(query);
      const url = `https://syndication.twitter.com/search/embedded-timeline?query=${encoded}&lang=en`;

      const r = await safeFetch(
        url,
        {
          Accept: "application/json, text/javascript, */*",
          Referer: "https://twitter.com/",
          "X-Twitter-Active-User": "yes",
        },
        8000,
      );

      if (r) {
        method = "syndication";
        const text = await r.text();
        // Extract $TICKER from the response HTML/JSON
        const tickerMatches = [...text.matchAll(TICKER_RE)];
        for (const m of tickerMatches) {
          const ticker = cleanTicker(m[1]);
          if (isValidKeyword(ticker)) {
            tickerMap.set(ticker, (tickerMap.get(ticker) || 0) + 1);
            tweetsFound++;
          }
        }
        return true;
      }
    } catch {
      /* continue */
    }
    return false;
  };

  // Try public Nitter instances as fallback (try more obscure ones)
  const NITTER_INSTANCES = [
    "https://nitter.lucabased.xyz",
    "https://nitter.privacydev.net",
    "https://nitter.poast.org",
    "https://nitter.1d4.us",
    "https://nitter.cz",
    "https://nitter.space",
    "https://nitter.ca",
  ];

  let nitterWorking = "";
  for (const instance of NITTER_INSTANCES) {
    try {
      const r = await safeFetch(
        `${instance}/search/rss?q=pump.fun&f=tweets`,
        { Accept: "application/rss+xml, text/xml, */*" },
        4000,
      );
      if (r) {
        const text = await r.text();
        if (text.includes("<item>") || text.includes("<channel>")) {
          nitterWorking = instance;
          method = "nitter:" + instance.replace("https://", "");
          break;
        }
      }
    } catch {
      /* next */
    }
  }

  if (nitterWorking) {
    for (const query of TWITTER_QUERIES) {
      try {
        const r = await safeFetch(
          `${nitterWorking}/search/rss?q=${encodeURIComponent(query)}&f=tweets`,
          { Accept: "application/rss+xml, text/xml, */*" },
          7000,
        );
        if (!r) continue;
        const xml = await r.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        tweetsFound += items.length;
        for (const item of items) {
          const titleM = item.match(
            /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/,
          );
          const descM = item.match(
            /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/,
          );
          const rawText = [titleM?.[1] || "", descM?.[1] || ""]
            .join(" ")
            .replace(/<[^>]+>/g, " ")
            .toLowerCase();

          const tickerMatches = [...rawText.matchAll(TICKER_RE)];
          for (const m of tickerMatches) {
            const ticker = cleanTicker(m[1]);
            if (isValidKeyword(ticker)) {
              tickerMap.set(ticker, (tickerMap.get(ticker) || 0) + 2);
            }
          }
        }
      } catch {
        /* skip */
      }
    }
  } else {
    // Try syndication as last resort
    for (const query of TWITTER_QUERIES.slice(0, 4)) {
      await scrapeTwitterSearch(query);
    }
  }

  const results = Array.from(tickerMap.entries()).map(([keyword, count]) => ({
    keyword,
    score: count * 11000,
    tweetCount: count,
  }));

  return { results, tweetsFound, method };
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 2 — Pump.fun
// ════════════════════════════════════════════════════════════════════════════
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

  const endpoints = [
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins/king-of-the-hill?includeNsfw=false",
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

        // Quality filter: skip if too old or no activity
        if (ageMinutes > 2880) continue; // skip > 2 days
        if (mcap === 0 && replies === 0) continue;

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
          freshBonus;

        if (isValidKeyword(sym)) {
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
      }
    } catch {
      /* continue */
    }
  }
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 3 — DexScreener (with quality data: liquidity, price change)
// ════════════════════════════════════════════════════════════════════════════
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

  // New Solana pairs < 24h
  for (const q of ["solana meme", "pump fun solana", "new solana gem"]) {
    try {
      const r = await safeFetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
      );
      if (!r) continue;
      const data = await r.json();

      const pairs = (data?.pairs || []).filter(
        (p: {
          chainId: string;
          fdv?: number;
          pairCreatedAt?: number;
          liquidity?: { usd?: number };
        }) =>
          p.chainId === "solana" &&
          (p.fdv || 0) < 10_000_000 && // under $10M mcap
          p.pairCreatedAt &&
          Date.now() - p.pairCreatedAt < 86400000, // < 24h old
      );

      for (const pair of pairs.slice(0, 25)) {
        const sym = cleanTicker(pair.baseToken?.symbol || "");
        const liq = pair.liquidity?.usd || 0;
        const vol24h = pair.volume?.h24 || 0;
        const change1h = pair.priceChange?.h1 || 0;
        const change24h = pair.priceChange?.h24 || 0;
        const ageMinutes = pair.pairCreatedAt
          ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000)
          : undefined;

        // Quality filters
        if (liq < 3000) continue; // skip < $3K liquidity (unbuyable)
        if (change1h > 500) continue; // skip if already 5x'd in last hour
        if (!isValidKeyword(sym)) continue;

        const score = vol24h * 0.4 + liq * 0.3 + Math.max(change24h, 0) * 120;
        results.push({
          keyword: sym,
          score,
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

  // Latest token profiles
  try {
    const r = await safeFetch(
      "https://api.dexscreener.com/token-profiles/latest/v1",
    );
    if (r) {
      const data = await r.json();
      for (const token of (data || []).slice(0, 30)) {
        if (token.chainId !== "solana") continue;
        const desc = (token.description || "").toLowerCase();
        const tickerMatch = desc.match(/\$([a-z][a-z0-9]{1,11})\b/);
        if (tickerMatch?.[1] && isValidKeyword(tickerMatch[1])) {
          results.push({
            keyword: tickerMatch[1],
            score: 20000,
            hasTicker: true,
            contractAddress: token.tokenAddress,
          });
        }
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
        const desc = (token.description || "").toLowerCase();
        const tickerMatch = desc.match(/\$([a-z][a-z0-9]{1,11})\b/);
        if (tickerMatch?.[1] && isValidKeyword(tickerMatch[1])) {
          results.push({
            keyword: tickerMatch[1],
            score: 15000 + (token.totalAmount || 0),
            hasTicker: true,
            contractAddress: token.tokenAddress,
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
// SOURCE 4 — Rugcheck.xyz (free, no key)
// Checks: mint authority, freeze authority, LP locked, top holder concentration
// ════════════════════════════════════════════════════════════════════════════
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
    if (!r) return { risk: "unknown", details: "rugcheck unavailable" };
    const data = await r.json();

    const score = data?.score || 0;
    const risks = (data?.risks || []) as { name: string; level: string }[];
    const highRisks = risks
      .filter((r) => r.level === "danger")
      .map((r) => r.name);
    const medRisks = risks.filter((r) => r.level === "warn").map((r) => r.name);

    if (highRisks.length > 0) {
      return { risk: "high", details: highRisks.slice(0, 2).join(", ") };
    }
    if (score > 5000 || medRisks.length >= 3) {
      return {
        risk: "medium",
        details: medRisks.slice(0, 2).join(", ") || "moderate risk",
      };
    }
    if (score > 0) {
      return { risk: "low", details: "passed rugcheck" };
    }
    return { risk: "unknown", details: "no data" };
  } catch {
    return { risk: "unknown", details: "check failed" };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 5 — CoinGecko trending + new
// ════════════════════════════════════════════════════════════════════════════
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
        if (isValidKeyword(sym)) {
          results.push({
            keyword: sym,
            score: Math.max(40000 - (item.score ?? 10) * 3500, 3000),
            isNew: false,
          });
        }
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
        if (isValidKeyword(sym)) {
          results.push({
            keyword: sym,
            score: 15000 * (ageHours < 24 ? 2.0 : 1.3),
            isNew: ageHours < 72,
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
// SOURCE 6 — Google Trends RSS
// ════════════════════════════════════════════════════════════════════════════
async function scanGoogleTrends() {
  const results: { keyword: string; score: number }[] = [];
  try {
    const r = await safeFetch(
      "https://trends.google.com/trending/rss?geo=US",
      {
        Accept: "application/rss+xml, text/xml",
      },
      8000,
    );
    if (!r) return results;
    const xml = await r.text();
    const titleMatches =
      xml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g) || [];
    const trafficMatches =
      xml.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/g) || [];
    for (let i = 0; i < titleMatches.length; i++) {
      const title = titleMatches[i]
        .replace(/<title><!\[CDATA\[/, "")
        .replace(/\]\]><\/title>/, "")
        .toLowerCase();
      const traffic =
        parseInt(
          (trafficMatches[i] || "")
            .replace(/<[^>]*>/g, "")
            .replace(/[^0-9]/g, ""),
        ) || 10000;
      for (const w of title.split(/[\s\-_,.()/]+/)) {
        const clean = cleanTicker(w);
        if (isValidKeyword(clean))
          results.push({ keyword: clean, score: traffic * 0.04 });
      }
    }
  } catch {
    /* continue */
  }
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 7 — Reddit
// ════════════════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════════════════
// SOURCE 8 — CoinMarketCap new listings
// ════════════════════════════════════════════════════════════════════════════
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
      if (isValidKeyword(sym) && vol > 0) {
        results.push({ keyword: sym, score: Math.min(vol * 0.001, 25000) });
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
    field: keyof Pick<
      ScoreEntry,
      | "socialScore"
      | "onchainScore"
      | "geckoScore"
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
      >
    > = {},
  ) => {
    const key = word.toLowerCase().trim();
    if (!isValidKeyword(key)) return;
    if (amount <= 0) return;

    const existing = scoreMap.get(key);
    if (existing) {
      existing[field] = (existing[field] as number) + amount;
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
    } else {
      const entry: ScoreEntry = {
        socialScore: 0,
        onchainScore: 0,
        geckoScore: 0,
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
      };
      (entry[field] as number) = amount;
      scoreMap.set(key, entry);
    }
  };

  // ── Run all sources in parallel
  const [
    telegramData,
    twitterData,
    pumpResults,
    dexResults,
    geckoResults,
    googleResults,
    cmcResults,
    ...redditResults
  ] = await Promise.all([
    scanTelegram(),
    scanTwitter(),
    scanPumpFun(),
    scanDexScreener(),
    scanCoinGecko(),
    scanGoogleTrends(),
    scanCMCNew(),
    ...REDDIT_SUBS.map((s) => scanReddit(s.name, s.tier)),
  ]);

  // Process Telegram
  for (const t of telegramData.results) {
    upsert(
      t.keyword,
      t.score,
      "telegram",
      `TG(${t.channels.slice(0, 2).join(",")})`,
      "telegramScore",
      { hasTicker: true },
    );
    const e = scoreMap.get(t.keyword);
    if (e) e.telegramMentions = t.mentions;
  }
  logs.push(
    `[Telegram] ${telegramData.channelsHit}/${TELEGRAM_CHANNELS.length} channels hit — ${telegramData.totalMessages} msgs — ${telegramData.results.length} tickers`,
  );

  // Process Twitter
  for (const t of twitterData.results) {
    upsert(t.keyword, t.score, "twitter", "Twitter/X", "twitterScore", {
      hasTicker: true,
    });
    const e = scoreMap.get(t.keyword);
    if (e) e.twitterMentions = t.tweetCount;
  }
  logs.push(
    `[Twitter/X] method:${twitterData.method} — ${twitterData.tweetsFound} tweets — ${twitterData.results.length} tickers`,
  );

  // Process Pump.fun
  for (const p of pumpResults) {
    upsert(p.keyword, p.score, "pumpfun", "Pump.fun", "onchainScore", {
      hasTicker: true,
      isNewCoin: p.isNew,
      ageMinutes: p.ageMinutes,
      mcap: p.mcap,
      volume: p.volume,
      contractAddress: p.contractAddress,
    });
  }
  logs.push(`[Pump.fun] ${pumpResults.length} signals`);

  // Process DexScreener
  for (const d of dexResults) {
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
  }
  logs.push(`[DexScreener] ${dexResults.length} signals`);

  // Process CoinGecko
  for (const g of geckoResults) {
    upsert(g.keyword, g.score, "coingecko", "CoinGecko", "geckoScore", {
      hasTicker: true,
      isNewCoin: g.isNew,
    });
  }
  logs.push(`[CoinGecko] ${geckoResults.length} signals`);

  // Process Google Trends
  for (const g of googleResults) {
    upsert(g.keyword, g.score, "google", "Google Trends", "socialScore");
  }
  logs.push(`[Google] ${googleResults.length} trend words`);

  // Process CMC
  for (const c of cmcResults) {
    upsert(c.keyword, c.score, "cmc", "CMC New", "geckoScore", {
      hasTicker: true,
      isNewCoin: true,
    });
  }
  logs.push(`[CMC] ${cmcResults.length} new listings`);

  // Process Reddit
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
      for (const m of full.match(
        /\b([a-z]{2,10})(coin|inu|token|fi|dao|ai|doge|cat|pepe|frog|chad)\b/g,
      ) || []) {
        const compound = m.replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
        if (isValidKeyword(compound)) {
          upsert(
            compound,
            heat * 4 * tier,
            "reddit",
            `r/${sub}`,
            "socialScore",
          );
        }
      }
    }
  }
  logs.push(`[Reddit] $TICKER mentions: ${totalRedditTickers}`);

  // ── Rugcheck top on-chain results (parallel, max 15 checks)
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
      const result = await checkRug(v.contractAddress!);
      return { key, ...result };
    }),
  );

  for (const { key, risk, details } of rugChecks) {
    const entry = scoreMap.get(key);
    if (entry) {
      entry.rugRisk = risk;
      entry.rugDetails = details;
    }
  }
  logs.push(`[Rugcheck] checked ${rugChecks.length} tokens`);

  // ── Final scoring & sort
  const MIN_SCORE = 300;

  const results = Array.from(scoreMap.entries())
    .map(([keyword, v]) => {
      const platformCount = v.platforms.length;
      const crossBonus =
        platformCount >= 5
          ? 3.2
          : platformCount >= 4
            ? 2.4
            : platformCount >= 3
              ? 1.7
              : platformCount >= 2
                ? 1.25
                : 1.0;
      const tickerBonus = v.hasTicker ? 3.5 : 1.0;
      const newCoinBonus = v.isNewCoin ? 2.2 : 1.0;
      const twitterBonus = v.twitterScore > 0 ? 2.0 : 1.0;
      const telegramBonus = v.telegramScore > 0 ? 2.2 : 1.0;
      const rugPenalty =
        v.rugRisk === "high" ? 0.1 : v.rugRisk === "medium" ? 0.6 : 1.0;
      const mentionWeight = Math.log2(v.posts + 2);

      // Liquidity quality bonus — real buyable liquidity
      const liqBonus = v.liquidity
        ? v.liquidity > 50000
          ? 1.5
          : v.liquidity > 20000
            ? 1.3
            : v.liquidity > 5000
              ? 1.1
              : 0.7
        : 1.0;

      const raw =
        v.socialScore * 1.2 +
        v.onchainScore * 2.8 +
        v.geckoScore * 2.0 +
        v.twitterScore * 3.5 +
        v.telegramScore * 4.0; // Telegram weighted highest — most direct alpha

      const final = Math.round(
        raw *
          mentionWeight *
          tickerBonus *
          crossBonus *
          newCoinBonus *
          twitterBonus *
          telegramBonus *
          rugPenalty *
          liqBonus,
      );

      let ageLabel: string | undefined;
      if (v.ageMinutes !== undefined) {
        ageLabel =
          v.ageMinutes < 60
            ? `${v.ageMinutes}m old`
            : v.ageMinutes < 1440
              ? `${Math.floor(v.ageMinutes / 60)}h old`
              : `${Math.floor(v.ageMinutes / 1440)}d old`;
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
        mcap: v.mcap,
        volume: v.volume,
        liquidity: v.liquidity,
        priceChange1h: v.priceChange1h,
        priceChange24h: v.priceChange24h,
        contractAddress: v.contractAddress,
        rugRisk: v.rugRisk,
        rugDetails: v.rugDetails,
        twitterMentions: v.twitterMentions,
        telegramMentions: v.telegramMentions,
        onTwitter: v.platforms.includes("twitter"),
        onTelegram: v.platforms.includes("telegram"),
        onDex:
          v.platforms.includes("dexscreener") ||
          v.platforms.includes("pumpfun"),
      };
    })
    // Hard quality filters
    .filter((r) => {
      if (r.score < MIN_SCORE && !r.hasTicker) return false;
      if (r.rugRisk === "high") return false; // never show confirmed rugs
      if (r.priceChange1h !== undefined && r.priceChange1h > 800) return false; // already pumped 8x this hour
      return true;
    })
    .sort((a, b) => {
      const aBoost =
        (a.onTelegram ? 1.8 : 1) *
        (a.onTwitter ? 1.5 : 1) *
        (a.isNewCoin && a.crossPlatforms >= 2 ? 1.4 : 1);
      const bBoost =
        (b.onTelegram ? 1.8 : 1) *
        (b.onTwitter ? 1.5 : 1) *
        (b.isNewCoin && b.crossPlatforms >= 2 ? 1.4 : 1);
      return b.score * bBoost - a.score * aBoost;
    })
    .slice(0, 60);

  logs.push(
    `[Done] ${results.length} results — ${results.filter((r) => r.onTelegram).length} from Telegram — ${results.filter((r) => r.onTwitter).length} from Twitter`,
  );

  return NextResponse.json({
    results,
    logs,
    scannedAt: new Date().toISOString(),
  });
}
