import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { jupiterLimiter } from "@/lib/ratelimit";

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

  const { success } = await jupiterLimiter.limit(session.user.id);
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

  const { success } = await jupiterLimiter.limit(session.user.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") ?? "swap";

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  const body = await req.json();
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
        body: JSON.stringify(body),
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
