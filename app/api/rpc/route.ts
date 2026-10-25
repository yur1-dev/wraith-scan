import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { rpcLimiter } from "@/lib/ratelimit";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const RPC_URLS = [
  ...(process.env.NEXT_PUBLIC_SOLANA_RPC ? [process.env.NEXT_PUBLIC_SOLANA_RPC] : []),
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
  "https://api.mainnet-beta.solana.com",
];

const PER_RPC_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 20_000;
const LOCAL_RATE_WINDOW_MS = 60_000;
const LOCAL_RATE_LIMIT = 900;
const localRateWindows = new Map<string, number[]>();
let warnedAboutRateLimitFallback = false;

// ─── METHOD ALLOWLIST ─────────────────────────────────────────────────────────
const ALLOWED_METHODS = new Set([
  "getBalance",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getTokenAccountsByOwner",
  "getTokenLargestAccounts",
  "simulateTransaction",
  "getAccountInfo",
  "getFeeForMessage",
  "getTransaction",
  "getTokenSupply",
  "getTokenAccountBalance",
  "getMultipleAccounts",
  // "getProgramAccounts" ← REMOVED: exposes all token holders + wallet positions
  "getMinimumBalanceForRentExemption",
  "getRecentPrioritizationFees",
]);

const SENSITIVE_METHODS = new Set([
  "sendTransaction",
  "sendRawTransaction",
  "requestAirdrop",
  "setLogFilter",
  "validatorExit",
]);

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function tryRpc(url: string, body: unknown): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_RPC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function applyLocalRateLimit(userId: string): boolean {
  const now = Date.now();
  const recentRequests = (localRateWindows.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < LOCAL_RATE_WINDOW_MS,
  );
  if (recentRequests.length >= LOCAL_RATE_LIMIT) {
    localRateWindows.set(userId, recentRequests);
    return false;
  }

  recentRequests.push(now);
  localRateWindows.set(userId, recentRequests);

  if (localRateWindows.size > 5_000) {
    for (const [id, timestamps] of localRateWindows) {
      if (timestamps.every((timestamp) => now - timestamp >= LOCAL_RATE_WINDOW_MS)) {
        localRateWindows.delete(id);
      }
    }
  }
  return true;
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // ── AUTH ──────────────────────────────────────────────────────────────────
  const session = await getAppSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── RATE LIMIT ────────────────────────────────────────────────────────────
  try {
    const rateLimitResult = await rpcLimiter.limit(session.user.id);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 },
      );
    }
  } catch (error) {
    if (!warnedAboutRateLimitFallback) {
      console.error("[RPC] Redis rate limiter unavailable; using local limits.", error);
      warnedAboutRateLimitFallback = true;
    }
    if (!applyLocalRateLimit(session.user.id)) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 },
      );
    }
  }

  // ── BODY SIZE GUARD ───────────────────────────────────────────────────────
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  // ── PARSE ─────────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("method" in body) ||
    typeof (body as Record<string, unknown>).method !== "string"
  ) {
    return NextResponse.json({ error: "Invalid RPC request" }, { status: 400 });
  }

  const method = (body as Record<string, string>).method;

  // ── METHOD VALIDATION ─────────────────────────────────────────────────────
  if (SENSITIVE_METHODS.has(method)) {
    console.warn(
      `[RPC] Blocked sensitive method: ${method} | user: ${session.user.id}`,
    );
    return NextResponse.json(
      { error: "Method not permitted" },
      { status: 403 },
    );
  }

  if (!ALLOWED_METHODS.has(method)) {
    console.warn(
      `[RPC] Blocked unknown method: ${method} | user: ${session.user.id}`,
    );
    return NextResponse.json({ error: "Method not allowed" }, { status: 403 });
  }

  // ── FORWARD TO RPC ────────────────────────────────────────────────────────
  // Race all endpoints simultaneously — the first OK response wins.
  // This cuts worst-case latency from 3×timeout to 1×timeout.
  type RpcResult = { data: unknown; url: string };
  const races = RPC_URLS.map(
    (url): Promise<RpcResult> =>
      tryRpc(url, body).then(async (res) => {
        if (!res) throw new Error(`${url}: non-OK`);
        const data = await res.json();
        return { data, url };
      }),
  );

  try {
    const { data } = await Promise.any(races);
    return NextResponse.json(data);
  } catch (e: unknown) {
    const errs =
      e instanceof AggregateError
        ? e.errors.map((x: unknown) => (x instanceof Error ? x.message : String(x))).join("; ")
        : String(e);
    console.error("[RPC] All endpoints failed:", errs);
    return NextResponse.json({ error: "RPC unavailable" }, { status: 503 });
  }
}
