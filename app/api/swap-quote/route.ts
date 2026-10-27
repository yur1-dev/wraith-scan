import { NextRequest, NextResponse } from "next/server";

// Thin proxy to LI.FI so an API key (LIFI_API_KEY) can be added later without touching the client.
export const dynamic = "force-dynamic";
const OK = new Set(["fromChain", "toChain", "fromToken", "toToken", "fromAmount", "fromAddress", "toAddress", "slippage", "skipSimulation", "order", "denyExchanges", "denyBridges"]);

export async function GET(req: NextRequest) {
  const incoming = req.nextUrl.searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of incoming) if (OK.has(k) && v.length < 80) q.set(k, v);
  if (!q.get("fromChain") || !q.get("toChain") || !q.get("fromToken") || !q.get("toToken") || !q.get("fromAmount") || !q.get("fromAddress")) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }
  if (incoming.get("status")) q.set("status", "1");
  try {
    const res = await fetch(`https://li.quest/v1/quote?${q}`, {
      headers: { accept: "application/json", ...(process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: "quote service unreachable" }, { status: 502 });
  }
}
