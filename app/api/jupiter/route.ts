import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { jupiterLimiter, checkLimit } from "@/lib/ratelimit";

const JUP_BASE = "https://api.jup.ag/swap/v1";
const TIMEOUT_MS = 30000;
const MAX_BODY_BYTES = 10_000;

const ALLOWED_ENDPOINTS = new Set(["quote", "swap", "price", "tokens"]);

const QUOTE_ALLOWED_PARAMS = new Set([
  "inputMint",
  "outputMint",
  "amount",
  "slippageBps",
  "swapMode",
  "onlyDirectRoutes",
  "asLegacyTransaction",
]);

const SWAP_ALLOWED_FIELDS = new Set([
  "quoteResponse",
  "userPublicKey",
  "wrapAndUnwrapSol",
  "computeUnitPriceMicroLamports",
  "asLegacyTransaction",
  "useSharedAccounts",
  "feeAccount",
  "trackingAccount",
  "prioritizationFeeLamports",
  "dynamicComputeUnitLimit",
  "platformFeeBps", // ← fee injection
]);

async function fetchWithTimeout(url: string, options: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await checkLimit(jupiterLimiter, session.user.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") ?? "quote";

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  const forwardedParams = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (QUOTE_ALLOWED_PARAMS.has(key)) forwardedParams.set(key, value);
  }

  const upstreamUrl = `${JUP_BASE}/${endpoint}?${forwardedParams.toString()}`;

  try {
    const res = await fetchWithTimeout(
      upstreamUrl,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-key": process.env.JUPITER_API_KEY ?? "",
        },
      },
      TIMEOUT_MS,
    );

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: `Jupiter returned non-JSON: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }

    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("AbortError");
    return NextResponse.json(
      {
        error: isTimeout
          ? "Jupiter quote timed out after 30s"
          : "Jupiter unreachable",
      },
      { status: isTimeout ? 504 : 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const { success } = await checkLimit(jupiterLimiter, session.user.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") ?? "swap";

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Strip unknown fields
  const filteredBody: Record<string, unknown> = {};
  for (const key of SWAP_ALLOWED_FIELDS) {
    if (key in rawBody) filteredBody[key] = rawBody[key];
  }

  // userPublicKey must be a valid base58 Solana address
  if (
    typeof filteredBody.userPublicKey !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(filteredBody.userPublicKey)
  ) {
    return NextResponse.json(
      { error: "Invalid userPublicKey" },
      { status: 400 },
    );
  }

  // ── FEE INJECTION ──────────────────────────────────────────────────────────
  // Only inject if FEE_WALLET and FEE_ACCOUNT are set and feeBps > 0.
  // feeBps is sent from the client and validated here (0–100 bps max).
  // When placeholder values are still in place, fees are silently skipped.
  const feeWallet = process.env.FEE_WALLET ?? "";
  const feeAccount = process.env.FEE_ACCOUNT ?? "";
  const isPlaceholder =
    feeWallet.includes("PLACEHOLDER") || feeWallet === "" || feeAccount === "";

  if (!isPlaceholder && endpoint === "swap") {
    const clientFeeBps =
      typeof rawBody.feeBps === "number"
        ? Math.min(Math.max(Math.round(rawBody.feeBps), 0), 100)
        : 0;

    if (clientFeeBps > 0) {
      filteredBody.platformFeeBps = clientFeeBps;
      filteredBody.feeAccount = feeAccount;
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  const upstreamUrl = `${JUP_BASE}/${endpoint}`;

  try {
    const res = await fetchWithTimeout(
      upstreamUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-key": process.env.JUPITER_API_KEY ?? "",
        },
        body: JSON.stringify(filteredBody),
      },
      TIMEOUT_MS,
    );

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: `Jupiter returned non-JSON: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }

    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("AbortError");
    return NextResponse.json(
      {
        error: isTimeout
          ? "Jupiter swap timed out after 30s"
          : "Jupiter unreachable",
      },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
