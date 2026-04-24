// ─── WRAITH TIER SYSTEM ───────────────────────────────────────────────────────
// Replace WRAITH_MINT with your real token mint after launch
// Replace FEE_WALLET with your treasury wallet address

export const WRAITH_MINT = "WRAITH_TOKEN_MINT_PLACEHOLDER";
export const FEE_WALLET = "YOUR_FEE_TREASURY_WALLET_HERE";

// 1B total supply — tiers based on % held
// GHOST:   0 tokens         → read-only, no trading
// SHADE:   10,000  (0.001%) → basic sniper, 1% fee
// SPECTER: 100,000 (0.01%)  → full scanner + sniper, 0.5% fee
// WRAITH:  1,000,000 (0.1%) → all features + live signals, 0% fee

export type TierKey = "GHOST" | "SHADE" | "SPECTER" | "WRAITH";

export interface Tier {
  key: TierKey;
  label: string;
  minTokens: number;
  feeBps: number;
  color: string;
  description: string;
  features: {
    id: string;
    label: string;
    unlocked: boolean;
  }[];
}

export const TIERS: Record<TierKey, Tier> = {
  GHOST: {
    key: "GHOST",
    label: "GHOST",
    minTokens: 0,
    feeBps: 150,
    color: "#444",
    description: "No WRAITH held. Scanner visible, trading locked.",
    features: [
      { id: "scanner_view", label: "View Scanner", unlocked: true },
      { id: "live_signals_view", label: "View Live Signals", unlocked: false },
      { id: "sniper", label: "Sniper / Auto-buy", unlocked: false },
      { id: "auto_sell", label: "Auto TP/SL/Trail", unlocked: false },
      { id: "telegram_alerts", label: "Telegram Alerts", unlocked: false },
      { id: "ai_score", label: "AI Score Access", unlocked: false },
      { id: "hot_wallet", label: "Hot Wallet", unlocked: false },
    ],
  },
  SHADE: {
    key: "SHADE",
    label: "SHADE",
    minTokens: 10_000,
    feeBps: 100,
    color: "#00b4d8",
    description: "Hold 10K+ WRAITH. Basic trading unlocked.",
    features: [
      { id: "scanner_view", label: "View Scanner", unlocked: true },
      { id: "live_signals_view", label: "View Live Signals", unlocked: false },
      { id: "sniper", label: "Sniper / Auto-buy", unlocked: true },
      { id: "auto_sell", label: "Auto TP/SL/Trail", unlocked: true },
      { id: "telegram_alerts", label: "Telegram Alerts", unlocked: false },
      { id: "ai_score", label: "AI Score Access", unlocked: false },
      { id: "hot_wallet", label: "Hot Wallet", unlocked: true },
    ],
  },
  SPECTER: {
    key: "SPECTER",
    label: "SPECTER",
    minTokens: 100_000,
    feeBps: 50,
    color: "#a855f7",
    description: "Hold 100K+ WRAITH. Full suite unlocked.",
    features: [
      { id: "scanner_view", label: "View Scanner", unlocked: true },
      { id: "live_signals_view", label: "View Live Signals", unlocked: false },
      { id: "sniper", label: "Sniper / Auto-buy", unlocked: true },
      { id: "auto_sell", label: "Auto TP/SL/Trail", unlocked: true },
      { id: "telegram_alerts", label: "Telegram Alerts", unlocked: true },
      { id: "ai_score", label: "AI Score Access", unlocked: true },
      { id: "hot_wallet", label: "Hot Wallet", unlocked: true },
    ],
  },
  WRAITH: {
    key: "WRAITH",
    label: "WRAITH",
    minTokens: 1_000_000,
    feeBps: 0,
    color: "#e8490f",
    description:
      "Hold 1M+ WRAITH. Zero fees. Live signals. Priority everything.",
    features: [
      { id: "scanner_view", label: "View Scanner", unlocked: true },
      { id: "live_signals_view", label: "View Live Signals", unlocked: true },
      { id: "sniper", label: "Sniper / Auto-buy", unlocked: true },
      { id: "auto_sell", label: "Auto TP/SL/Trail", unlocked: true },
      { id: "telegram_alerts", label: "Telegram Alerts", unlocked: true },
      { id: "ai_score", label: "AI Score Access", unlocked: true },
      { id: "hot_wallet", label: "Hot Wallet", unlocked: true },
    ],
  },
};

export const TIER_ORDER: TierKey[] = ["GHOST", "SHADE", "SPECTER", "WRAITH"];

/** Returns the tier for a given raw token balance */
export function getTierFromBalance(rawBalance: number): Tier {
  if (rawBalance >= TIERS.WRAITH.minTokens) return TIERS.WRAITH;
  if (rawBalance >= TIERS.SPECTER.minTokens) return TIERS.SPECTER;
  if (rawBalance >= TIERS.SHADE.minTokens) return TIERS.SHADE;
  return TIERS.GHOST;
}

/** Check if a tier can use a specific feature */
export function canUse(tier: Tier, featureId: string): boolean {
  return tier.features.find((f) => f.id === featureId)?.unlocked ?? false;
}
