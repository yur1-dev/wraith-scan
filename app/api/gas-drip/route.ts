// POST /api/gas-drip  { chain, address }
// Wraith pays the network gas for cash moves: sends a tiny amount of the chain's gas token from a treasury wallet
// to the user's OWN embedded wallet, only when it is nearly empty. Needs env GAS_TREASURY_KEY (0x private key of a
// wallet you fund with a little ETH/BNB/MON). Without it the route answers 503 and the app falls back to the wallet's own gas.
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { createPublicClient, createWalletClient, http, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getPrivySession } from "@/lib/privyAuth";
import { getPrivyClient } from "@/lib/privyServer";
import { getDb } from "@/lib/mongoClient";
import { VIEM_CHAINS, rpcFor } from "@/lib/cashTokens";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { gasDecision, dripCostUsd } from "@/lib/gasPolicy";

const SOL_DRIP_LAMPORTS = Number(process.env.GAS_DRIP_SOLANA_LAMPORTS ?? 4_000_000); // 0.004 SOL (trade code needs 0.0035)

// amount sent per top-up (override with GAS_DRIP_<CHAIN>, e.g. GAS_DRIP_BASE=0.00004)
const DRIP: Record<string, string> = { base: "0.00003", ethereum: "0.0004", bsc: "0.0002", monad: "0.2", robinhood: "0.00003" };
const MAX_PER_DAY = 4; // (unused, kept for reference)

export async function POST(req: NextRequest) {
  const key = process.env.GAS_TREASURY_KEY;
  if (!key) return NextResponse.json({ error: "Gas treasury not configured" }, { status: 503 });
  const session = await getPrivySession(req);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { chain?: unknown; address?: unknown } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const chainKey = typeof body.chain === "string" ? body.chain : "";
  const address = typeof body.address === "string" ? body.address : "";
  const isSol = chainKey === "solana";
  const chain = VIEM_CHAINS[chainKey]; const rpc = chain ? rpcFor(chain) : null;
  if (isSol) {
    const solKey = process.env.GAS_TREASURY_SOL_KEY;
    if (!solKey) return NextResponse.json({ error: "Solana gas treasury not configured" }, { status: 503 });
    let pk: PublicKey; try { pk = new PublicKey(address); } catch { return NextResponse.json({ error: "Unsupported" }, { status: 400 }); }
    try {
      const db = await getDb();
      const u = ObjectId.isValid(session.user.id) ? await db.collection("users").findOne({ _id: new ObjectId(session.user.id) }) : null;
      const privy = getPrivyClient();
      const pid = (u as { privyUserId?: string } | null)?.privyUserId;
      const pu = privy && pid ? await privy.getUser(pid) : null;
      const owned = pu?.linkedAccounts?.some((a) => a.type === "wallet" && "address" in a && a.address === address);
      if (!owned) return NextResponse.json({ error: "Wallet is not linked to this account" }, { status: 403 });
      const conn = new Connection(process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://solana-rpc.publicnode.com", "confirmed");
      const bal = await conn.getBalance(pk);
      if (bal >= 3_500_000) return NextResponse.json({ ok: true, skipped: true });
      const drips = db.collection("gas_drips");
      const evmAddr = pu?.linkedAccounts?.find((a) => a.type === "wallet" && "chainType" in a && a.chainType === "ethereum" && "address" in a) as { address?: string } | undefined;
      const d = await gasDecision(db, { userId: session.user.id, chain: "solana", evm: evmAddr?.address ?? null, sol: address });
      if (!d.ok) return NextResponse.json({ error: d.reason }, { status: 429 });
      const payer = Keypair.fromSecretKey(bs58.decode(solKey));
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: pk, lamports: SOL_DRIP_LAMPORTS })), [payer]);
      await drips.insertOne({ userId: session.user.id, address, chain: "solana", hash: sig, costUsd: dripCostUsd("solana"), at: new Date() });
      return NextResponse.json({ ok: true, hash: sig });
    } catch (e) {
      console.warn("[gas-drip solana]", e);
      return NextResponse.json({ error: "Drip failed" }, { status: 500 });
    }
  }
  const dripStr = process.env[`GAS_DRIP_${chainKey.toUpperCase()}`] ?? DRIP[chainKey];
  if (!chain || !rpc || !dripStr || !isAddress(address)) return NextResponse.json({ error: "Unsupported" }, { status: 400 });

  // the wallet must belong to this account
  try {
    const db = await getDb();
    const u = ObjectId.isValid(session.user.id) ? await db.collection("users").findOne({ _id: new ObjectId(session.user.id) }) : null;
    const privy = getPrivyClient();
    const pid = (u as { privyUserId?: string } | null)?.privyUserId;
    const pu = privy && pid ? await privy.getUser(pid) : null;
    const owned = pu?.linkedAccounts?.some((a) => a.type === "wallet" && "address" in a && a.address.toLowerCase() === address.toLowerCase());
    if (!owned) return NextResponse.json({ error: "Wallet is not linked to this account" }, { status: 403 });

    const drip = parseEther(dripStr);
    const pc = createPublicClient({ chain, transport: http(rpc) });
    const bal = await pc.getBalance({ address });
    if (bal >= drip / BigInt(2)) return NextResponse.json({ ok: true, skipped: true });

    // limit per account per day
    const drips = db.collection("gas_drips");
    const solAcc = pu?.linkedAccounts?.find((a) => a.type === "wallet" && "chainType" in a && a.chainType === "solana" && "address" in a) as { address?: string } | undefined;
    const d = await gasDecision(db, { userId: session.user.id, chain: chainKey, evm: address, sol: solAcc?.address ?? null });
    if (!d.ok) return NextResponse.json({ error: d.reason }, { status: 429 });

    const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
    const wc = createWalletClient({ account, chain, transport: http(rpc) });
    const hash = await wc.sendTransaction({ to: address, value: drip });
    await pc.waitForTransactionReceipt({ hash });
    await drips.insertOne({ userId: session.user.id, address, chain: chainKey, hash, costUsd: dripCostUsd(chainKey), at: new Date() });
    return NextResponse.json({ ok: true, hash });
  } catch (e) {
    console.warn("[gas-drip]", e);
    return NextResponse.json({ error: "Drip failed" }, { status: 500 });
  }
}
