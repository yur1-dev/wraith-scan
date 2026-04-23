import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/mongoClient";
import { Collection } from "mongodb";
import { ITokenHistory, TOKEN_HISTORY_COLLECTION } from "@/models/TokenHistory";

// ─── POST /api/ai-score ───────────────────────────────────────────────────────
// Scores a new token candidate against your historical win patterns.
//
// Flow:
//   1. Fetch your last 50 wins (peakMcap >= 2x initialMcap, earned) from DB
//   2. Build a prompt with win patterns + candidate data
//   3. Call Claude claude-sonnet-4-20250514 — returns JSON { score, tier, reason }
//   4. Persist aiScore + aiTier onto the token's history doc
//   5. Return { score, tier, reason } to recordTokenSighting
//
// Score 0–100:
//   >= 70 → HOT SIGNAL — louder Telegram alert, top of scanner
//   40–69 → WATCH — tracked silently, alert if it starts moving
//   < 40  → SKIP — still recorded but no alert
//
// Called from recordTokenSighting AFTER /api/history returns isNew: true.

interface ScoreRequest {
  keyword: string;
  contractAddress: string;
  mcap: number;
  tier: string; // twoXTier from scanner
  platforms: string[];
  celebMention?: string;
  aiContext?: string;
  liquidity?: number;
  priceChange24h?: number;
  crossPlatforms?: number;
}

interface ScoreResponse {
  score: number;
  tier: "HOT" | "WATCH" | "SKIP";
  reason: string;
}

function calcMultiplier(init: number, peak: number): number {
  return !init ? 0 : peak / init;
}

function buildPrompt(wins: ITokenHistory[], candidate: ScoreRequest): string {
  // Summarize win patterns from history
  const winSummaries = wins
    .slice(0, 30) // cap at 30 to keep prompt lean
    .map((w) => {
      const mult = calcMultiplier(w.initialMcap, w.peakMcap);
      const liqRatio =
        w.initialMcap > 0 ? (w.initialMcap * 0.3) / w.initialMcap : 0; // estimated
      return {
        mcap: w.initialMcap,
        tier: "HIGH", // stored tokens passed quality gates
        platforms: w.platforms,
        hasCeleb: !!w.celebMention,
        multiplier: parseFloat(mult.toFixed(2)),
        timeToXh: w.peakMcapTs
          ? parseFloat(((w.peakMcapTs - w.seenAt) / 3_600_000).toFixed(1))
          : null,
      };
    });

  const avgMcap =
    wins.length > 0
      ? Math.round(wins.reduce((s, w) => s + w.initialMcap, 0) / wins.length)
      : 0;

  const celebWins = wins.filter((w) => !!w.celebMention).length;
  const celebHitRate =
    wins.length > 0 ? Math.round((celebWins / wins.length) * 100) : 0;

  const pumpfunWins = wins.filter((w) =>
    w.platforms.includes("pumpfun"),
  ).length;
  const dexWins = wins.filter((w) =>
    w.platforms.includes("dexscreener"),
  ).length;

  return `You are a meme coin signal scorer for a personal trading scanner.

Your job: score a NEW TOKEN CANDIDATE from 0 to 100 based on how closely it matches historical win patterns.

=== HISTORICAL WIN PATTERNS (last ${wins.length} wins) ===
Average spotted mcap: $${avgMcap.toLocaleString()}
Celeb mention win rate: ${celebHitRate}% of wins had celeb signal
Pumpfun presence in wins: ${pumpfunWins}/${wins.length}
DexScreener presence in wins: ${dexWins}/${wins.length}

Recent wins detail:
${JSON.stringify(winSummaries, null, 2)}

=== CANDIDATE TOKEN ===
Keyword: ${candidate.keyword}
MCap at spot: $${candidate.mcap.toLocaleString()}
Scanner tier: ${candidate.tier}
Platforms detected: ${candidate.platforms.join(", ")}
Celeb mention: ${candidate.celebMention || "none"}
AI context: ${candidate.aiContext || "none"}
Cross-platform count: ${candidate.crossPlatforms ?? 1}
Price change 24h: ${candidate.priceChange24h ?? 0}%

=== SCORING RULES ===
- MCap sweet spot for this scanner is $3K–$50K (most wins came from here)
- Celeb + onchain (pumpfun/dex) together = highest hit rate, score it higher
- ULTRA tier > HIGH tier > MEDIUM tier
- Cross-platform >= 3 = strong signal
- Price already up significantly (>200%) = might be late, score lower
- Healthy negative: price down slightly (<-30%) is ok, down more = risk
- If mcap > $200K, score lower (less room to 2x)

Respond ONLY with a JSON object, no markdown, no explanation outside the JSON:
{
  "score": <number 0-100>,
  "tier": <"HOT" | "WATCH" | "SKIP">,
  "reason": <one sentence max 100 chars explaining score>
}

Rules:
- score >= 70 → tier must be "HOT"
- score 40-69 → tier must be "WATCH"  
- score < 40 → tier must be "SKIP"`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as ScoreRequest;

  if (!body.keyword || !body.contractAddress) {
    return NextResponse.json(
      { error: "keyword and contractAddress required" },
      { status: 400 },
    );
  }

  const userId = session.user.id;

  try {
    const db = await getDb();
    const col: Collection<ITokenHistory> = db.collection<ITokenHistory>(
      TOKEN_HISTORY_COLLECTION,
    );

    // ── 1. Fetch historical wins ──────────────────────────────────────────
    // A "win" = peakMcap >= 2x initialMcap AND peakMcapTs > seenAt (earned)
    const PEAK_GRACE_MS = 5 * 60 * 1000;
    const allHistory = await col
      .find({ userId, initialMcap: { $gt: 0 }, peakMcap: { $gt: 0 } })
      .sort({ seenAt: -1 })
      .limit(200)
      .toArray();

    const wins = allHistory.filter((e) => {
      const mult = calcMultiplier(e.initialMcap, e.peakMcap);
      if (mult < 2) return false;
      // earned check
      if (e.peakMcapTs > e.seenAt + PEAK_GRACE_MS) return true;
      if (e.currentMcap >= e.initialMcap * 1.5) return true;
      if (e.peakMcapTs > 0 && e.peakMcap >= e.initialMcap * 1.5) return true;
      return false;
    });

    // ── 2. If no wins yet, use heuristic scoring (no training data) ───────
    if (wins.length < 3) {
      const score = heuristicScore(body);
      const tier = score >= 70 ? "HOT" : score >= 40 ? "WATCH" : "SKIP";
      const result: ScoreResponse = {
        score,
        tier,
        reason: `Heuristic (${wins.length} wins in history — learning mode)`,
      };
      await persistScore(col, userId, body.keyword, result);
      return NextResponse.json(result);
    }

    // ── 3. Call Claude API ────────────────────────────────────────────────
    const prompt = buildPrompt(wins, body);

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      console.error("[ai-score] Claude API error:", await claudeRes.text());
      // Fall back to heuristic
      const score = heuristicScore(body);
      const tier = score >= 70 ? "HOT" : score >= 40 ? "WATCH" : "SKIP";
      const result: ScoreResponse = {
        score,
        tier,
        reason: "Heuristic fallback (Claude API error)",
      };
      await persistScore(col, userId, body.keyword, result);
      return NextResponse.json(result);
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content
      ?.map((b: { type: string; text?: string }) =>
        b.type === "text" ? b.text : "",
      )
      .join("")
      .trim();

    // ── 4. Parse JSON response ────────────────────────────────────────────
    let result: ScoreResponse;
    try {
      const clean = rawText.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean) as {
        score: number;
        tier: string;
        reason: string;
      };
      const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
      const tier: "HOT" | "WATCH" | "SKIP" =
        score >= 70 ? "HOT" : score >= 40 ? "WATCH" : "SKIP";
      result = {
        score,
        tier,
        reason:
          typeof parsed.reason === "string"
            ? parsed.reason.slice(0, 100)
            : "AI scored",
      };
    } catch {
      console.error("[ai-score] parse error:", rawText);
      const score = heuristicScore(body);
      const tier = score >= 70 ? "HOT" : score >= 40 ? "WATCH" : "SKIP";
      result = { score, tier, reason: "Heuristic fallback (parse error)" };
    }

    // ── 5. Persist score onto the token doc ───────────────────────────────
    await persistScore(col, userId, body.keyword, result);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[ai-score] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── Persist aiScore + aiTier to token doc ────────────────────────────────────
async function persistScore(
  col: Collection<ITokenHistory>,
  userId: string,
  keyword: string,
  result: ScoreResponse,
) {
  try {
    await col.updateOne(
      { userId, keyword },
      {
        $set: {
          aiScore: result.score,
          aiTier: result.tier,
          updatedAt: Date.now(),
        },
      },
    );
  } catch {
    // silent — scoring is non-blocking
  }
}

// ─── Heuristic fallback (no win history yet) ──────────────────────────────────
// Simple rule-based score for when the AI has < 3 wins to learn from.
function heuristicScore(c: ScoreRequest): number {
  let score = 40; // base

  // Tier
  if (c.tier === "ULTRA") score += 20;
  else if (c.tier === "HIGH") score += 12;
  else if (c.tier === "MEDIUM") score += 4;

  // Celeb
  if (c.celebMention) score += 15;

  // MCap sweet spot $3K–$50K
  if (c.mcap >= 3_000 && c.mcap <= 50_000) score += 15;
  else if (c.mcap > 50_000 && c.mcap <= 150_000) score += 5;
  else if (c.mcap > 200_000) score -= 10;

  // Platform count
  const platCount = c.platforms.length;
  if (platCount >= 3) score += 10;
  else if (platCount === 2) score += 5;

  // Cross-platform
  if ((c.crossPlatforms ?? 0) >= 3) score += 8;

  // Price momentum
  const p24 = c.priceChange24h ?? 0;
  if (p24 > 50 && p24 < 300) score += 5; // good momentum, not too late
  if (p24 > 500) score -= 10; // might be too late
  if (p24 < -50) score -= 8; // dumping

  return Math.max(0, Math.min(100, score));
}
