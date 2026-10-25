"use client";
// Unified cash: every stablecoin in lib/cashTokens.ts across Solana + all EVM chains, from your Wraith wallets.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { createPublicClient, formatUnits, http, isAddress, parseAbi } from "viem";
import { CASH_TOKENS, VIEM_CHAINS, rpcFor } from "@/lib/cashTokens";
import { NATIVE_ADDR } from "@/lib/lifi";

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface CashSource {
  id: string; kind: "solana" | "evm"; chain: string; symbol: string;
  address: string; decimals: number; native: boolean; balance: number; chainName: string;
}

export function useCashSources(preferChain?: string) {
  const { user } = usePrivy();
  const { connection } = useConnection();
  const evmAddress = useMemo(() => {
    const a = user?.linkedAccounts.find((x) => x.type === "wallet" && x.chainType === "ethereum" && x.walletClientType === "privy");
    return a?.type === "wallet" && isAddress(a.address) ? (a.address as `0x${string}`) : null;
  }, [user]);
  const solAddress = useMemo(() => {
    const a = user?.linkedAccounts.find((x) => x.type === "wallet" && x.chainType === "solana" && x.walletClientType === "privy");
    return a?.type === "wallet" ? a.address : null;
  }, [user]);
  const [sources, setSources] = useState<CashSource[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!evmAddress && !solAddress) return;
    const rows = await Promise.all(CASH_TOKENS.map(async (c): Promise<CashSource | null> => {
      try {
        if (c.chain === "solana") {
          if (!solAddress) return null;
          const r = await connection.getParsedTokenAccountsByOwner(new PublicKey(solAddress), { mint: new PublicKey(c.address) }, "confirmed");
          const bal = r.value.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
          return { id: `solana:${c.symbol}`, kind: "solana", chain: "solana", chainName: "Solana", symbol: c.symbol, address: c.address, decimals: c.decimals, native: false, balance: bal };
        }
        if (!evmAddress) return null;
        const chain = VIEM_CHAINS[c.chain]; const rpc = chain ? rpcFor(chain) : null;
        if (!chain || !rpc) return null;
        const client = createPublicClient({ chain, transport: http(rpc, { retryCount: 0, timeout: 6000 }) });
        const raw = c.native ? await client.getBalance({ address: evmAddress }) : await client.readContract({ address: c.address as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [evmAddress] });
        return { id: `${c.chain}:${c.symbol}`, kind: "evm", chain: c.chain, chainName: chain.name, symbol: c.symbol, address: c.native ? NATIVE_ADDR : c.address, decimals: c.decimals, native: !!c.native, balance: Number(formatUnits(raw, c.decimals)) };
      } catch { return null; }
    }));
    const score = (s: CashSource) => (s.chain === preferChain ? 1e12 : 0) + s.balance;
    setSources(rows.filter((r): r is CashSource => !!r && r.balance > 0.0001).sort((a, b) => score(b) - score(a)));
    setLoaded(true);
  }, [evmAddress, solAddress, connection, preferChain]);

  useEffect(() => {
    void reload();
    const t = window.setInterval(() => void reload(), 20_000);
    return () => window.clearInterval(t);
  }, [reload]);

  return { sources, total: sources.reduce((s, x) => s + x.balance, 0), loaded, reload, evmAddress, solAddress };
}
