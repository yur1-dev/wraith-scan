"use client";

import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
} from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  WRAITH_MINT,
  getTierFromBalance,
  canUse,
  TIERS,
  type TierKey,
} from "@/lib/tiers";
import { isWhitelisted, getTierOverride } from "@/lib/whitelist";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WraithTierState {
  tier: (typeof TIERS)[TierKey];
  rawBalance: number;
  loading: boolean;
  isWhitelistMember: boolean;
  canUse: (feature: string) => boolean;
  refresh: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const WraithTierContext = createContext<WraithTierState | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function WraithTierProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();

  const [rawBalance, setRawBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isWhitelistMember, setIsWhitelistMember] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!connected || !publicKey) {
      setRawBalance(0);
      setIsWhitelistMember(false);
      return;
    }

    const walletStr = publicKey.toString();

    // Whitelist check — skip RPC entirely, force WRAITH
    if (isWhitelisted(walletStr)) {
      setIsWhitelistMember(true);
      setRawBalance(0);
      setLoading(false);
      return;
    }

    setIsWhitelistMember(false);

    // Token not deployed yet — skip RPC to avoid base58 parse error
    if (!WRAITH_MINT || WRAITH_MINT === "WRAITH_TOKEN_MINT_PLACEHOLDER") {
      setRawBalance(0);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const mintPubkey = new PublicKey(WRAITH_MINT);
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        publicKey,
        { mint: mintPubkey },
      );

      const balance = tokenAccounts.value.reduce((sum, acc) => {
        const amount =
          acc.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        return sum + amount;
      }, 0);

      setRawBalance(balance);
    } catch (err) {
      console.error("[WraithTier] Failed to fetch balance:", err);
      setRawBalance(0);
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, connection]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // ─── Tier resolution priority ────────────────────────────────────────────
  // 1. WHITELISTED_WALLETS → always WRAITH
  // 2. WALLET_TIER_OVERRIDES → forced tier (for testing)
  // 3. Token balance → computed tier
  const walletStr = publicKey?.toString() ?? null;
  const tierOverride = getTierOverride(walletStr);

  const tier = isWhitelistMember
    ? TIERS.WRAITH
    : tierOverride
      ? TIERS[tierOverride]
      : getTierFromBalance(rawBalance);

  const canUseFeature = useCallback(
    (feature: string) => {
      if (isWhitelistMember) return true;
      return canUse(tier, feature);
    },
    [tier, isWhitelistMember],
  );

  return (
    <WraithTierContext.Provider
      value={{
        tier,
        rawBalance,
        loading,
        isWhitelistMember,
        canUse: canUseFeature,
        refresh: fetchBalance,
      }}
    >
      {children}
    </WraithTierContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useWraithTier(): WraithTierState {
  const ctx = useContext(WraithTierContext);
  if (!ctx)
    throw new Error("useWraithTier must be used inside <WraithTierProvider>");
  return ctx;
}

// ─── UI Components ───────────────────────────────────────────────────────────

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};

const TIER_COLOR: Record<TierKey, string> = {
  GHOST: "#555566",
  SHADE: "#00b4d8",
  SPECTER: "#a855f7",
  WRAITH: "#e8490f",
};

export function TierBadge({ compact = false }: { compact?: boolean }) {
  const { tier, isWhitelistMember } = useWraithTier();
  const color = TIER_COLOR[tier.key];

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: `${color}14`,
        border: `1px solid ${color}40`,
        borderRadius: 3,
        padding: compact ? "4px 10px" : "6px 14px",
        ...MONO,
      }}
    >
      <span
        style={{
          color,
          fontSize: compact ? 9 : 10,
          fontWeight: 900,
          letterSpacing: ".12em",
        }}
      >
        {tier.key}
      </span>
      {isWhitelistMember && (
        <span
          style={{
            fontSize: 7,
            color: `${color}bb`,
            letterSpacing: ".08em",
            borderLeft: `1px solid ${color}30`,
            paddingLeft: 6,
          }}
        >
          DEV
        </span>
      )}
    </div>
  );
}

export function TierGate({
  feature,
  children,
  fallback,
}: {
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { canUse } = useWraithTier();
  if (canUse(feature)) return <>{children}</>;
  return fallback ? <>{fallback}</> : null;
}
