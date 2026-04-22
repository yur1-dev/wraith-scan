import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

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
