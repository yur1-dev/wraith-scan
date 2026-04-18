import { NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════════════════
// WRAITH SCANNER v13 — STORY-FIRST NARRATIVE ENGINE
//
// THE INSIGHT (from $PICANTE and $DUMBMONEY examples):
//
//   Story → Community emotion → Someone launches coin → Community buys it
//
//   $PICANTE: Pigeon survived typhoon (X post, 12K impressions)
//             → Community felt something → $PICANTE launched → 732% pump
//
//   $DUMBMONEY: "People called bitcoin DUMB... now its MONEY" (80K impressions)
//               → Community rallied → $DUMBMONEY launched → $5M mcap
//
// WHAT MAKES A STORY COIN-WORTHY (the formula):
//   1. UNDERDOG/SURVIVAL story — animal, person, thing that "overcame"
//   2. IRONY/VINDICATION — "they called it dumb, now look"
//   3. IDENTITY RALLYING — "we are X, they said we couldn't"
//   4. ABSURDIST HUMOR — so weird it becomes a movement
//   5. COMMUNITY OWNERSHIP — "this is OUR thing now"
//
// SCANNER FLOW:
//   Wave 1: Find STORIES with coin-spawning potential from social/viral sources
//   Wave 2: For each story, predict the likely ticker (1-2 word noun from story)
//   Wave 3: Check if that ticker ALREADY EXISTS on pump.fun / dex (early entry)
//           OR flag it as "no coin yet" (predictive alpha — buy when it launches)
//   Wave 4: Score by: story strength × coin existence × mcap × age
//
// HARD FILTERS:
//   • mcap > $500K  → skip (already ran)
//   • age > 7 days  → skip (community moved on)
//   • priceChange1h > 300% → skip (mooning now, too late)
//   • priceChange24h > 400% → skip (already ran)
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

// The emotional archetypes that spawn meme coins
// Each has a "coinability" weight — how likely this emotion type is to spawn a coin
const NARRATIVE_ARCHETYPES = [
  {
    type: "survival_underdog",
    weight: 10,
    example: "pigeon survives typhoon → $PICANTE",
  },
  {
    type: "irony_vindication",
    weight: 9,
    example: "bitcoin called dumb → $DUMBMONEY",
  },
  {
    type: "absurd_animal",
    weight: 9,
    example: "weird animal video → coin with animal name",
  },
  {
    type: "community_rally",
    weight: 8,
    example: "we are X, they said we couldn't",
  },
  {
    type: "celebrity_moment",
    weight: 8,
    example: "celeb says word → coin with that word",
  },
  {
    type: "viral_phrase",
    weight: 7,
    example: "catchphrase goes viral → coin ticker",
  },
  {
    type: "meme_format",
    weight: 7,
    example: "new meme format sweeping internet → coin",
  },
  {
    type: "news_irony",
    weight: 6,
    example: "absurd news story → coin named after it",
  },
];

// Hard limits
const MAX_MCAP = 500_000;
const MAX_AGE_DAYS = 7;
const MAX_1H_CHANGE = 300;
const MAX_24H_CHANGE = 400;
const MIN_LIQUIDITY = 2_000;

function mcapMultiplier(mcap: number | undefined): number {
  if (!mcap || mcap === 0) return 1.5; // unknown = fresh launch, bullish
  if (mcap > MAX_MCAP) return 0;
  if (mcap < 5_000) return 10.0; // sub $5K = extremely early
  if (mcap < 20_000) return 7.0;
  if (mcap < 50_000) return 5.0;
  if (mcap < 100_000) return 3.5;
  if (mcap < 200_000) return 2.0;
  if (mcap < 500_000) return 1.0;
  return 0;
}

function ageMultiplier(ageMinutes: number | undefined): number {
  if (ageMinutes === undefined) return 1.0;
  const days = ageMinutes / 1440;
  if (days > MAX_AGE_DAYS) return 0;
  if (days > 3) return 0.15;
  if (days > 1) return 0.5;
  if (days > 0.25) return 1.0; // 6h-24h
  if (days > 0.04) return 2.0; // 1-6h
  return 3.0; // < 1h = jackpot
}

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

// ─────────────────────────────────────────────────────────────────────────────
// STORY REGISTRY — central store of viral stories with coin potential
// ─────────────────────────────────────────────────────────────────────────────
interface ViralStory {
  id: string; // unique id
  headline: string; // the story in plain english
  archetypeType: string; // which archetype this fits
  coinabilityScore: number; // 0-100, how likely to spawn a coin (or already did)
  predictedTickers: string[]; // what tickers would be launched for this story
  confirmedTicker?: string; // if we found an actual coin on pump/dex
  confirmedMcap?: number;
  confirmedAge?: number; // minutes
  confirmedCA?: string;
  source: string;
  impressions?: number; // social signal strength
  emotionWords: string[]; // key emotional words from the story
}

const storyRegistry = new Map<string, ViralStory>();

function registerStory(story: ViralStory) {
  storyRegistry.set(story.id, story);
  // Also register all predicted tickers as viral words
  for (const t of story.predictedTickers) {
    viralWordSet.add(cleanTicker(t));
    viralWordContext.set(cleanTicker(t), story.headline);
  }
}

const viralWordSet = new Set<string>();
const viralWordContext = new Map<string, string>();

function registerViralWord(word: string, context: string) {
  const clean = cleanTicker(word);
  if (!isValidKeyword(clean)) return;
  viralWordSet.add(clean);
  if (!viralWordContext.has(clean)) viralWordContext.set(clean, context);
}

function getNarrativeBonus(ticker: string): {
  bonus: number;
  story: string | undefined;
} {
  const clean = cleanTicker(ticker);
  if (viralWordSet.has(clean))
    return { bonus: 1.0, story: viralWordContext.get(clean) };
  for (const word of viralWordSet) {
    if (word.length >= 4 && (clean.includes(word) || word.includes(clean)))
      return { bonus: 0.5, story: viralWordContext.get(word) };
  }
  return { bonus: 0, story: undefined };
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI — STORY FINDER (the core of v13)
// Instead of asking "find meme coins", we ask "find viral stories with emotional
// coin-spawning potential, and predict what ticker they'd launch as"
// ─────────────────────────────────────────────────────────────────────────────
interface GeminiStory {
  ticker: string; // predicted/confirmed ticker
  headline: string; // the viral story in 1 sentence
  archetypeType: string; // survival_underdog | irony_vindication | absurd_animal | etc
  coinabilityScore: number; // 0-100: how likely this story spawns a coin that pumps
  emotionWords: string[]; // key nouns from story that could be a ticker
  platforms: string[];
  impressions?: number; // rough engagement count
  coinAlreadyExists: boolean; // true if you found a coin with this ticker on pump.fun
  coinMcap?: number; // if it exists, estimated mcap
  coinAgeDays?: number; // if it exists, age in days
  narrativeContext: string; // detailed: "pigeon survived typhoon in Manila → viral X post with 12K views → $PICANTE launched on pump.fun"
  celebMention?: string;
}

async function scanWithGeminiStories(): Promise<{
  stories: GeminiStory[];
  success: boolean;
  error?: string;
}> {
  if (!GEMINI_API_KEY)
    return { stories: [], success: false, error: "No GEMINI_API_KEY" };

  const archetypeDescriptions = NARRATIVE_ARCHETYPES.map(
    (a) => `- ${a.type} (score ${a.weight}/10): e.g. "${a.example}"`,
  ).join("\n");

  const prompt = `You are a meme coin narrative detector. Your job is to find VIRAL STORIES that have spawned (or will spawn) Solana meme coins.

TODAY: ${new Date().toUTCString()}

THE PATTERN YOU ARE LOOKING FOR:
A viral story with emotional resonance → community rallies around it → someone launches a coin with a keyword from the story → community buys because they're emotionally invested.

REAL EXAMPLES OF THIS PATTERN:
1. A pigeon survived a typhoon in Manila (viral X/Twitter post, 12K impressions) 
   → Community called it "Picante" (spicy/resilient) → $PICANTE launched on pump.fun → 732% pump
2. Account "Dumb Money" posted "People called bitcoin DUMB... now its MONEY" (80K impressions, 661 retweets)
   → Community rallied → $DUMBMONEY launched → $5M market cap

STORY ARCHETYPES THAT SPAWN MEME COINS:
${archetypeDescriptions}

YOUR TASK — Search X/Twitter, Reddit, TikTok, YouTube, and news RIGHT NOW:

1. Find viral stories/moments from the LAST 72 HOURS that match these archetypes
2. For each story, identify the 1-3 word NOUN that would become the coin ticker
   (e.g., pigeon story → "PICANTE" or "PIGEON", dumb money story → "DUMBMONEY")
3. Check if a coin with that ticker ALREADY EXISTS on pump.fun (search "pump.fun TICKER")
4. If it exists, estimate its market cap (under $500K = actionable, over = already ran)

PRIORITY ORDER:
- Fresh story (< 24h) + coin just launched (< 6h) + mcap < $50K = JACKPOT (score 95+)
- Fresh story (< 48h) + coin < 24h old + mcap < $200K = GREAT (score 80+)  
- Story going viral + no coin yet = PREDICTIVE ALPHA (score 70+, flag coinAlreadyExists=false)
- Story < 7 days + coin exists + mcap < $500K = STILL GOOD (score 60+)

IGNORE: stories where the coin already has $1M+ mcap (too late)
IGNORE: stories older than 7 days

Return ONLY valid JSON, no markdown:
{"stories":[
  {
    "ticker":"PICANTE",
    "headline":"Pigeon survived typhoon in Manila, X post went viral with 12K views",
    "archetypeType":"survival_underdog",
    "coinabilityScore":92,
    "emotionWords":["picante","pigeon","storm","survived"],
    "platforms":["twitter","pumpfun"],
    "impressions":12000,
    "coinAlreadyExists":true,
    "coinMcap":45000,
    "coinAgeDays":0.2,
    "narrativeContext":"A pigeon was filmed surviving a typhoon in Manila. X post by community account got 12K impressions. Someone launched $PICANTE on pump.fun referencing the pigeon. Community rallied around 'storm couldn't shake the pigeon' → coin pumped 732% in 24h",
    "celebMention":null
  }
]}

CRITICAL RULES:
- ticker: 2-12 chars, no spaces — the EXACT word/phrase that would be (or is) the coin
- coinabilityScore: how likely this story spawns a coin that pumps (not just launches)
- emotionWords: the specific nouns/phrases from the story that could become ticker
- If coinAlreadyExists=false, this is PREDICTIVE — flag it clearly in narrativeContext
- MAX 20 stories, highest coinabilityScore first
- Be SPECIFIC about source, engagement numbers, timing`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
      }),
      signal: AbortSignal.timeout(35000),
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
      if (!m) return { stories: [], success: false, error: "Bad JSON" };
      parsed = JSON.parse(m[0]);
    }

    const stories = (parsed.stories || [])
      .filter((s: GeminiStory) => {
        if (!s.ticker || !isValidKeyword(cleanTicker(s.ticker))) return false;
        if (s.coinAgeDays !== undefined && s.coinAgeDays > MAX_AGE_DAYS)
          return false;
        if (s.coinMcap !== undefined && s.coinMcap > MAX_MCAP) return false;
        return true;
      })
      .map((s: GeminiStory) => ({
        ...s,
        ticker: cleanTicker(s.ticker),
        coinabilityScore: Math.min(Math.max(s.coinabilityScore || 50, 1), 100),
      }));

    return { stories, success: true };
  } catch (e) {
    return { stories: [], success: false, error: String(e) };
  }
}

// Second Gemini pass — focused on celebrity/influencer story moments
async function scanGeminiCelebStories(): Promise<{
  stories: GeminiStory[];
  success: boolean;
}> {
  if (!GEMINI_API_KEY) return { stories: [], success: false };

  const prompt = `Search X/Twitter and social media RIGHT NOW (${new Date().toDateString()}):

Find CELEBRITY/INFLUENCER moments from the LAST 48 HOURS where:
- A famous person said/posted something that the crypto community would turn into a meme coin
- The key is: what SPECIFIC WORD or PHRASE from their post would become a ticker?

Examples of celebrity moment → coin pattern:
- Elon posts about "Grok" → $GROK launches
- Trump says "MAGA" repeatedly → $MAGA coin
- Influencer posts crying meme → $CRY coin

Celebs to check: ${CELEB_WATCHLIST.join(", ")}
Also check: any viral political figure, sports star, or entertainment personality

For each moment found:
1. What did they say/post?
2. What WORD from that would become a ticker?
3. Is there already a coin with that word on pump.fun?
4. What's the mcap if it exists?

Return ONLY valid JSON:
{"stories":[{
  "ticker":"WORD",
  "headline":"Brief description of the celebrity moment",
  "archetypeType":"celebrity_moment",
  "coinabilityScore":85,
  "emotionWords":["word1","word2"],
  "platforms":["twitter","pumpfun"],
  "impressions":50000,
  "coinAlreadyExists":true,
  "coinMcap":80000,
  "coinAgeDays":0.3,
  "narrativeContext":"Detailed: what celeb said + when + engagement + coin status",
  "celebMention":"Name"
}]}

Max 10 items. ONLY last 48 hours. Ignore coins over $500K mcap.`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2000 },
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
        if (s.coinAgeDays !== undefined && s.coinAgeDays > MAX_AGE_DAYS)
          return false;
        return true;
      })
      .map((s: GeminiStory) => ({ ...s, ticker: cleanTicker(s.ticker) }));

    return { stories, success: true };
  } catch {
    return { stories: [], success: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUMP.FUN — scan with story context awareness
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

  const endpoints = [
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=reply_count&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins/king-of-the-hill?includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=50&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=market_cap&order=DESC&includeNsfw=false",
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

        if (mcap > MAX_MCAP) continue;
        if (ageMinutes > MAX_AGE_DAYS * 1440) continue;
        if (mcap === 0 && replies === 0) continue;

        const ageMult = ageMultiplier(ageMinutes);
        if (ageMult === 0) continue;
        const mcapMult = mcapMultiplier(mcap);
        if (mcapMult === 0) continue;

        const freshBonus =
          ageMinutes < 30
            ? 6.0
            : ageMinutes < 120
              ? 4.0
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
            name: coin.name || "",
            description: coin.description || "",
          });
        }
      }
    } catch {
      /* continue */
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEXSCREENER
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
    "solana new token",
  ]) {
    try {
      const r = await safeFetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
      );
      if (!r) continue;
      const data = await r.json();

      const pairs = (data?.pairs || []).filter(
        (p: { chainId: string; fdv?: number; pairCreatedAt?: number }) =>
          p.chainId === "solana" &&
          (p.fdv || 0) < MAX_MCAP &&
          p.pairCreatedAt &&
          Date.now() - p.pairCreatedAt < MAX_AGE_DAYS * 86400000,
      );

      for (const pair of pairs.slice(0, 40)) {
        const sym = cleanTicker(pair.baseToken?.symbol || "");
        const liq = pair.liquidity?.usd || 0;
        const vol24h = pair.volume?.h24 || 0;
        const change1h = pair.priceChange?.h1 || 0;
        const change24h = pair.priceChange?.h24 || 0;
        const mcap = pair.fdv || 0;
        const ageMinutes = pair.pairCreatedAt
          ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000)
          : undefined;

        if (liq < MIN_LIQUIDITY) continue;
        if (change1h > MAX_1H_CHANGE) continue;
        if (change24h > MAX_24H_CHANGE) continue;
        if (!isValidKeyword(sym)) continue;

        const ageMult = ageMultiplier(ageMinutes);
        if (ageMult === 0) continue;
        const mcapMult = mcapMultiplier(mcap);
        if (mcapMult === 0) continue;

        results.push({
          keyword: sym,
          hasTicker: true,
          score:
            (vol24h * 0.4 + liq * 0.3 + Math.max(change24h, 0) * 120) *
            ageMult *
            mcapMult,
          mcap,
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
// GOOGLE TRENDS
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
            if (isValidKeyword(clean)) {
              wordMap.set(clean, (wordMap.get(clean) || 0) + traffic);
              registerViralWord(clean, `Google Trends: "${title}" (${geo})`);
            }
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
              registerViralWord(
                compound,
                `Google Trends compound: "${title}" (${geo})`,
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
    results: Array.from(wordMap.entries()).map(([keyword, traffic]) => ({
      keyword,
      score: Math.min(traffic * 0.08, 60000),
    })),
    count: wordMap.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE NEWS
// ─────────────────────────────────────────────────────────────────────────────
async function scanGoogleNews(): Promise<{
  results: { keyword: string; score: number; context: string }[];
  count: number;
}> {
  const wordMap = new Map<string, { score: number; context: string }>();

  const queries = [
    "viral animal video today",
    "funny news story today",
    "viral moment twitter today",
    "solana meme coin new launch",
    "pump.fun viral coin",
    "crypto meme coin launched",
    "viral video meme today",
    "Elon Musk tweet today",
    "Donald Trump meme viral",
    "celebrity post viral today",
    "TikTok viral today",
    "reddit viral today",
    "underdog story viral",
    "survival story viral",
    "absurd news today",
    "meme coin narrative solana",
    "pump fun story coin",
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
              registerViralWord(clean, title.slice(0, 80));
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
              registerViralWord(compound, title.slice(0, 80));
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

  return {
    results: Array.from(wordMap.entries()).map(
      ([keyword, { score, context }]) => ({ keyword, score, context }),
    ),
    count: wordMap.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE TRENDING
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
            if (isValidKeyword(clean)) {
              wordMap.set(clean, (wordMap.get(clean) || 0) + 8000);
              registerViralWord(
                clean,
                `YouTube trending: "${title.slice(0, 60)}"`,
              );
            }
          }
          for (let j = 0; j < words.length - 1; j++) {
            const compound = cleanTicker(words[j] + words[j + 1]);
            if (
              compound.length >= 4 &&
              compound.length <= 16 &&
              isValidKeyword(compound)
            ) {
              wordMap.set(compound, (wordMap.get(compound) || 0) + 12000);
              registerViralWord(
                compound,
                `YouTube trending compound: "${title.slice(0, 60)}"`,
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
// KNOW YOUR MEME
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
        if (isValidKeyword(clean)) {
          results.push({
            keyword: clean,
            score: 25000,
            context: `KYM trending: ${name}`,
          });
          registerViralWord(clean, `KYM trending meme: "${name}"`);
        }
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
        registerViralWord(compound, `KYM trending meme: "${name}"`);
      }
    }
  } catch {
    /* silent */
  }
  return { results, count: results.length };
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
// HACKER NEWS
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
        return sr ? sr.json() : null;
      }),
    );
    for (const story of stories) {
      if (!story?.title || (story.score || 0) < 100) continue;
      const title = story.title.toLowerCase();
      for (const w of title.split(/[\s\-_,.()/!?'"]+/)) {
        const clean = cleanTicker(w);
        if (isValidKeyword(clean) && clean.length >= 4) {
          results.push({
            keyword: clean,
            score: story.score * 20,
            context: `HN: "${story.title.slice(0, 60)}"`,
          });
          registerViralWord(clean, `HN: "${story.title.slice(0, 60)}"`);
        }
      }
    }
  } catch {
    /* silent */
  }
  return { results, count: results.length };
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
// SCORE ENTRY
// ─────────────────────────────────────────────────────────────────────────────
interface ScoreEntry {
  viralScore: number;
  socialScore: number;
  onchainScore: number;
  geckoScore: number;
  aiScore: number;
  celebScore: number;
  narrativeScore: number;
  storyScore: number; // NEW: score from story archetype matching
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
  archetypeType?: string; // which emotional archetype
  coinabilityScore?: number; // 0-100 from Gemini
  isPredictive?: boolean; // coin doesn't exist yet — watch for launch
  impressions?: number;
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
      | "narrativeScore"
      | "storyScore"
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
      // Keep LOWEST mcap
      if (opts.mcap !== undefined && opts.mcap > 0) {
        if (!existing.mcap || opts.mcap < existing.mcap)
          existing.mcap = opts.mcap;
      }
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
    } else {
      const entry: ScoreEntry = {
        viralScore: 0,
        socialScore: 0,
        onchainScore: 0,
        geckoScore: 0,
        aiScore: 0,
        celebScore: 0,
        narrativeScore: 0,
        storyScore: 0,
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
      };
      (entry[field] as number) = amount;
      scoreMap.set(key, entry);
    }
  };

  // ── WAVE 1: Find stories + viral signals (populates viralWordSet) ────────────
  const [
    geminiStories,
    geminiCelebStories,
    googleTrendsData,
    googleNewsData,
    youtubeTrendingData,
    kymData,
    hnData,
  ] = await Promise.all([
    scanWithGeminiStories(),
    scanGeminiCelebStories(),
    scanGoogleTrends(),
    scanGoogleNews(),
    scanYouTubeTrending(),
    scanKnowYourMeme(),
    scanHackerNews(),
  ]);

  // ── WAVE 2: Onchain sources (viralWordSet populated, narrative matching works) ─
  const [pumpResults, dexResults, geckoResults, cmcResults, ...redditResults] =
    await Promise.all([
      scanPumpFun(),
      scanDexScreener(),
      scanCoinGecko(),
      scanCMCNew(),
      ...REDDIT_SUBS.map((s) => scanReddit(s.name, s.tier)),
    ]);

  // ── Process Gemini Stories (the core of v13) ─────────────────────────────────
  let narrativeCount = 0;
  let predictiveCount = 0;
  if (geminiStories.success) {
    for (const story of geminiStories.stories) {
      const ageMult =
        story.coinAgeDays !== undefined
          ? ageMultiplier(story.coinAgeDays * 1440)
          : 0.9;
      if (ageMult === 0) continue;
      const mcapMult =
        story.coinMcap !== undefined ? mcapMultiplier(story.coinMcap) : 1.5;
      if (mcapMult === 0) continue;

      const isCeleb = !!story.celebMention;
      const isConfirmed = story.coinAlreadyExists;
      const isPredictive = !isConfirmed;

      // Archetype weight — survival/underdog stories get highest coin-spawn weight
      const archetype = NARRATIVE_ARCHETYPES.find(
        (a) => a.type === story.archetypeType,
      );
      const archetypeWeight = archetype ? archetype.weight : 5;

      // Story quality multiplier
      const storyMult =
        (story.coinabilityScore / 100) *
        archetypeWeight *
        (isConfirmed ? 3.0 : 1.5);
      const impressionMult = story.impressions
        ? Math.min(Math.log10(story.impressions + 1) / 4, 2.0)
        : 1.0;

      const baseScore =
        story.coinabilityScore *
        5000 *
        ageMult *
        mcapMult *
        storyMult *
        impressionMult;
      const field = isCeleb
        ? "celebScore"
        : isConfirmed
          ? "narrativeScore"
          : "storyScore";

      upsert(
        story.ticker,
        baseScore,
        isCeleb ? "celebrity" : "story",
        isCeleb
          ? `Celebrity: ${story.celebMention}`
          : isConfirmed
            ? "Confirmed Story Coin"
            : "Predictive Story",
        field,
        {
          hasTicker: isConfirmed,
          isNewCoin: isConfirmed && (story.coinAgeDays || 0) < 1,
          aiContext: story.narrativeContext,
          narrativeStory: story.narrativeContext,
          celebMention: story.celebMention || undefined,
          archetypeType: story.archetypeType,
          coinabilityScore: story.coinabilityScore,
          isPredictive: isPredictive,
          impressions: story.impressions,
          mcap: story.coinMcap,
          ageMinutes:
            story.coinAgeDays !== undefined
              ? Math.round(story.coinAgeDays * 1440)
              : undefined,
        },
      );

      // Register all emotional words from this story as viral words
      for (const emotionWord of story.emotionWords || []) {
        registerViralWord(emotionWord, story.narrativeContext);
      }
      registerViralWord(story.ticker, story.narrativeContext);

      // Register in story registry
      registerStory({
        id: story.ticker,
        headline: story.headline,
        archetypeType: story.archetypeType,
        coinabilityScore: story.coinabilityScore,
        predictedTickers: [
          story.ticker,
          ...(story.emotionWords || []).map(cleanTicker).filter(isValidKeyword),
        ],
        confirmedTicker: isConfirmed ? story.ticker : undefined,
        confirmedMcap: story.coinMcap,
        confirmedAge:
          story.coinAgeDays !== undefined
            ? Math.round(story.coinAgeDays * 1440)
            : undefined,
        source: story.platforms?.[0] || "unknown",
        impressions: story.impressions,
        emotionWords: story.emotionWords || [],
      });

      for (const plat of story.platforms || []) {
        const entry = scoreMap.get(story.ticker);
        if (entry && !entry.platforms.includes(plat))
          entry.platforms.push(plat);
      }

      if (isConfirmed) narrativeCount++;
      if (isPredictive) predictiveCount++;
    }
    logs.push(
      `[Gemini Stories] ✓ ${geminiStories.stories.length} — ${narrativeCount} confirmed — ${predictiveCount} predictive`,
    );
  } else {
    logs.push(`[Gemini Stories] ✗ ${geminiStories.error}`);
  }

  // Process celeb stories
  if (geminiCelebStories.success) {
    for (const story of geminiCelebStories.stories) {
      const ageMult =
        story.coinAgeDays !== undefined
          ? ageMultiplier(story.coinAgeDays * 1440)
          : 0.9;
      if (ageMult === 0) continue;
      const mcapMult =
        story.coinMcap !== undefined ? mcapMultiplier(story.coinMcap) : 1.5;
      if (mcapMult === 0) continue;
      const impressionMult = story.impressions
        ? Math.min(Math.log10(story.impressions + 1) / 4, 2.0)
        : 1.0;
      upsert(
        story.ticker,
        story.coinabilityScore * 6000 * ageMult * mcapMult * impressionMult,
        "celebrity",
        `Celebrity: ${story.celebMention || "Unknown"}`,
        "celebScore",
        {
          hasTicker: story.coinAlreadyExists,
          aiContext: story.narrativeContext,
          narrativeStory: story.narrativeContext,
          celebMention: story.celebMention || undefined,
          archetypeType: "celebrity_moment",
          coinabilityScore: story.coinabilityScore,
          impressions: story.impressions,
          mcap: story.coinMcap,
        },
      );
      for (const ew of story.emotionWords || [])
        registerViralWord(ew, story.narrativeContext);
      registerViralWord(story.ticker, story.narrativeContext);
    }
    logs.push(
      `[Gemini Celeb] ✓ ${geminiCelebStories.stories.length} celebrity moments`,
    );
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

  // ── Pump.fun with narrative bonus ─────────────────────────────────────────
  let pumpNarrativeMatches = 0;
  for (const p of pumpResults) {
    const { bonus, story } = getNarrativeBonus(p.keyword);
    const narrativeBonus = bonus > 0 ? 1 + bonus * 10 : 1; // up to 11x for story match

    upsert(
      p.keyword,
      p.score * narrativeBonus,
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
      // Also mark as confirmed in story registry if it matches a predictive story
      for (const [id, registeredStory] of storyRegistry) {
        if (
          registeredStory.predictedTickers.includes(cleanTicker(p.keyword)) &&
          !registeredStory.confirmedTicker
        ) {
          storyRegistry.set(id, {
            ...registeredStory,
            confirmedTicker: p.keyword,
            confirmedMcap: p.mcap,
            confirmedAge: p.ageMinutes,
            confirmedCA: p.contractAddress,
          });
          // Update score entry to mark as confirmed narrative
          upsert(
            p.keyword,
            p.score * 5,
            "pumpfun",
            "Narrative Confirmed",
            "narrativeScore",
            {
              narrativeStory: story,
              archetypeType: registeredStory.archetypeType,
              coinabilityScore: registeredStory.coinabilityScore,
            },
          );
        }
      }
    }
  }
  logs.push(
    `[Pump.fun] ${pumpResults.length} signals (< $500K) — ${pumpNarrativeMatches} story matches`,
  );

  // ── DexScreener with narrative bonus ─────────────────────────────────────
  for (const d of dexResults) {
    const { bonus, story } = getNarrativeBonus(d.keyword);
    const narrativeBonus = bonus > 0 ? 1 + bonus * 10 : 1;
    upsert(
      d.keyword,
      d.score * narrativeBonus,
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
        d.score * bonus * 5,
        "dexscreener",
        "Narrative Match",
        "narrativeScore",
        { narrativeStory: story },
      );
  }
  logs.push(`[DexScreener] ${dexResults.length} pairs`);

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
      if (upvotes > 5000) {
        for (const w of full.split(/[\s\-_,.()/!?'"#@]+/)) {
          const clean = cleanTicker(w);
          if (isValidKeyword(clean) && clean.length >= 4) {
            upsert(
              clean,
              heat * 1.5 * tier,
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

  // Rugcheck
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

  // ── FINAL SCORING ────────────────────────────────────────────────────────────
  const results = Array.from(scoreMap.entries())
    .map(([keyword, v]) => {
      // HARD FILTERS
      if (v.mcap !== undefined && v.mcap > MAX_MCAP) return null;
      if (v.ageMinutes !== undefined && v.ageMinutes > MAX_AGE_DAYS * 1440)
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
      const aiBonus = v.aiScore > 0 ? 2.5 : 1.0;
      const celebBonus = v.celebScore > 0 ? 8.0 : 1.0;
      const narrativeBonus = v.narrativeScore > 0 ? 6.0 : 1.0;
      const storyBonus = v.storyScore > 0 ? 4.0 : 1.0; // predictive stories get 4x
      const coinabilityBonus = v.coinabilityScore
        ? 1 + (v.coinabilityScore / 100) * 3
        : 1.0;

      const finalMcapMult = mcapMultiplier(v.mcap);
      if (finalMcapMult === 0) return null;

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
      const globalAgeMult = ageMultiplier(v.ageMinutes);
      if (globalAgeMult === 0) return null;

      const impressionBonus = v.impressions
        ? Math.min(Math.log10(v.impressions + 1) / 4, 2.0)
        : 1.0;

      const raw =
        v.viralScore * 2.0 +
        v.socialScore * 1.5 +
        v.onchainScore * 2.8 +
        v.geckoScore * 2.0 +
        v.aiScore * 4.5 +
        v.celebScore * 7.0 +
        v.narrativeScore * 9.0 + // confirmed story+coin = highest
        v.storyScore * 7.0; // predictive story = also very high

      const final = Math.round(
        raw *
          mentionWeight *
          tickerBonus *
          crossBonus *
          newCoinBonus *
          aiBonus *
          celebBonus *
          narrativeBonus *
          storyBonus *
          coinabilityBonus *
          viralBonus *
          rugPenalty *
          liqBonus *
          globalAgeMult *
          finalMcapMult *
          impressionBonus,
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
        isNarrativeCoin: v.narrativeScore > 0 || v.storyScore > 0,
        onAI: v.platforms.includes("ai") || v.platforms.includes("story"),
        onCeleb: v.platforms.includes("celebrity"),
        onNarrative: v.narrativeScore > 0,
        onStory: v.storyScore > 0,
        onTwitter:
          v.platforms.includes("twitter") ||
          v.platforms.includes("google-news"),
        onDex:
          v.platforms.includes("dexscreener") ||
          v.platforms.includes("pumpfun"),
        isViralTrend: viralPlatforms >= 1,
        ageDays: v.ageMinutes !== undefined ? v.ageMinutes / 1440 : undefined,
      };
    })
    .filter((r): r is NonNullable<typeof r> => {
      if (!r) return false;
      const hasCeleb = r.onCeleb;
      const hasStory = r.isNarrativeCoin || r.isPredictive;
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

      if (r.onDex && r.crossPlatforms === 1 && !hasCeleb && !hasStory)
        return false;
      if (!r.onDex && !hasCeleb && !hasRealAI && !hasStory) return false;

      return (
        hasCeleb ||
        hasStory ||
        hasRealAI ||
        hasMultiSource ||
        hasOnchainPlusSocial ||
        hasOnchainPlusAI ||
        isHighScore
      );
    })
    .sort((a, b) => {
      const getMcapBoost = (r: typeof a) => {
        if (!r.mcap) return 2.0;
        if (r.mcap < 10000) return 6.0;
        if (r.mcap < 30000) return 4.5;
        if (r.mcap < 100000) return 3.0;
        if (r.mcap < 200000) return 1.8;
        return 1.0;
      };
      const getAgeBoost = (r: typeof a) => {
        if (!r.ageMinutes) return 1.5;
        if (r.ageMinutes < 60) return 5.0;
        if (r.ageMinutes < 360) return 3.0;
        if (r.ageMinutes < 1440) return 1.8;
        return 1.0;
      };
      const getStoryBoost = (r: typeof a) => {
        if (r.isPredictive && r.coinabilityScore && r.coinabilityScore > 80)
          return 3.0; // high confidence predictive
        if (r.isNarrativeCoin && r.onDex) return 8.0; // confirmed story + on chain = JACKPOT
        if (r.isNarrativeCoin) return 5.0;
        if (r.isPredictive) return 2.0;
        return 1.0;
      };
      const aBoost =
        (a.onCeleb ? 5.0 : 1) *
        getStoryBoost(a) *
        (a.isViralTrend && a.onDex ? 3.0 : 1) *
        getMcapBoost(a) *
        getAgeBoost(a);
      const bBoost =
        (b.onCeleb ? 5.0 : 1) *
        getStoryBoost(b) *
        (b.isViralTrend && b.onDex ? 3.0 : 1) *
        getMcapBoost(b) *
        getAgeBoost(b);
      return b.score * bBoost - a.score * aBoost;
    })
    .slice(0, 60);

  const confirmedStories = results.filter(
    (r) => r.isNarrativeCoin && r.onDex,
  ).length;
  const predictiveStories = results.filter((r) => r.isPredictive).length;
  const subHundredK = results.filter((r) => !r.mcap || r.mcap < 100000).length;
  logs.push(
    `[Done] ${results.length} — ${confirmedStories} confirmed story coins — ${predictiveStories} predictive — ${subHundredK} under $100K`,
  );

  return NextResponse.json({
    results,
    logs,
    scannedAt: new Date().toISOString(),
    stories: Array.from(storyRegistry.values()).slice(0, 20), // expose story registry for UI
  });
}
