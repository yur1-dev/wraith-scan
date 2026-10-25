"use client";

import { useEffect, useMemo, useState } from "react";
import { Connection } from "@solana/web3.js";
import { useTestMode } from "@/lib/testMode";
import { usePrivy } from "@privy-io/react-auth";
import { createPublicClient, http, isAddress, parseAbi } from "viem";
import { CASH_TOKENS, VIEM_CHAINS, rpcFor } from "@/lib/cashTokens";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { formatCurrency, type DisplayCurrency } from "@/lib/currencies";

const USDC_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export default function EmbeddedWalletBalanceChip({
  currency,
  onDeposit,
  onWithdraw,
}: {
  currency: DisplayCurrency;
  onDeposit: () => void;
  onWithdraw?: () => void;
}) {
  const { connection } = useConnection();
  const { ready, user } = usePrivy();
  const [cash, setCash] = useState<number | null>(null);
  const [currencyRate, setCurrencyRate] = useState<number | null>(currency === "USD" ? 1 : null);
  const [loading, setLoading] = useState(true);
  const [testMode] = useTestMode();
  const [devSol, setDevSol] = useState<number | null>(null);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const ethereumWallet = useMemo(() => user?.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "ethereum" && a.walletClientType === "privy") ?? null, [user]);
  const solanaWallet = useMemo(() => user?.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "solana" && a.walletClientType === "privy") ?? null, [user]);

  useEffect(() => {
    let active = true;
    if (currency === "USD") {
      setCurrencyRate(1);
      return () => { active = false; };
    }
    setCurrencyRate(null);
    fetch(`/api/fx?currency=${currency}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Currency rate unavailable (${response.status}).`);
        const data: unknown = await response.json();
        if (typeof data !== "object" || data === null || !("rate" in data) || typeof data.rate !== "number" || !Number.isFinite(data.rate) || data.rate <= 0) throw new Error("Currency rate response was invalid.");
        if (active) setCurrencyRate(data.rate);
      })
      .catch((error) => { console.error("[wallet display currency rate]", error); if (active) setCurrencyRate(null); });
    return () => { active = false; };
  }, [currency]);

  useEffect(() => {
    if (!testMode || !solanaWallet || solanaWallet.type !== "wallet") return;
    let active = true;
    const conn = new Connection(process.env.NEXT_PUBLIC_DEVNET_RPC_URL || "https://api.devnet.solana.com", "confirmed");
    const pk = new PublicKey(solanaWallet.address);
    const SOL = "So11111111111111111111111111111111111111112";
    const tick = () => {
      void conn.getBalance(pk).then((l) => { if (active) setDevSol(l / 1e9); }).catch(() => {});
      void fetch(`/api/price?ids=${SOL}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          const v = Number(d?.data?.[SOL]?.price ?? d?.[SOL]?.usdPrice ?? d?.[SOL]?.price);
          if (active && Number.isFinite(v) && v > 0) setSolUsd(v);
        })
        .catch(() => {});
    };
    tick();
    const t = window.setInterval(tick, 8000);
    return () => { active = false; window.clearInterval(t); };
  }, [testMode, solanaWallet]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!ready) return;
      // Only show the skeleton on the very first load. After we have a value,
      // subsequent refreshes update silently so the header never blanks.
      const tasks: Promise<number>[] = [];
      const evm = ethereumWallet?.type === "wallet" && ethereumWallet.chainType === "ethereum" && isAddress(ethereumWallet.address) ? ethereumWallet.address : null;
      // CASH = stablecoins only (see lib/cashTokens.ts). SOL, ETH and other tokens are holdings, not cash.
      if (evm) {
        for (const item of CASH_TOKENS) {
          if (item.chain === "solana") continue;
          const chain = VIEM_CHAINS[item.chain];
          const rpc = chain ? rpcFor(chain) : null;
          if (!chain || !rpc) continue;
          const label = `${chain.name} ${item.symbol}`;
          if (item.native) {
            // Skip a chain for the rest of the session once its RPC is unreachable (avoids a failing request every minute).
            const down = (window as unknown as { __wxDown?: Record<string, boolean> });
            down.__wxDown = down.__wxDown ?? {};
            if (down.__wxDown[item.chain]) continue;
            tasks.push(createPublicClient({ chain, transport: http(rpc, { retryCount: 0, timeout: 6000 }) }).getBalance({ address: evm }).then((v) => Number(v) / 10 ** item.decimals).catch((e) => { down.__wxDown![item.chain] = true; console.warn(`[${label} balance] RPC unreachable, skipping`, e instanceof Error ? e.message.split("\n")[0] : e); return 0; }));
          } else {
            tasks.push(createPublicClient({ chain, transport: http(rpc) }).readContract({ address: item.address as `0x${string}`, abi: USDC_ABI, functionName: "balanceOf", args: [evm] }).then((v) => Number(v) / 10 ** item.decimals).catch((e) => { console.warn(`[${label} balance]`, e instanceof Error ? e.message.split("\n")[0] : e); return 0; }));
          }
        }
      }
      if (solanaWallet?.type === "wallet" && solanaWallet.chainType === "solana") {
        const solAddress = new PublicKey(solanaWallet.address);
        for (const item of CASH_TOKENS) {
          if (item.chain !== "solana") continue;
          tasks.push(connection.getParsedTokenAccountsByOwner(solAddress, { mint: new PublicKey(item.address) }, "confirmed").then((r) => r.value.reduce((sum, acc) => sum + Number(acc.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0)).catch((e) => { console.warn(`[Solana ${item.symbol} balance]`, e instanceof Error ? e.message.split("\n")[0] : e); return 0; }));
        }
      }
      const amounts = await Promise.all(tasks);
      if (active) {
        setCash(amounts.reduce((sum, value) => sum + value, 0));
        setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [connection, ethereumWallet, ready, solanaWallet]);

  return <div className="embedded-wallet-header-chip" title="Wallet cash estimate converted using your selected account display currency.">
    <div className="embedded-wallet-header-value"><span>{testMode ? `TEST BALANCE${devSol !== null ? ` · ${devSol.toLocaleString(undefined, { maximumFractionDigits: 3 })} SOL` : ""}` : "CASH BALANCE"}</span><strong aria-live="polite" style={testMode ? { color: "#f59e0b" } : undefined}>{testMode ? (devSol === null ? "..." : solUsd !== null && currencyRate !== null ? formatCurrency(devSol * solUsd * currencyRate, currency) : `${devSol.toLocaleString(undefined, { maximumFractionDigits: 3 })} SOL`) : loading ? "..." : cash === null || currencyRate === null ? "—" : formatCurrency(cash * currencyRate, currency)}</strong></div>
    <div className="embedded-wallet-header-actions">
      <button type="button" className="embedded-wallet-header-deposit" onClick={onDeposit} aria-label="Deposit more into your WRAITH account">Deposit</button>
      {onWithdraw && <button type="button" className="embedded-wallet-header-withdraw" onClick={onWithdraw} aria-label="Withdraw from your WRAITH account">Withdraw</button>}
    </div>
  </div>;
}

