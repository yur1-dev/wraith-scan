// theme.ts
// ─────────────────────────────────────────────────────────────────────────
// Single source of truth for colors, spacing, radius, and typography across
// EVERY panel (Header, LiveSignalsBar, TokenPanel, WinsPanel, MemeScanner,
// PaperTrader). Nothing should hardcode a hex color, a px padding value, or
// a borderRadius number directly in a component anymore — import from here.
//
// This is why panels currently look "not connected" to each other: each
// file invented its own numbers independently. One shared object fixes
// that at the root instead of patching each panel by eye.
// ─────────────────────────────────────────────────────────────────────────

export const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
  fontVariantNumeric: "tabular-nums" as const,
};

// ── Color palette ───────────────────────────────────────────────────────
export const C = {
  primary: "#f4f5f7",
  muted: "#a0a3ad",
  dim: "#777b87",
  label: "rgba(244,245,247,0.68)",
  orange: "#e8490f",
  green: "#22c55e",
  yellow: "#ffd700",
  purple: "#a855f7",
  blue: "#00b4d8",
  red: "#ef4444",
  amber: "#ffaa00",
  bg: "#090a0f",
  bgCard: "#101117",
  border: "rgba(255,255,255,0.08)",
  borderHover: "rgba(255,255,255,0.15)",
  hot: "#ff6b35",
} as const;

// ── Spacing scale ───────────────────────────────────────────────────────
// This is the piece that was completely missing. Every panel picked its
// own padding/gap by eye (4px here, 9px there, "10px 14px" somewhere else)
// with nothing tying them together. Use these everywhere instead of a raw
// number — that's what actually creates consistent "breathing room" panel
// to panel.
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// ── Radius scale ────────────────────────────────────────────────────────
export const RADIUS = {
  sm: 6,
  md: 8,
  lg: 12,
  full: 999,
} as const;

// ── Typography scale ────────────────────────────────────────────────────
export const FONT = {
  micro: 12,
  xs: 12,
  sm: 12,
  base: 14,
  md: 12,
  lg: 16,
  xl: 20,
} as const;

// ── Shared card shell ───────────────────────────────────────────────────
// Every panel's outer "card" container (a win card, a token row card, a
// scanner result card) should extend this instead of writing its own
// background/border/radius/padding combination.
export const CARD_BASE = {
  background: C.bgCard,
  border: `1px solid ${C.border}`,
  borderRadius: RADIUS.lg,
  padding: SPACE.lg,
} as const;

// Tier accent colors (HOT / MEGA / WIN / CELEB) shared across WinsPanel,
// LiveSignalsBar, MemeScanner — previously each file had its own partial
// copy of this mapping with slightly different values.
export const TIER_COLOR: Record<string, string> = {
  ULTRA: C.yellow,
  HIGH: C.green,
  HOT: C.hot,
  CELEB: C.yellow,
};
