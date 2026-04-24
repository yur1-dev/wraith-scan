"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWraithTier } from "@/hooks/useWraithTier";
import { TIERS, TIER_ORDER, type TierKey } from "@/lib/tiers";

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};

const TIER_ACCENT: Record<TierKey, string> = {
  GHOST: "#8888aa",
  SHADE: "#00b4d8",
  SPECTER: "#a855f7",
  WRAITH: "#e8490f",
};

const TIER_GLYPH: Record<TierKey, string> = {
  GHOST: "◌",
  SHADE: "◈",
  SPECTER: "◆",
  WRAITH: "⬡",
};

const TIER_SUBTITLE: Record<TierKey, string> = {
  GHOST: "No tokens required",
  SHADE: "Hold 10,000 WRAITH",
  SPECTER: "Hold 100,000 WRAITH",
  WRAITH: "Hold 1,000,000 WRAITH",
};

const TIER_PITCH: Record<TierKey, string> = {
  GHOST: "Get a feel for the scanner before you commit.",
  SHADE: "Core trading tools unlocked for WRAITH holders.",
  SPECTER:
    "Full suite — AI scoring, sniper, no limits. Live signals at WRAITH.",
  WRAITH: "Maximum power. Zero fees. Live signals. For serious traders.",
};

// Single source of truth — same order used in cards AND matrix
const ALL_FEATURES: { id: string; label: string; desc: string }[] = [
  {
    id: "scanner_view",
    label: "View Scanner",
    desc: "Real-time meme token discovery",
  },
  {
    id: "sniper",
    label: "Sniper / Auto-buy",
    desc: "Automated entry on detected tokens",
  },
  {
    id: "auto_sell",
    label: "Auto TP / SL / Trail",
    desc: "Take profit, stop loss, trailing stop",
  },
  { id: "hot_wallet", label: "Hot Wallet", desc: "In-app trading wallet" },
  {
    id: "telegram_alerts",
    label: "Telegram Alerts",
    desc: "Instant push alerts via Telegram bot",
  },
  {
    id: "ai_score",
    label: "AI Score",
    desc: "Neural conviction scoring per token",
  },
  {
    id: "live_signals_view",
    label: "Live Signals",
    desc: "Real-time HIGH/ULTRA signal feed",
  },
];

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

// Patch: live_signals_view is WRAITH-only
function patchTier(key: TierKey) {
  if (key === "WRAITH") return TIERS[key];
  return {
    ...TIERS[key],
    features: TIERS[key].features.map((f) =>
      f.id === "live_signals_view" ? { ...f, unlocked: false } : f,
    ),
  };
}

const DISPLAY_TIERS = Object.fromEntries(
  TIER_ORDER.map((k) => [k, patchTier(k)]),
) as typeof TIERS;

export default function AccessPage() {
  const { tier: currentTier, rawBalance, loading } = useWraithTier();
  const [mounted, setMounted] = useState(false);
  const [hovered, setHovered] = useState<TierKey | null>(null);

  useEffect(() => setMounted(true), []);

  const activeTier = mounted && !loading ? currentTier.key : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#070707",
        color: "#e0e0e0",
        ...MONO,
        overflowX: "hidden",
      }}
    >
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes fadein  { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes flicker { 0%,89%,91%,93%,100%{opacity:1} 90%,92%{opacity:.6} }
        @keyframes ticker  { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes dotpulse{ 0%,100%{box-shadow:0 0 4px #00c47a55} 50%{box-shadow:0 0 12px #00c47a} }
        @keyframes scan    { 0%{top:-1px;opacity:0} 5%{opacity:1} 95%{opacity:1} 100%{top:100%;opacity:0} }

        .a1{animation:fadein .5s .00s cubic-bezier(.22,1,.36,1) both}
        .a2{animation:fadein .5s .08s cubic-bezier(.22,1,.36,1) both}
        .a3{animation:fadein .5s .16s cubic-bezier(.22,1,.36,1) both}
        .a4{animation:fadein .5s .24s cubic-bezier(.22,1,.36,1) both}
        .a5{animation:fadein .5s .32s cubic-bezier(.22,1,.36,1) both}

        .brand { animation: flicker 9s ease-in-out infinite; }

        .live-dot {
          width:5px;height:5px;border-radius:50%;background:#00c47a;
          display:inline-block;flex-shrink:0;
          animation:dotpulse 2s ease-in-out infinite;
        }

        .scan-line {
          position:absolute;left:0;right:0;height:1px;
          background:linear-gradient(to right,transparent,#e8490f18,transparent);
          animation:scan 7s ease-in-out infinite;pointer-events:none;
        }

        .nav-link {
          font-size:10px;letter-spacing:.18em;color:#888;
          text-decoration:none;font-weight:700;transition:color .15s;
        }
        .nav-link:hover { color:#e0e0e0; }

        .pc {
          background:#0d0d0d;
          border:1px solid #1e1e1e;
          border-radius:10px;
          display:flex;flex-direction:column;
          position:relative;overflow:hidden;
          transition:border-color .2s, transform .2s, box-shadow .2s;
        }
        .pc:hover { transform:translateY(-4px); border-color:#333; }
        .pc.pc-lit {
          border-color:var(--tc) !important;
          box-shadow:0 0 40px var(--tc-glow), 0 12px 40px #00000099;
          transform:translateY(-6px);
        }
        .pc-recommended { border-color:#a855f740; box-shadow:0 0 24px #a855f712; }

        .pc-bar { height:2px; background:var(--tc); opacity:.3; transition:opacity .2s; }
        .pc:hover .pc-bar, .pc.pc-lit .pc-bar { opacity:1; }

        .pc-ambient {
          position:absolute;inset:0;pointer-events:none;
          background:radial-gradient(ellipse at 50% -10%, var(--tc-soft) 0%, transparent 60%);
          opacity:0;transition:opacity .25s;
        }
        .pc:hover .pc-ambient, .pc.pc-lit .pc-ambient { opacity:1; }

        .fi {
          display:flex;align-items:center;gap:10px;
          padding:7px 0;border-bottom:1px solid #141414;
        }
        .fi:last-child { border-bottom:none; }

        .cta-filled {
          width:100%;padding:12px;border-radius:6px;border:none;
          font-size:10px;font-weight:900;letter-spacing:.16em;
          cursor:pointer;transition:opacity .15s, transform .1s;
          font-family:var(--font-mono),'IBM Plex Mono',monospace;
          background:var(--tc);color:#fff;
          box-shadow:0 0 24px var(--tc-glow);
          display:flex;align-items:center;justify-content:center;
          text-decoration:none;
        }
        .cta-filled:hover { opacity:.85; transform:translateY(-1px); }

        .cta-outline {
          width:100%;padding:12px;border-radius:6px;
          font-size:10px;font-weight:900;letter-spacing:.16em;
          cursor:pointer;transition:border-color .15s, color .15s, transform .1s;
          font-family:var(--font-mono),'IBM Plex Mono',monospace;
          background:transparent;color:#888;border:1px solid #222;
          text-decoration:none;display:flex;align-items:center;justify-content:center;
        }
        .cta-outline:hover { border-color:#555; color:#e0e0e0; transform:translateY(-1px); }

        .ticker-wrap { overflow:hidden; white-space:nowrap; }
        .ticker-inner { display:inline-flex; animation:ticker 36s linear infinite; }

        .mx-row {
          display:grid;grid-template-columns:1fr repeat(4,80px);
          align-items:center;padding:11px 0;
          border-bottom:1px solid #111;
          transition:background .15s;
        }
        .mx-row:hover { background:#0a0a0a; }
        .mx-row:last-child { border-bottom:none; }

        @media(max-width:960px){
          .pricing-grid { grid-template-columns:1fr 1fr !important; }
        }
        @media(max-width:600px){
          .pricing-grid { grid-template-columns:1fr !important; }
          .mx-hide { display:none; }
        }
      `}</style>

      {/* ── HEADER ── */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          height: 52,
          borderBottom: "1px solid #141414",
          background: "#070707ee",
          backdropFilter: "blur(14px)",
          display: "flex",
          alignItems: "center",
          padding: "0 40px",
          gap: 28,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <span
            className="brand"
            style={{
              color: "#e8490f",
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: ".34em",
            }}
          >
            WRAITH
          </span>
          <div className="live-dot" />
          <span
            style={{
              color: "#00c47a",
              fontSize: 8,
              letterSpacing: ".18em",
              fontWeight: 700,
            }}
          >
            LIVE
          </span>
        </div>
        <nav style={{ display: "flex", gap: 28 }}>
          <a href="#pricing" className="nav-link">
            PRICING
          </a>
          <a href="#features" className="nav-link">
            FEATURES
          </a>
          <a href="#fees" className="nav-link">
            FEES
          </a>
        </nav>
        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 10,
          }}
        >
          {mounted && !loading && activeTier && (
            <span
              style={{
                fontSize: 9,
                letterSpacing: ".12em",
                fontWeight: 700,
                color: TIER_ACCENT[activeTier],
                border: `1px solid ${TIER_ACCENT[activeTier]}44`,
                padding: "4px 10px",
                borderRadius: 3,
              }}
            >
              {activeTier}
              {rawBalance > 0 && (
                <span style={{ color: "#666", marginLeft: 7 }}>
                  {fmtTokens(rawBalance)}
                </span>
              )}
            </span>
          )}
          <Link
            href="/"
            style={{
              fontSize: 9,
              letterSpacing: ".16em",
              fontWeight: 700,
              color: "#888",
              textDecoration: "none",
              border: "1px solid #222",
              padding: "6px 14px",
              borderRadius: 3,
              transition: "all .15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#555";
              e.currentTarget.style.color = "#e0e0e0";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#222";
              e.currentTarget.style.color = "#888";
            }}
          >
            OPEN APP →
          </Link>
        </div>
      </header>

      {/* ── TICKER ── */}
      <div
        style={{
          borderBottom: "1px solid #111",
          height: 28,
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        <div className="ticker-wrap" style={{ flex: 1 }}>
          <div className="ticker-inner">
            {[0, 1].map((rep) => (
              <span key={rep} style={{ display: "inline-flex" }}>
                {[
                  "GHOST · FREE · 1.5% FEE",
                  "SHADE · 10K WRAITH · 1% FEE",
                  "SPECTER · 100K WRAITH · 0.5% FEE",
                  "WRAITH · 1M WRAITH · 0% FEE · LIVE SIGNALS",
                ].map((item, i) => (
                  <span
                    key={`${rep}-${i}`}
                    style={{
                      fontSize: 8,
                      letterSpacing: ".2em",
                      color: "#555",
                      padding: "0 44px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    {item} <span style={{ color: "#333" }}>·</span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── HERO ── */}
      <section
        style={{
          padding: "80px 40px 64px",
          maxWidth: 960,
          margin: "0 auto",
          position: "relative",
        }}
      >
        <div className="scan-line" />
        <div
          style={{
            position: "absolute",
            bottom: -80,
            left: -60,
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: "radial-gradient(circle,#e8490f0a 0%,transparent 65%)",
            pointerEvents: "none",
          }}
        />
        <div className="a1" style={{ marginBottom: 16 }}>
          <span
            style={{
              fontSize: 9,
              letterSpacing: ".3em",
              color: "#666",
              fontWeight: 700,
            }}
          >
            TOKEN-GATED ACCESS · SOLANA
          </span>
        </div>
        <h1
          className="a2"
          style={{
            fontSize: "clamp(34px,5vw,62px)",
            fontWeight: 900,
            letterSpacing: "-.01em",
            lineHeight: 1.06,
            color: "#f0f0f0",
            margin: "0 0 20px",
          }}
        >
          HOLD WRAITH.
          <br />
          <span style={{ color: "#e8490f" }}>UNLOCK</span> THE MACHINE.
        </h1>
        <p
          className="a3"
          style={{
            color: "#888",
            fontSize: 13,
            lineHeight: 1.9,
            maxWidth: 460,
            marginBottom: 36,
          }}
        >
          Four token-gated tiers. Your balance is auto-detected the moment you
          connect your wallet — features and fee discounts activate instantly.
        </p>
        <div
          className="a4"
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap" as const,
            marginBottom: 56,
          }}
        >
          <a
            href="https://pump.fun"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#e8490f",
              color: "#fff",
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: ".16em",
              padding: "11px 22px",
              borderRadius: 4,
              textDecoration: "none",
              boxShadow: "0 0 28px #e8490f44",
              transition: "all .15s",
              ...MONO,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#ff5c22";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#e8490f";
            }}
          >
            BUY WRAITH <span style={{ opacity: 0.6 }}>↗</span>
          </a>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "transparent",
              color: "#888",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: ".16em",
              padding: "11px 22px",
              borderRadius: 4,
              textDecoration: "none",
              border: "1px solid #222",
              transition: "all .15s",
              ...MONO,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#555";
              e.currentTarget.style.color = "#e0e0e0";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#222";
              e.currentTarget.style.color = "#888";
            }}
          >
            OPEN APP →
          </Link>
        </div>
        <div
          className="a5"
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap" as const,
          }}
        >
          {[
            { l: "SUPPLY", v: "1B" },
            { l: "CHAIN", v: "SOL" },
            { l: "MAX FEE", v: "1.5%" },
            { l: "MIN FEE", v: "0%" },
          ].map((s, i) => (
            <div key={s.l} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ padding: i === 0 ? "0 36px 0 0" : "0 36px" }}>
                <div
                  style={{
                    fontSize: "clamp(22px,3vw,30px)",
                    fontWeight: 900,
                    color: "#f0f0f0",
                    letterSpacing: "-.02em",
                  }}
                >
                  {s.v}
                </div>
                <div
                  style={{
                    fontSize: 8,
                    color: "#555",
                    letterSpacing: ".24em",
                    marginTop: 4,
                    fontWeight: 700,
                  }}
                >
                  {s.l}
                </div>
              </div>
              {i < 3 && (
                <div
                  style={{
                    width: 1,
                    height: 28,
                    background: "#1a1a1a",
                    flexShrink: 0,
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── PRICING CARDS ── */}
      <section
        id="pricing"
        style={{ borderTop: "1px solid #111", padding: "72px 40px 80px" }}
      >
        <div style={{ maxWidth: 1080, margin: "0 auto" }}>
          <div style={{ textAlign: "center" as const, marginBottom: 52 }}>
            <div
              style={{
                fontSize: 9,
                color: "#666",
                letterSpacing: ".3em",
                fontWeight: 700,
                marginBottom: 14,
              }}
            >
              PRICING
            </div>
            <h2
              style={{
                fontSize: "clamp(22px,3vw,36px)" as const,
                fontWeight: 900,
                color: "#f0f0f0",
                letterSpacing: ".02em",
                marginBottom: 12,
              }}
            >
              FOUR TIERS. ONE TOKEN.
            </h2>
            <p
              style={{
                color: "#777",
                fontSize: 12,
                lineHeight: 1.8,
                maxWidth: 420,
                margin: "0 auto",
              }}
            >
              Hold WRAITH in your wallet. Your tier is detected automatically.
              No staking, no locking — just hold and trade.
            </p>
          </div>

          <div
            className="pricing-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 14,
            }}
          >
            {TIER_ORDER.map((key) => {
              const t = DISPLAY_TIERS[key];
              const tc = TIER_ACCENT[key];
              const isActive = activeTier === key;
              const lit = isActive || hovered === key;
              const isRecommended = key === "SPECTER";

              return (
                <div
                  key={key}
                  className={`pc${lit ? " pc-lit" : ""}${isRecommended && !lit ? " pc-recommended" : ""}`}
                  style={
                    {
                      "--tc": tc,
                      "--tc-glow": `${tc}44`,
                      "--tc-soft": `${tc}0e`,
                    } as React.CSSProperties
                  }
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div className="pc-bar" />
                  <div className="pc-ambient" />

                  <div
                    style={{
                      padding: "24px 20px 20px",
                      position: "relative",
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    {(isRecommended || isActive) && (
                      <div
                        style={{
                          position: "absolute",
                          top: 16,
                          right: 16,
                          fontSize: 7,
                          fontWeight: 900,
                          letterSpacing: ".12em",
                          color: isActive ? tc : "#a855f7",
                          background: isActive ? `${tc}18` : "#a855f714",
                          border: `1px solid ${isActive ? tc + "44" : "#a855f740"}`,
                          padding: "3px 8px",
                          borderRadius: 2,
                        }}
                      >
                        {isActive ? "YOUR TIER" : "POPULAR"}
                      </div>
                    )}

                    {/* Tier name row */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 18,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 26,
                          lineHeight: 1,
                          color: lit ? tc : "#555",
                          transition: "color .2s",
                        }}
                      >
                        {TIER_GLYPH[key]}
                      </span>
                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 900,
                            letterSpacing: ".16em",
                            color: lit ? tc : "#c0c0c0",
                            transition: "color .2s",
                          }}
                        >
                          {key}
                        </div>
                        <div
                          style={{
                            fontSize: 9,
                            color: "#777",
                            marginTop: 2,
                            letterSpacing: ".04em",
                          }}
                        >
                          {TIER_SUBTITLE[key]}
                        </div>
                      </div>
                    </div>

                    {/* Price + pitch */}
                    <div style={{ marginBottom: 18 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 38,
                            fontWeight: 900,
                            letterSpacing: "-.02em",
                            lineHeight: 1,
                            color:
                              t.feeBps === 0 ? "#00c47a" : lit ? tc : "#e0e0e0",
                            transition: "color .2s",
                          }}
                        >
                          {t.feeBps === 0
                            ? "0%"
                            : `${(t.feeBps / 100).toFixed(1)}%`}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            color: "#777",
                            letterSpacing: ".1em",
                          }}
                        >
                          / TRADE
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#888",
                          marginTop: 8,
                          lineHeight: 1.7,
                          minHeight: 54,
                        }}
                      >
                        {TIER_PITCH[key]}
                      </div>
                    </div>

                    <div
                      style={{
                        height: 1,
                        background: lit ? `${tc}28` : "#191919",
                        marginBottom: 16,
                        transition: "background .2s",
                      }}
                    />

                    {/* Features — single ordered list, identical across all cards */}
                    <div style={{ flex: 1, marginBottom: 20 }}>
                      {ALL_FEATURES.map((f) => {
                        const has =
                          t.features.find((x) => x.id === f.id)?.unlocked ??
                          false;
                        return (
                          <div key={f.id} className="fi">
                            <span
                              style={{
                                fontSize: 11,
                                color: has ? (lit ? tc : "#00c47a") : "#2a2a2a",
                                fontWeight: 900,
                                flexShrink: 0,
                                width: 12,
                                textAlign: "center" as const,
                              }}
                            >
                              {has ? "✓" : "—"}
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                color: has ? "#c0c0c0" : "#484848",
                                letterSpacing: ".04em",
                                textDecoration: has ? "none" : "line-through",
                              }}
                            >
                              {f.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* CTA */}
                  <div style={{ padding: "0 20px 20px", position: "relative" }}>
                    {(() => {
                      const rank = {
                        GHOST: 0,
                        SHADE: 1,
                        SPECTER: 2,
                        WRAITH: 3,
                      };
                      const userRank = activeTier ? rank[activeTier] : 0;
                      const isAtOrBelow = rank[key] <= userRank;
                      return isAtOrBelow ? (
                        <Link
                          href="/"
                          className={isActive ? "cta-filled" : "cta-outline"}
                          style={
                            isActive
                              ? ({
                                  "--tc": tc,
                                  "--tc-glow": `${tc}44`,
                                } as React.CSSProperties)
                              : undefined
                          }
                        >
                          OPEN APP →
                        </Link>
                      ) : (
                        <a
                          href="https://pump.fun"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="cta-filled"
                          style={
                            {
                              "--tc": tc,
                              "--tc-glow": `${tc}44`,
                            } as React.CSSProperties
                          }
                        >
                          BUY WRAITH ↗
                        </a>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── FEATURE MATRIX ── */}
      <section
        id="features"
        style={{ borderTop: "1px solid #111", padding: "72px 40px 80px" }}
      >
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ marginBottom: 40 }}>
            <div
              style={{
                fontSize: 9,
                color: "#666",
                letterSpacing: ".3em",
                fontWeight: 700,
                marginBottom: 12,
              }}
            >
              COMPARISON
            </div>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: "#f0f0f0",
                letterSpacing: ".04em",
              }}
            >
              FULL FEATURE BREAKDOWN
            </h2>
          </div>

          {/* Header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr repeat(4,80px)",
              padding: "0 0 12px",
              borderBottom: "1px solid #1a1a1a",
            }}
          >
            <span
              style={{
                fontSize: 9,
                color: "#666",
                letterSpacing: ".2em",
                fontWeight: 700,
              }}
            >
              FEATURE
            </span>
            {TIER_ORDER.map((key) => (
              <span
                key={key}
                style={{
                  fontSize: 9,
                  letterSpacing: ".14em",
                  fontWeight: 900,
                  textAlign: "center" as const,
                  color: activeTier === key ? TIER_ACCENT[key] : "#888",
                }}
              >
                {key}
              </span>
            ))}
          </div>

          {/* Same ALL_FEATURES order as cards */}
          {ALL_FEATURES.map((f) => (
            <div key={f.id} className="mx-row">
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#c0c0c0",
                    letterSpacing: ".04em",
                    marginBottom: 3,
                  }}
                >
                  {f.label}
                </div>
                <div
                  style={{ fontSize: 9, color: "#666", letterSpacing: ".04em" }}
                >
                  {f.desc}
                </div>
              </div>
              {TIER_ORDER.map((key) => {
                const has =
                  DISPLAY_TIERS[key].features.find((x) => x.id === f.id)
                    ?.unlocked ?? false;
                const tc = TIER_ACCENT[key];
                return (
                  <div
                    key={key}
                    style={{ display: "flex", justifyContent: "center" }}
                  >
                    {has ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 900,
                          color: tc,
                          background: `${tc}16`,
                          border: `1px solid ${tc}30`,
                          padding: "3px 8px",
                          borderRadius: 3,
                        }}
                      >
                        ✓
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 14,
                          color: "#2a2a2a",
                          fontWeight: 700,
                        }}
                      >
                        —
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* ── FEES ── */}
      <section
        id="fees"
        style={{ borderTop: "1px solid #111", padding: "72px 40px 80px" }}
      >
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <div style={{ marginBottom: 40 }}>
            <div
              style={{
                fontSize: 9,
                color: "#666",
                letterSpacing: ".3em",
                fontWeight: 700,
                marginBottom: 12,
              }}
            >
              ECONOMICS
            </div>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: "#f0f0f0",
                letterSpacing: ".04em",
                marginBottom: 10,
              }}
            >
              REAL COST ON A $1,000 TRADE
            </h2>
            <p style={{ color: "#888", fontSize: 12, lineHeight: 1.8 }}>
              Every trade above GHOST tier pays less. Hit WRAITH and pay
              nothing.
            </p>
          </div>

          <div style={{ borderTop: "1px solid #141414" }}>
            {TIER_ORDER.map((key) => {
              const t = TIERS[key];
              const fee = (1000 * t.feeBps) / 10000;
              const tc = TIER_ACCENT[key];
              const isActive = activeTier === key;
              const pct = t.feeBps === 0 ? 0 : (t.feeBps / 150) * 100;

              return (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "18px 16px",
                    borderBottom: "1px solid #0e0e0e",
                    background: isActive ? `${tc}08` : "transparent",
                    borderRadius: isActive ? 4 : 0,
                    transition: "background .2s",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 900,
                      letterSpacing: ".14em",
                      color: isActive ? tc : "#888",
                      width: 76,
                      flexShrink: 0,
                    }}
                  >
                    {key}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 2,
                      background: "#141414",
                      borderRadius: 1,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        borderRadius: 1,
                        width: t.feeBps === 0 ? "2px" : `${pct}%`,
                        background: t.feeBps === 0 ? "#00c47a" : tc,
                        opacity: isActive ? 1 : 0.4,
                        transition: "width .3s",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      textAlign: "right" as const,
                      flexShrink: 0,
                      minWidth: 80,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 900,
                        color:
                          t.feeBps === 0
                            ? "#00c47a"
                            : isActive
                              ? tc
                              : "#c0c0c0",
                      }}
                    >
                      {t.feeBps === 0 ? "FREE" : `-$${fee.toFixed(2)}`}
                    </span>
                    {isActive && (
                      <div
                        style={{
                          fontSize: 8,
                          color: "#666",
                          letterSpacing: ".1em",
                          marginTop: 2,
                        }}
                      >
                        YOUR TIER
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              marginTop: 24,
              padding: "18px 20px",
              background: "#0a0a0a",
              border: "1px solid #1a1a1a",
              borderRadius: 6,
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: "#666",
                letterSpacing: ".2em",
                fontWeight: 700,
                marginBottom: 10,
              }}
            >
              EXAMPLE
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 11, color: "#888" }}>
                $10,000 trade at GHOST tier
              </span>
              <span style={{ fontSize: 14, fontWeight: 900, color: "#e8490f" }}>
                -$15.00
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 11, color: "#888" }}>
                $10,000 trade at WRAITH tier
              </span>
              <span style={{ fontSize: 14, fontWeight: 900, color: "#00c47a" }}>
                FREE
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section
        style={{ borderTop: "1px solid #111", padding: "72px 40px 80px" }}
      >
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ textAlign: "center" as const, marginBottom: 52 }}>
            <div
              style={{
                fontSize: 9,
                color: "#666",
                letterSpacing: ".3em",
                fontWeight: 700,
                marginBottom: 12,
              }}
            >
              PROCESS
            </div>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: "#f0f0f0",
                letterSpacing: ".04em",
              }}
            >
              GET STARTED IN 4 STEPS
            </h2>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 2,
            }}
          >
            {[
              {
                n: "01",
                title: "BUY WRAITH",
                desc: "Get WRAITH on Pump.fun. Any amount moves you above GHOST tier.",
                color: "#e8490f",
              },
              {
                n: "02",
                title: "SIGN IN",
                desc: "Log in with Google to access the full platform.",
                color: "#a855f7",
              },
              {
                n: "03",
                title: "CONNECT WALLET",
                desc: "Link the Solana wallet holding WRAITH — tier auto-detected instantly.",
                color: "#00b4d8",
              },
              {
                n: "04",
                title: "START TRADING",
                desc: "Scanner, AI signals, sniper — all unlocked based on your tier.",
                color: "#00c47a",
              },
            ].map((s, i) => (
              <div
                key={s.n}
                style={{
                  padding: "28px 22px",
                  background: "#0a0a0a",
                  border: "1px solid #141414",
                  borderRadius: 6,
                  borderLeft: i > 0 ? "none" : undefined,
                  borderTopLeftRadius: i > 0 ? 0 : 6,
                  borderBottomLeftRadius: i > 0 ? 0 : 6,
                  borderTopRightRadius: i < 3 ? 0 : 6,
                  borderBottomRightRadius: i < 3 ? 0 : 6,
                }}
              >
                <div
                  style={{
                    fontSize: 32,
                    fontWeight: 900,
                    color: "#1e1e1e",
                    marginBottom: 20,
                    letterSpacing: "-.02em",
                  }}
                >
                  {s.n}
                </div>
                <div
                  style={{
                    width: 20,
                    height: 2,
                    background: s.color,
                    marginBottom: 16,
                    borderRadius: 1,
                  }}
                />
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 900,
                    letterSpacing: ".14em",
                    color: "#c0c0c0",
                    marginBottom: 10,
                  }}
                >
                  {s.title}
                </div>
                <div style={{ fontSize: 11, color: "#888", lineHeight: 1.85 }}>
                  {s.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER CTA ── */}
      <section
        style={{
          borderTop: "1px solid #111",
          padding: "80px 40px",
          textAlign: "center" as const,
        }}
      >
        <div
          style={{
            fontSize: "clamp(28px,4vw,52px)" as const,
            fontWeight: 900,
            letterSpacing: ".04em",
            color: "#f0f0f0",
            marginBottom: 14,
            lineHeight: 1.1,
          }}
        >
          READY TO
          <br />
          <span style={{ color: "#e8490f" }}>SNIPE?</span>
        </div>
        <p
          style={{
            color: "#777",
            fontSize: 11,
            marginBottom: 36,
            letterSpacing: ".1em",
          }}
        >
          GET WRAITH · CONNECT · TRADE
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap" as const,
          }}
        >
          <a
            href="https://pump.fun"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#e8490f",
              color: "#fff",
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: ".16em",
              padding: "12px 24px",
              borderRadius: 4,
              textDecoration: "none",
              boxShadow: "0 0 30px #e8490f44",
              transition: "all .15s",
              ...MONO,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#ff5c22";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#e8490f";
            }}
          >
            BUY WRAITH ↗
          </a>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "transparent",
              color: "#888",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: ".16em",
              padding: "12px 24px",
              borderRadius: 4,
              textDecoration: "none",
              border: "1px solid #222",
              transition: "all .15s",
              ...MONO,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#555";
              e.currentTarget.style.color = "#e0e0e0";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#222";
              e.currentTarget.style.color = "#888";
            }}
          >
            OPEN APP →
          </Link>
        </div>
        <div
          style={{
            marginTop: 60,
            color: "#444",
            fontSize: 8,
            letterSpacing: ".22em",
          }}
        >
          WRAITH © {new Date().getFullYear()} · SOLANA · NOT FINANCIAL ADVICE
        </div>
      </section>
    </div>
  );
}
