import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rpcLimiter } from "@/lib/ratelimit";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const RPC_URLS = [
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
  "https://api.mainnet-beta.solana.com",
];

const PER_RPC_TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 20_000;

// ─── METHOD ALLOWLIST ─────────────────────────────────────────────────────────
// sendTransaction is intentionally excluded — submitting arbitrary on-chain
// transactions through our server creates legal and abuse risk.
// The hot wallet in PaperTrader sends transactions directly to the RPC via
// the /api/jupiter proxy which has its own signing validation.
// Read-only and simulation methods only.
const ALLOWED_METHODS = new Set([
  "getBalance",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getTokenAccountsByOwner",
  "simulateTransaction",
  "getAccountInfo",
  "getFeeForMessage",
  "getTransaction",
  "getTokenSupply",
  "getTokenAccountBalance",
]);

// Methods that are blocked but commonly probed — log these for visibility
const SENSITIVE_METHODS = new Set([
  "sendTransaction",
  "sendRawTransaction",
  "requestAirdrop",
  "setLogFilter",
  "validatorExit",
]);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
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

// ─── HANDLER ──────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // ── AUTH ────────────────────────────────────────────────────────────────────
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── RATE LIMIT ──────────────────────────────────────────────────────────────
  const { success } = await rpcLimiter.limit(session.user.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  // ── BODY SIZE GUARD ──────────────────────────────────────────────────────────
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  // ── PARSE ────────────────────────────────────────────────────────────────────
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

  // ── METHOD VALIDATION ────────────────────────────────────────────────────────
  if (SENSITIVE_METHODS.has(method)) {
    // Log probes of sensitive methods so we can detect abuse patterns
    console.warn(
      `[RPC] Blocked sensitive method attempt: ${method} | user: ${session.user.id}`,
    );
    return NextResponse.json(
      { error: "Method not permitted" },
      { status: 403 },
    );
  }

  if (!ALLOWED_METHODS.has(method)) {
    // Log unknown method attempts for debugging and abuse detection
    console.warn(
      `[RPC] Blocked unknown method: ${method} | user: ${session.user.id}`,
    );
    return NextResponse.json({ error: "Method not allowed" }, { status: 403 });
  }

  // ── FORWARD TO RPC ───────────────────────────────────────────────────────────
  const errors: string[] = [];

  for (const url of RPC_URLS) {
    try {
      const res = await tryRpc(url, body);
      if (res) {
        const data = await res.json();
        return NextResponse.json(data);
      }
      errors.push(`${url}: non-OK`);
    } catch (e: unknown) {
      errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.error("[RPC] All endpoints failed:", errors);
  return NextResponse.json({ error: "RPC unavailable" }, { status: 503 });
}
