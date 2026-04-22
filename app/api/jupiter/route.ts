import { NextRequest, NextResponse } from "next/server";

const JUP_BASE = "https://api.jup.ag/swap/v1";
const TIMEOUT_MS = 30000;

async function fetchWithTimeout(url: string, options: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") || "quote";
  searchParams.delete("endpoint");

  const upstreamUrl = `${JUP_BASE}/${endpoint}?${searchParams.toString()}`;

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

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("AbortError");
    return NextResponse.json(
      { error: isTimeout ? "Jupiter quote timed out after 30s" : msg },
      { status: isTimeout ? 504 : 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") || "swap";

  const upstreamUrl = `${JUP_BASE}/${endpoint}`;
  const body = await req.json();

  try {
    const res = await fetchWithTimeout(
      upstreamUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          // FIX #10: forward x-api-key on POST just like GET does
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

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("AbortError");
    return NextResponse.json(
      { error: isTimeout ? "Jupiter swap timed out after 30s" : msg },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
