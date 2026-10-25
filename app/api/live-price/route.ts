import { NextRequest, NextResponse } from "next/server";
import { getSolUsd } from "@/lib/marketProviders";

export const dynamic = "force-dynamic";

const WSOL = "So11111111111111111111111111111111111111112";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58(buf: Buffer): string {
  const ZERO = BigInt(0);
  const BASE = BigInt(58);
  let n = BigInt("0x" + buf.toString("hex"));
  let out = "";
  while (n > ZERO) { out = B58[Number(n % BASE)] + out; n /= BASE; }
  for (const b of buf) { if (b === 0) out = "1" + out; else break; }
  return out;
}

const RPCS = () =>
  [process.env.NEXT_PUBLIC_SOLANA_RPC, "https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"].filter(Boolean) as string[];

async function rpc(method: string, params: unknown[]): Promise<any> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const tries = RPCS().map((url) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(4000), cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (j.error) throw new Error("rpc");
        return j.result;
      }),
  );
  return Promise.any(tries);
}

const vaults = new Map<string, { base: string; quote: string } | null>();
const out = new Map<string, { at: number; data: unknown }>();

/**
 * Exact on-chain price for PumpSwap pools: quote(wSOL) vault / base(token) vault.
 * Same source pump.fun / fomo use, so it moves the moment a trade lands (no indexer lag).
 */
export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  const pool = req.nextUrl.searchParams.get("pool") ?? "";
  const re = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (!re.test(mint) || !re.test(pool)) return NextResponse.json({ error: "bad" }, { status: 400 });

  const hit = out.get(pool);
  if (hit && Date.now() - hit.at < 700) return NextResponse.json(hit.data);

  try {
    let v = vaults.get(pool);
    if (v === undefined) {
      const acc = await rpc("getAccountInfo", [pool, { encoding: "base64" }]);
      const raw = acc?.value?.data?.[0] ? Buffer.from(acc.value.data[0], "base64") : null;
      v = null;
      if (raw && raw.length >= 203) {
        const baseMint = b58(raw.subarray(43, 75));
        const quoteMint = b58(raw.subarray(75, 107));
        if (baseMint === mint && quoteMint === WSOL) {
          v = { base: b58(raw.subarray(139, 171)), quote: b58(raw.subarray(171, 203)) };
        }
      }
      vaults.set(pool, v);
    }
    if (!v) return NextResponse.json({ error: "unsupported-pool" }, { status: 404 });

    const res = await rpc("getMultipleAccounts", [[v.base, v.quote], { encoding: "jsonParsed" }]);
    const amt = (i: number) => Number(res?.value?.[i]?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0);
    const baseAmt = amt(0);
    const quoteAmt = amt(1);
    if (!(baseAmt > 0) || !(quoteAmt > 0)) return NextResponse.json({ error: "empty" }, { status: 502 });
    const priceSol = quoteAmt / baseAmt;
    const solUsd = await getSolUsd();
    const data = { priceSol, priceUsd: priceSol * solUsd, solUsd, vaults: v, base: baseAmt, quote: quoteAmt, at: Date.now() };
    out.set(pool, { at: Date.now(), data });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "rpc" }, { status: 502 });
  }
}
