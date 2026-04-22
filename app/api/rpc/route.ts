import { NextRequest, NextResponse } from "next/server";

// Free RPCs tried in order — publicnode first (most reliable), others as fallback
const RPC_URLS = [
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
  "https://api.mainnet-beta.solana.com",
];

const PER_RPC_TIMEOUT_MS = 10000; // 10s per RPC before trying next

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
    if (res.ok) return res;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  const errors: string[] = [];

  for (const url of RPC_URLS) {
    try {
      const res = await tryRpc(url, body);
      if (res) {
        const data = await res.json();
        return NextResponse.json(data);
      }
      errors.push(`${url}: non-OK response`);
    } catch (e: unknown) {
      errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json(
    { error: "All RPC endpoints failed", details: errors },
    { status: 500 },
  );
}
