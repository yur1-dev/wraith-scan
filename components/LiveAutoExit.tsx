"use client";

// Executes live auto-exit rules (TP / SL / trailing) with the user's embedded Solana wallet.
// Runs only while Wraith is open and the tier has `auto_sell`. Sells 100% of the token back to USDC.

import { useEffect, useMemo, useRef } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction, PublicKey } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { getMcap } from "@/lib/getTokenPrice";
import { executeQuickSell, SwapError } from "@/lib/jupiterSwap";
import { LIVE_EXIT_FIRED, readRules, writeRules, type LiveExitRule } from "@/lib/liveExits";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TICK_MS = 4000;
const MAX_FAILS = 3;

export default function LiveAutoExit({ enabled }: { enabled: boolean }) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { connection } = useConnection();
  const selling = useRef(new Set<string>());

  const address = useMemo(() => {
    const a = user?.linkedAccounts.find((x) => x.type === "wallet" && x.chainType === "solana" && x.walletClientType === "privy");
    return a?.type === "wallet" ? a.address : null;
  }, [user]);
  const wallet = useMemo(() => wallets.find((w) => w.address === address), [wallets, address]);

  useEffect(() => {
    if (!enabled || !address || !wallet) return;
    const publicKey = new PublicKey(address);
    const signer = {
      publicKey,
      signTransaction: async (tx: VersionedTransaction) => {
        const r = await signTransaction({ transaction: tx.serialize(), wallet, chain: "solana:mainnet" });
        return VersionedTransaction.deserialize(r.signedTransaction);
      },
    };
    const fire = (kind: "tp" | "sl" | "trail" | "failed" | "gone", rule: LiveExitRule, pnl: number, sig?: string) =>
      window.dispatchEvent(new CustomEvent(LIVE_EXIT_FIRED, { detail: { kind, symbol: rule.symbol, mint: rule.mint, pnl, sig } }));
    const patch = (id: string, f: (r: LiveExitRule) => LiveExitRule | null) =>
      writeRules(readRules().flatMap((r) => (r.id === id ? (f(r) ? [f(r) as LiveExitRule] : []) : [r])));

    const tick = async () => {
      if (document.hidden) return;
      for (const rule of readRules().filter((r) => !r.sandbox)) {
        if (selling.current.has(rule.id)) continue;
        const mc = await getMcap(rule.mint, { skipJupiter: true }).catch(() => 0);
        if (!(mc > 0)) continue;
        const peak = Math.max(rule.peakMcap, mc);
        const pnl = (mc / rule.entryMcap - 1) * 100;
        let kind: "tp" | "sl" | "trail" | null = null;
        if (rule.tpPct > 0 && pnl >= rule.tpPct) kind = "tp";
        else if (rule.slPct > 0 && pnl <= -rule.slPct) kind = "sl";
        else if (rule.trailPct > 0 && peak > rule.entryMcap && mc <= peak * (1 - rule.trailPct / 100)) kind = "trail";
        if (!kind) {
          if (peak !== rule.peakMcap) patch(rule.id, (r) => ({ ...r, peakMcap: peak }));
          continue;
        }
        selling.current.add(rule.id);
        try {
          const res = await executeQuickSell(rule.mint, 100, signer, connection, { outputMint: USDC_MINT });
          patch(rule.id, () => null);
          fire(kind, rule, pnl, res.signature);
          void fetch("/api/token-activity", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mint: rule.mint, side: "sell", signature: res.signature }),
          }).then(() => window.dispatchEvent(new Event("wraith:trade-recorded"))).catch(() => undefined);
        } catch (e) {
          if (e instanceof SwapError && e.code === "NO_TOKENS") { patch(rule.id, () => null); fire("gone", rule, pnl); }
          else if (rule.fails + 1 >= MAX_FAILS) { patch(rule.id, () => null); fire("failed", rule, pnl); }
          else patch(rule.id, (r) => ({ ...r, fails: r.fails + 1 }));
        } finally { selling.current.delete(rule.id); }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled, address, wallet, signTransaction, connection]);

  return null;
}
