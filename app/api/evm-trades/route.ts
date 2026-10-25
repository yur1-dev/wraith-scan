// GET /api/evm-trades?address=0x…&chain=base  → recent swaps for the deepest pool (GeckoTerminal)
import { NextRequest, NextResponse } from "next/server";
import { arr, GECKO_HEADERS, getJson, num, obj } from "@/lib/marketProviders";
import { getEvmSnapshot } from "@/lib/evmData";
import { chainOf, EVM_ADDR_RE } from "@/lib/chains";

const cache = new Map<string, { ts: number; trades: unknown[] }>();
const CACHE_MS = 10_000;

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") ?? "";
  const chainQ = req.nextUrl.searchParams.get("chain");
  if (!EVM_ADDR_RE.test(address)) return NextResponse.json({ trades: [], error: "Invalid EVM address" }, { status: 400 });
  const key = `${address.toLowerCase()}:${chainQ ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return NextResponse.json({ trades: hit.trades });
  try {
    const snap = await getEvmSnapshot(address, chainQ);
    const chain = chainOf(snap?.chain ?? chainQ);
    if (!snap || !chain || !snap.pairAddress) return NextResponse.json({ trades: [] });
    const data = obj(await getJson(`https://api.geckoterminal.com/api/v2/networks/${chain.gecko}/pools/${snap.pairAddress}/trades`, GECKO_HEADERS, 8000));
    const supply = snap.supply ?? 0;
    const trades = arr(data.data).map((d) => {
      const a = obj(obj(d).attributes);
      const side = String(a.kind) === "sell" ? "sell" : "buy";
      const tokens = num(side === "buy" ? a.to_token_amount : a.from_token_amount);
      const price = num(side === "buy" ? a.price_to_in_usd : a.price_from_in_usd);
      return {
        id: String(a.tx_hash ?? obj(d).id ?? Math.random()),
        ts: Date.parse(String(a.block_timestamp ?? "")) || Date.now(),
        side,
        usd: num(a.volume_in_usd),
        tokens,
        mcap: supply > 0 && price > 0 ? supply * price : null,
        wallet: String(a.tx_from_address ?? ""),
        tx: String(a.tx_hash ?? ""),
      };
    });
    cache.set(key, { ts: Date.now(), trades });
    return NextResponse.json({ trades });
  } catch (e) {
    if (hit) return NextResponse.json({ trades: hit.trades, stale: true });
    return NextResponse.json({ trades: [], error: e instanceof Error ? e.message : "Provider error" }, { status: 502 });
  }
}
