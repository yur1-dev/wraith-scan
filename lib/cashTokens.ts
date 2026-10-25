// lib/cashTokens.ts
// Single source of truth for what counts as CASH in a Wraith account.
//   Cash     = stablecoins listed here, on any supported chain, summed in USD.
//   Holdings = everything else (SOL, ETH, memecoins, tokens sent from other apps).
// To accept a new stablecoin or chain, add one line below.

import type { Chain } from "viem";
import { arc, base, bsc, mainnet, monad, robinhood } from "viem/chains";

export interface CashToken {
  chain: string;              // "solana" or a key from lib/chains.ts
  symbol: "USDC" | "USDT" | "USDG";
  address: string;            // mint (Solana) or contract (EVM); ignored when native
  decimals: number;
  native?: boolean;           // chain's gas token IS the stablecoin (Arc)
}

export const CASH_TOKENS: CashToken[] = [
  { chain: "solana", symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  { chain: "solana", symbol: "USDT", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNyFmCqLMqMHhM9gFm", decimals: 6 },
  { chain: "ethereum", symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  { chain: "ethereum", symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  { chain: "base", symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  { chain: "bsc", symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
  { chain: "bsc", symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
  { chain: "monad", symbol: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 },
  { chain: "arc", symbol: "USDC", address: "", decimals: 18, native: true },
  // Robinhood Chain uses USDG (Paxos Global Dollar). Address from a secondary source and decimals assumed 6: verify on the explorer before real funds.
  { chain: "robinhood", symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
];

export const VIEM_CHAINS: Record<string, Chain> = {
  ethereum: mainnet,
  base,
  bsc,
  monad,
  arc,
  robinhood,
};

/** RPC for a chain, or null when none is configured (viem's Arc definition ships with no RPC). */
export function rpcFor(chain: Chain): string | null {
  const first = chain.rpcUrls.default.http[0];
  if (first) return first;
  if (chain.id === arc.id) return process.env.NEXT_PUBLIC_ARC_RPC || null;
  return null;
}

/** Deposit screen config: which chains show, the cash token to send, and the minimum (matches fomo's rules). */
export const DEPOSIT_CHAINS: { key: string; name: string; symbol: string; min: number | null }[] = [
  { key: "solana", name: "Solana", symbol: "USDC", min: null },
  { key: "base", name: "Base", symbol: "USDC", min: 0.5 },
  { key: "bsc", name: "BNB Chain", symbol: "USDC", min: 0.5 },
  { key: "monad", name: "Monad", symbol: "USDC", min: 0.5 },
  { key: "robinhood", name: "Robinhood Chain", symbol: "USDG", min: 0.5 },
  { key: "arc", name: "Arc", symbol: "USDC", min: 0.5 },
  { key: "ethereum", name: "Ethereum", symbol: "USDC", min: 15 },
];
