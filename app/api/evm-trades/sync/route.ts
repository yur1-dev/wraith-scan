// POST /api/evm-trades/sync
// Rebuilds the user's EVM trade ledger from the chain: any token that arrived in the Wraith wallet in the same tx where
// cash (stablecoins) left it is a buy; any token that left while cash arrived is a sell. Base only for now.
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { createPublicClient, formatUnits, getAddress, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { getAppSession } from "@/lib/session";
import { getPrivyClient } from "@/lib/privyServer";
import { getDb } from "@/lib/mongoClient";
import { CASH_TOKENS } from "@/lib/cashTokens";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const RPC = process.env.BASE_LOGS_RPC || "https://base-rpc.publicnode.com";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const CHUNK = 9000;
const CHUNKS = 30; // ~6 days of Base blocks
const WETH = "0x4200000000000000000000000000000000000006";
const ERC20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? "rpc error");
  return j.result as T;
}
interface Log { address: string; topics: string[]; data: string; transactionHash: string; blockNumber: string }
const pad = (a: string) => "0x" + "0".repeat(24) + a.toLowerCase().slice(2);

export async function POST() {
  const session = await getAppSession();
  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = await getDb();
    const u = (await db.collection("users").findOne({ _id: new ObjectId(session.user.id) })) as { privyUserId?: string } | null;
    const privy = getPrivyClient();
    const pu = privy && u?.privyUserId ? await privy.getUser(u.privyUserId) : null;
    const acc = pu?.linkedAccounts?.find((a) => a.type === "wallet" && "chainType" in a && a.chainType === "ethereum" && "walletClientType" in a && a.walletClientType === "privy");
    const wallet = acc && "address" in acc ? acc.address.toLowerCase() : "";
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return NextResponse.json({ ok: true, added: 0 });

    const stables = new Map(CASH_TOKENS.filter((c) => c.chain === "base" && !c.native).map((c) => [c.address.toLowerCase(), c.decimals]));
    const head = parseInt(await rpc<string>("eth_blockNumber", []), 16);
    const inLogs: Log[] = [], outLogs: Log[] = [];
    for (let batch = 0; batch < CHUNKS / 6; batch++) {
      const jobs: Promise<Log[]>[] = [];
      for (let i = 0; i < 6; i++) {
        const to = head - (batch * 6 + i) * CHUNK; const from = to - CHUNK + 1;
        const range = { fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) };
        jobs.push(rpc<Log[]>("eth_getLogs", [{ ...range, topics: [TRANSFER, null, pad(wallet)] }]).catch(() => []));
        jobs.push(rpc<Log[]>("eth_getLogs", [{ ...range, topics: [TRANSFER, pad(wallet)] }]).catch(() => []));
      }
      const res = await Promise.all(jobs);
      res.forEach((r, i) => (i % 2 === 0 ? inLogs : outLogs).push(...r));
    }

    // group the wallet's transfers by tx
    const txs = new Map<string, { ins: Log[]; outs: Log[] }>();
    for (const l of inLogs) (txs.get(l.transactionHash) ?? txs.set(l.transactionHash, { ins: [], outs: [] }).get(l.transactionHash)!).ins.push(l);
    for (const l of outLogs) (txs.get(l.transactionHash) ?? txs.set(l.transactionHash, { ins: [], outs: [] }).get(l.transactionHash)!).outs.push(l);

    const pc = createPublicClient({ chain: base, transport: http(RPC) });
    const meta = new Map<string, { symbol: string; decimals: number }>();
    const getMeta = async (addr: string) => {
      const k = addr.toLowerCase();
      if (meta.has(k)) return meta.get(k)!;
      const [symbol, decimals] = await Promise.all([
        pc.readContract({ address: getAddress(addr), abi: ERC20, functionName: "symbol" }).catch(() => "TOKEN"),
        pc.readContract({ address: getAddress(addr), abi: ERC20, functionName: "decimals" }).catch(() => 18),
      ]);
      const m = { symbol: String(symbol).replace(/[^A-Za-z0-9$._-]/g, "").slice(0, 24) || "TOKEN", decimals: Number(decimals) };
      meta.set(k, m); return m;
    };
    const tsCache = new Map<string, number>();
    const col = db.collection("evm_trades");
    let added = 0;
    const amt = (l: Log) => BigInt(l.data);

    for (const [hash, g] of [...txs].slice(0, 80)) {
      // cash that left / arrived in this tx
      let cashOut = 0, cashIn = 0;
      for (const l of g.outs) { const d = stables.get(l.address.toLowerCase()); if (d !== undefined) cashOut += Number(formatUnits(amt(l), d)); }
      for (const l of g.ins) { const d = stables.get(l.address.toLowerCase()); if (d !== undefined) cashIn += Number(formatUnits(amt(l), d)); }
      const isTok = (l: Log) => !stables.has(l.address.toLowerCase()) && l.address.toLowerCase() !== WETH;
      // buy: a non-cash token arrived and cash left (cash may also have arrived as change, ignore)
      const tokIn = g.ins.filter(isTok);
      const tokOut = g.outs.filter(isTok);
      const side: "buy" | "sell" | null = tokIn.length && cashOut > 0 && !tokOut.length ? "buy" : tokOut.length && cashIn > 0 && !tokIn.length ? "sell" : null;
      if (!side) continue;
      const lg = (side === "buy" ? tokIn : tokOut).reduce((a, b) => (amt(b) > amt(a) ? b : a));
      const usd = side === "buy" ? cashOut : cashIn;
      const m = await getMeta(lg.address);
      const tokens = Number(formatUnits(amt(lg), m.decimals));
      if (!(usd > 0.01) || !(tokens > 0)) continue;
      let ts = tsCache.get(lg.blockNumber);
      if (!ts) { const b = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [lg.blockNumber, false]); ts = parseInt(b.timestamp, 16) * 1000; tsCache.set(lg.blockNumber, ts); }
      const r = await col.updateOne(
        { userId: session.user.id, hash: hash.toLowerCase(), side },
        { $setOnInsert: { userId: session.user.id, chain: "base", address: lg.address.toLowerCase(), symbol: m.symbol, side, usd, tokens, priceUsd: usd / tokens, mcap: null, hash: hash.toLowerCase(), imageUrl: null, ts, synced: true } },
        { upsert: true });
      if (r.upsertedCount) added++;
    }
    return NextResponse.json({ ok: true, added });
  } catch (e) {
    console.error("[evm-trades sync]", e);
    return NextResponse.json({ error: "Sync failed" }, { status: 502 });
  }
}
