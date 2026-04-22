import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ─── REDIS CONNECTION ─────────────────────────────────────────────────────────
// Fails fast at startup if UPSTASH_REDIS_REST_URL / TOKEN are missing
const redis = Redis.fromEnv();

// ─── SAFE LIMIT HELPER ────────────────────────────────────────────────────────
// Wraps every limiter.limit() call so a Redis outage never crashes an API route.
// Pass failOpen=true (default) to allow requests through during outages.
// Pass failOpen=false on sensitive routes (e.g. scan) to block during outages.
export async function checkLimit(
  limiter: Ratelimit,
  id: string,
  failOpen = true,
): Promise<{ success: boolean; limit: number; remaining: number }> {
  try {
    return await limiter.limit(id);
  } catch (err) {
    console.error("[ratelimit] Redis unavailable:", err);
    return {
      success: failOpen,
      limit: 0,
      remaining: 0,
    };
  }
}

// ─── LIMITERS ─────────────────────────────────────────────────────────────────

// Scan: 6 per 10 minutes — expensive AI + multi-source scan
export const scanLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(6, "10 m"),
  prefix: "wraith_scan",
});

// Jupiter swaps/quotes: 30 per minute
export const jupiterLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  prefix: "wraith_jupiter",
});

// RPC proxy: 100 per minute
export const rpcLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1 m"),
  prefix: "wraith_rpc",
});

// Position saves: 60 per 10 minutes — frequent auto-saves from PaperTrader
export const positionLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "10 m"),
  prefix: "wraith_positions",
});

// Trade appends: 30 per 10 minutes — one per actual buy/sell
export const tradeLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "10 m"),
  prefix: "wraith_trades",
});

// Analyze: 30 per 10 minutes — one call per token selection
export const analyzeLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "10 m"),
  prefix: "wraith_analyze",
});
