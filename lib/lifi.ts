// Client helpers for LI.FI routing (quotes via /api/swap-quote, status via /api/swap-status).
import { createPublicClient, createWalletClient, custom, http, parseAbi, type Chain } from "viem";
import { rpcFor } from "@/lib/cashTokens";

export const SOLANA_LIFI_ID = 1151111081099710;
export const NATIVE_ADDR = "0x0000000000000000000000000000000000000000";

export interface LifiQuote {
  transactionRequest: { to?: `0x${string}`; data: string; value?: string; gasLimit?: string };
  estimate: { approvalAddress?: string; toAmountMin: string; executionDuration?: number; gasCosts?: { amountUSD?: string }[]; feeCosts?: { amountUSD?: string }[] };
  action: { toToken: { decimals: number; symbol: string } };
}

export async function lifiQuote(p: { fromChain: number; toChain: number; fromToken: string; toToken: string; fromAmount: string; fromAddress: string; toAddress?: string }): Promise<LifiQuote> {
  const q = new URLSearchParams({ fromChain: String(p.fromChain), toChain: String(p.toChain), fromToken: p.fromToken, toToken: p.toToken, fromAmount: p.fromAmount, fromAddress: p.fromAddress, slippage: "0.03" });
  if (p.toAddress) q.set("toAddress", p.toAddress);
  const res = await fetch(`/api/swap-quote?${q}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.transactionRequest) throw new Error(data?.message || data?.error || "No route found for this amount");
  return data as LifiQuote;
}

/** Poll until the destination side lands (cross-chain only). Throws on FAILED. */
export async function waitForRoute(hash: string, fromChain: number, toChain: number): Promise<void> {
  if (fromChain === toChain) return;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await fetch(`/api/swap-status?txHash=${hash}&fromChain=${fromChain}&toChain=${toChain}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (s?.status === "DONE") return;
    if (s?.status === "FAILED") throw new Error("Bridge failed. Funds stay recoverable, check the explorer.");
  }
}

const ERC20 = parseAbi(["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);

interface EvmWalletLike { switchChain: (id: number) => Promise<void>; getEthereumProvider: () => Promise<unknown> }

/** Approve (if needed) + send a LI.FI EVM transaction with the Privy wallet. Returns the tx hash once mined. */
export async function execEvmRoute(o: {
  wallet: EvmWalletLike; account: `0x${string}`; chain: Chain; quote: LifiQuote;
  fromToken: string; native: boolean; fromRaw: bigint; onPhase?: (p: "approving" | "sending") => void;
}): Promise<string> {
  await o.wallet.switchChain(o.chain.id);
  const provider = await o.wallet.getEthereumProvider();
  const wc = createWalletClient({ account: o.account, chain: o.chain, transport: custom(provider as Parameters<typeof custom>[0]) });
  const pc = createPublicClient({ chain: o.chain, transport: http(rpcFor(o.chain) ?? undefined) });
  const spender = o.quote.estimate.approvalAddress as `0x${string}` | undefined;
  if (!o.native && spender) {
    const allowance = await pc.readContract({ address: o.fromToken as `0x${string}`, abi: ERC20, functionName: "allowance", args: [o.account, spender] });
    if (allowance < o.fromRaw) {
      o.onPhase?.("approving");
      const h = await wc.writeContract({ address: o.fromToken as `0x${string}`, abi: ERC20, functionName: "approve", args: [spender, o.fromRaw] });
      await pc.waitForTransactionReceipt({ hash: h });
    }
  }
  o.onPhase?.("sending");
  const r = o.quote.transactionRequest;
  const hash = await wc.sendTransaction({ to: r.to as `0x${string}`, data: r.data as `0x${string}`, value: r.value ? BigInt(r.value) : BigInt(0), ...(r.gasLimit ? { gas: BigInt(r.gasLimit) } : {}) });
  await pc.waitForTransactionReceipt({ hash });
  return hash;
}

export function friendlyError(e: unknown, gasToken?: string, chainName?: string): string {
  const m = e instanceof Error ? e.message : "Transaction failed";
  if (/insufficient funds|gas/i.test(m)) return `Not enough ${gasToken ?? "gas token"}${chainName ? ` on ${chainName}` : ""} to pay network gas.`;
  if (/reject|denied|cancel/i.test(m)) return "Cancelled.";
  return m.split("\n")[0].slice(0, 160);
}
