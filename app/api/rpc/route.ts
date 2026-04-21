import { NextRequest, NextResponse } from "next/server";

// Truly free RPCs — no API key needed, tried in order
const RPC_URLS = [
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
  "https://api.mainnet-beta.solana.com",
];

export async function POST(req: NextRequest) {
  const body = await req.json();

  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // try next
    }
  }

  return NextResponse.json(
    { error: "All RPC endpoints failed" },
    { status: 500 },
  );
}
