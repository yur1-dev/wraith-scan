"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { TIERS, TIER_ORDER, type TierKey } from "@/lib/tiers";
import { useWraithTier } from "@/hooks/useWraithTier";

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};

const ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: "Failed to start Google sign-in.",
  OAuthCallback: "Google sign-in was cancelled or failed.",
  OAuthCreateAccount: "Could not create your account. Try again.",
  EmailCreateAccount: "Could not create your account. Try again.",
  Callback: "Sign-in callback error. Try again.",
  OAuthAccountNotLinked: "This email is linked to a different provider.",
  default: "Sign-in failed. Please try again.",
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

const TIER_REQ: Record<TierKey, string> = {
  GHOST: "Free — no tokens",
  SHADE: "10,000 WRAITH",
  SPECTER: "100,000 WRAITH",
  WRAITH: "1,000,000 WRAITH",
};

const TIER_TAGLINE: Record<TierKey, string> = {
  GHOST: "Scanner access only",
  SHADE: "Sniper + trading tools",
  SPECTER: "AI scoring + full suite",
  WRAITH: "Zero fees. Live signals.",
};

// Fixed 3 chips per tier so all cards have equal height
const TIER_CHIPS: Record<TierKey, string[]> = {
  GHOST: ["View Scanner", "—", "—"],
  SHADE: ["View Scanner", "Sniper / Auto-buy", "Hot Wallet"],
  SPECTER: ["Sniper / Auto-buy", "AI Score", "Telegram Alerts"],
  WRAITH: ["AI Score", "Live Signals", "0% Fee"],
};

function GoogleIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 48 48"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.14 0 5.95 1.08 8.17 2.86l6.09-6.09C34.46 3.04 29.53 1 24 1 14.82 1 7.07 6.48 3.64 14.22l7.1 5.52C12.48 13.48 17.77 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.52 24.5c0-1.64-.15-3.22-.43-4.74H24v8.98h12.67c-.55 2.9-2.2 5.36-4.68 7.01l7.18 5.58C43.36 37.28 46.52 31.36 46.52 24.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.74 28.26A14.5 14.5 0 0 1 9.5 24c0-1.49.26-2.93.72-4.27l-7.1-5.52A23.93 23.93 0 0 0 0 24c0 3.86.92 7.5 2.54 10.72l8.2-6.46z"
      />
      <path
        fill="#34A853"
        d="M24 47c5.52 0 10.16-1.83 13.54-4.96l-7.18-5.58c-1.83 1.23-4.18 1.96-6.36 1.96-6.22 0-11.5-3.98-13.26-9.5l-8.2 6.46C7.07 41.52 14.82 47 24 47z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

export default function LoginPage() {
  const { data: session, status } = useSession();
  const { tier: currentTier, loading: tierLoading } = useWraithTier();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [hoveredTier, setHoveredTier] = useState<TierKey | null>(null);
  const [mounted, setMounted] = useState(false);

  const errorCode = searchParams.get("error") ?? "";
  const errorMsg = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.default)
    : null;

  useEffect(() => {
    setMounted(true);
    if (session) router.push("/");
  }, [session, router]);

  if (status === "loading") return null;
  if (session) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#080808",
        display: "flex",
        flexDirection: "column",
        ...MONO,
        position: "relative",
        overflowX: "hidden",
        maxWidth: "100vw",
      }}
    >
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 5px #00c47a88; }
          50%       { box-shadow: 0 0 12px #00c47a; }
        }
        @keyframes scan {
          0%   { top: -1px; opacity: 0; }
          5%   { opacity: 1; }
          95%  { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes flicker {
          0%,89%,91%,93%,100% { opacity: 1; }
          90%,92% { opacity: 0.65; }
        }

        .panel-l { animation: fade-in .5s cubic-bezier(.22,1,.36,1) both; }
        .panel-r { animation: fade-in .5s .08s cubic-bezier(.22,1,.36,1) both; }

        .tier-card {
          padding: 14px 16px;
          border: 1px solid #161616;
          border-radius: 6px;
          position: relative;
          transition: border-color .18s, background .18s;
          overflow: hidden;
          cursor: default;
        }
        .tier-card:hover { border-color: var(--tc); background: var(--bg); }
        .tier-card.active-card { border-color: var(--tc) !important; background: var(--bg); }

        .tier-glow {
          position: absolute; inset: 0; pointer-events: none;
          background: var(--glow);
          opacity: 0; transition: opacity .2s;
        }
        .tier-card:hover .tier-glow,
        .tier-card.active-card .tier-glow { opacity: 1; }

        .feat-chip {
          display: inline-flex; align-items: center;
          padding: 3px 8px; border-radius: 2px;
          font-size: 8px; font-weight: 700; letter-spacing: .06em;
          transition: all .18s; white-space: nowrap;
        }

        .sign-btn {
          width: 100%; background: #e8490f; border: none;
          color: #fff; font-size: 11px; font-weight: 800;
          letter-spacing: .12em; padding: 13px 20px; border-radius: 4px;
          cursor: pointer; display: flex; align-items: center;
          justify-content: center; gap: 9px;
          transition: background .15s, box-shadow .15s, transform .1s;
          font-family: var(--font-mono), 'IBM Plex Mono', monospace;
          box-shadow: 0 0 24px #e8490f44, 0 2px 6px #0008;
        }
        .sign-btn:hover:not(:disabled) {
          background: #ff5c22;
          box-shadow: 0 0 36px #e8490f66, 0 4px 12px #0008;
          transform: translateY(-1px);
        }
        .sign-btn:disabled { background: #181818; color: #444; cursor: not-allowed; box-shadow: none; }

        .step-row {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 10px 0; border-bottom: 1px solid #0f0f0f;
        }
        .step-row:last-child { border-bottom: none; }

        .live-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: #00c47a; flex-shrink: 0;
          animation: pulse-glow 2s ease-in-out infinite;
          display: inline-block;
        }

        .scan-line {
          position: absolute; left: 0; right: 0; height: 1px;
          background: linear-gradient(to right, transparent, #e8490f18, transparent);
          animation: scan 6s ease-in-out infinite; pointer-events: none;
        }

        .brand { animation: flicker 9s ease-in-out infinite; }

        /* ── Responsive layout ── */
        .login-wrap {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
        }

        .panel-l {
          padding: 28px 24px 24px;
          border-bottom: 1px solid #111;
          background: linear-gradient(160deg, #0a0808 0%, #080808 100%);
          position: relative;
          overflow: hidden;
          min-width: 0;
        }

        .panel-r {
          padding: 32px 24px 40px;
          background: #080808;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          min-width: 0;
        }

        .chips-row {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
        }

        @media (min-width: 720px) {
          .login-wrap {
            flex-direction: row;
          }
          .panel-l {
            width: 50%;
            min-width: 0;
            border-bottom: none;
            border-right: 1px solid #111;
            padding: 36px 40px;
            display: flex;
            flex-direction: column;
          }
          .panel-r {
            width: 50%;
            min-width: 0;
            padding: 36px 56px;
          }
        }
      `}</style>

      <div className="login-wrap">
        {/* ── LEFT — Tier showcase ── */}
        <div className="panel-l">
          <div className="scan-line" />

          {/* ambient glow */}
          <div
            style={{
              position: "absolute",
              bottom: -100,
              left: -80,
              width: 400,
              height: 400,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, #e8490f07 0%, transparent 65%)",
              pointerEvents: "none",
            }}
          />

          {/* Wordmark */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 24,
            }}
          >
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
              style={{ color: "#00c47a", fontSize: 8, letterSpacing: ".18em" }}
            >
              LIVE
            </span>
          </div>

          {/* Headline */}
          <div style={{ marginBottom: 20 }}>
            <h2
              style={{
                color: "#eaeaea",
                fontSize: 22,
                fontWeight: 900,
                letterSpacing: ".02em",
                lineHeight: 1.2,
                marginBottom: 8,
              }}
            >
              HOLD WRAITH.
              <br />
              <span style={{ color: "#e8490f" }}>UNLOCK</span> THE MACHINE.
            </h2>
            <p style={{ color: "#555", fontSize: 11, lineHeight: 1.75 }}>
              Four token-gated tiers. Balance auto-detected on wallet connect.
            </p>
          </div>

          {/* Tier cards */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              flex: 1,
            }}
          >
            {TIER_ORDER.map((key) => {
              const t = TIERS[key];
              const tc = TIER_ACCENT[key];
              const isActive =
                mounted && !tierLoading && currentTier.key === key;
              const isHovered = hoveredTier === key;
              const lit = isActive || isHovered;
              const chips = TIER_CHIPS[key];

              return (
                <div
                  key={key}
                  className={`tier-card${isActive ? " active-card" : ""}`}
                  style={
                    {
                      "--tc": tc,
                      "--bg": `${tc}09`,
                      "--glow": `radial-gradient(ellipse at 0% 50%, ${tc}12 0%, transparent 70%)`,
                    } as React.CSSProperties
                  }
                  onMouseEnter={() => setHoveredTier(key)}
                  onMouseLeave={() => setHoveredTier(null)}
                >
                  <div className="tier-glow" />

                  {/* Top row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 10,
                      position: "relative",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 9 }}
                    >
                      <span
                        style={{
                          fontSize: 18,
                          color: lit ? tc : "#252525",
                          transition: "color .18s",
                          lineHeight: 1,
                        }}
                      >
                        {TIER_GLYPH[key]}
                      </span>
                      <div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 900,
                              letterSpacing: ".14em",
                              color: lit ? tc : "#b0b0b0",
                              transition: "color .18s",
                            }}
                          >
                            {key}
                          </span>
                          {isActive && (
                            <span
                              style={{
                                fontSize: 7,
                                color: tc,
                                border: `1px solid ${tc}50`,
                                padding: "1px 5px",
                                borderRadius: 2,
                                letterSpacing: ".1em",
                                background: `${tc}18`,
                              }}
                            >
                              YOU
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            color: "#484848",
                            fontSize: 9,
                            letterSpacing: ".03em",
                            marginTop: 1,
                          }}
                        >
                          {TIER_TAGLINE[key]}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: "right" as const }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 900,
                          color:
                            t.feeBps === 0 ? "#00c47a" : lit ? tc : "#2e2e2e",
                          transition: "color .18s",
                        }}
                      >
                        {t.feeBps === 0
                          ? "0% FEE"
                          : `${(t.feeBps / 100).toFixed(1)}% FEE`}
                      </div>
                      <div
                        style={{ color: "#303030", fontSize: 8, marginTop: 1 }}
                      >
                        {TIER_REQ[key]}
                      </div>
                    </div>
                  </div>

                  {/* Chips — wrap on mobile */}
                  <div className="chips-row">
                    {chips.map((label, i) => (
                      <span
                        key={i}
                        className="feat-chip"
                        style={{
                          background:
                            label === "—"
                              ? "transparent"
                              : lit
                                ? `${tc}16`
                                : "#111",
                          color:
                            label === "—"
                              ? "transparent"
                              : lit
                                ? tc
                                : "#383838",
                          border: `1px solid ${label === "—" ? "transparent" : lit ? tc + "28" : "#191919"}`,
                          visibility: label === "—" ? "hidden" : "visible",
                        }}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Buy CTA */}
          <div
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: "1px solid #111",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ color: "#333", fontSize: 9, letterSpacing: ".1em" }}>
              UPGRADE ON PUMP.FUN
            </span>
            <a
              href="https://pump.fun"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#e8490f",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".12em",
                textDecoration: "none",
                border: "1px solid #e8490f28",
                padding: "7px 14px",
                borderRadius: 3,
                transition: "all .15s",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                ...MONO,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#e8490f12";
                e.currentTarget.style.borderColor = "#e8490f55";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "#e8490f28";
              }}
            >
              BUY WRAITH <span style={{ opacity: 0.5 }}>↗</span>
            </a>
          </div>
        </div>

        {/* ── RIGHT — Sign in panel ── */}
        <div className="panel-r">
          {/* ambient */}
          <div
            style={{
              position: "absolute",
              top: -80,
              right: -80,
              width: 320,
              height: 320,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, #e8490f0a 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />

          <div style={{ width: "100%", maxWidth: 360 }}>
            {/* Mini brand */}
            <div style={{ textAlign: "center" as const, marginBottom: 36 }}>
              <div
                style={{
                  color: "#e8490f",
                  fontSize: 10,
                  fontWeight: 900,
                  letterSpacing: ".36em",
                  marginBottom: 5,
                }}
              >
                WRAITH
              </div>
              <div
                style={{ color: "#222", fontSize: 8, letterSpacing: ".22em" }}
              >
                MEME TOKEN SNIPER · SOLANA
              </div>
            </div>

            {/* Headline */}
            <div style={{ marginBottom: 24 }}>
              <h1
                style={{
                  color: "#e8e8e8",
                  fontSize: 22,
                  fontWeight: 900,
                  letterSpacing: ".04em",
                  lineHeight: 1.2,
                  marginBottom: 10,
                }}
              >
                SIGN IN TO ACCESS
              </h1>
              <p style={{ color: "#525252", fontSize: 11, lineHeight: 1.8 }}>
                Connect your Google account, then link your Solana wallet — your
                WRAITH balance auto-detects your tier instantly.
              </p>
            </div>

            {/* Error */}
            {errorMsg && (
              <div
                style={{
                  background: "#120500",
                  border: "1px solid #e8490f30",
                  borderRadius: 4,
                  padding: "10px 14px",
                  color: "#ff6b35",
                  fontSize: 10,
                  lineHeight: 1.7,
                  marginBottom: 20,
                }}
              >
                {errorMsg}
              </div>
            )}

            {/* Step 01 label */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 3,
                  border: "1px solid #e8490f33",
                  background: "#e8490f10",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: "#e8490f",
                  fontSize: 8,
                  fontWeight: 900,
                  letterSpacing: ".06em",
                }}
              >
                01
              </div>
              <span
                style={{
                  color: "#c0c0c0",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: ".1em",
                }}
              >
                SIGN IN WITH GOOGLE
              </span>
            </div>

            {/* Google button */}
            <button
              className="sign-btn"
              onClick={async () => {
                setLoading(true);
                await signIn("google", { callbackUrl: "/" });
                setLoading(false);
              }}
              disabled={loading}
            >
              {loading ? (
                "REDIRECTING..."
              ) : (
                <>
                  <GoogleIcon />
                  CONTINUE WITH GOOGLE
                </>
              )}
            </button>

            {/* Divider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                margin: "22px 0",
              }}
            >
              <div style={{ flex: 1, height: 1, background: "#111" }} />
              <span
                style={{
                  color: "#242424",
                  fontSize: 8,
                  letterSpacing: ".24em",
                }}
              >
                THEN
              </span>
              <div style={{ flex: 1, height: 1, background: "#111" }} />
            </div>

            {/* Steps 02–04 */}
            <div style={{ marginBottom: 28 }}>
              {[
                {
                  n: "02",
                  title: "CONNECT WALLET",
                  desc: "Link the Solana wallet holding your WRAITH tokens.",
                  color: "#a855f7",
                },
                {
                  n: "03",
                  title: "TIER AUTO-DETECTED",
                  desc: "Features and fee discounts activate in real time.",
                  color: "#00b4d8",
                },
                {
                  n: "04",
                  title: "START SNIPING",
                  desc: "Scanner, AI signals, sniper — all tier-gated.",
                  color: "#00c47a",
                },
              ].map((s) => (
                <div key={s.n} className="step-row">
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 3,
                      border: `1px solid ${s.color}33`,
                      background: `${s.color}10`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      color: s.color,
                      fontSize: 8,
                      fontWeight: 900,
                      letterSpacing: ".06em",
                    }}
                  >
                    {s.n}
                  </div>
                  <div>
                    <div
                      style={{
                        color: "#c0c0c0",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: ".1em",
                        marginBottom: 3,
                      }}
                    >
                      {s.title}
                    </div>
                    <div
                      style={{
                        color: "#4a4a4a",
                        fontSize: 10,
                        lineHeight: 1.7,
                      }}
                    >
                      {s.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div
              style={{
                paddingTop: 18,
                borderTop: "1px solid #0e0e0e",
                color: "#1e1e1e",
                fontSize: 8,
                letterSpacing: ".16em",
                lineHeight: 2.2,
                textAlign: "center" as const,
              }}
            >
              DATA SYNCS ACROSS DEVICES · NOTHING STORED IN BROWSER
              <br />
              WRAITH © {new Date().getFullYear()} · NOT FINANCIAL ADVICE
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
