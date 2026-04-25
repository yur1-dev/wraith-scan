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

const TIER_IMAGE: Record<TierKey, string> = {
  GHOST: "/ghost.png",
  SHADE: "/shade.png",
  SPECTER: "/specter.png",
  WRAITH: "/tier-wraith.png",
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
  SPECTER: "Full suite — AI scoring, sniper, no limits.",
  WRAITH: "Maximum power. Zero fees. Live signals.",
};

const ALL_FEATURES: { id: string; label: string }[] = [
  { id: "scanner_view", label: "View Scanner" },
  { id: "sniper", label: "Sniper / Auto-buy" },
  { id: "auto_sell", label: "Auto TP / SL / Trail" },
  { id: "hot_wallet", label: "Hot Wallet" },
  { id: "telegram_alerts", label: "Telegram Alerts" },
  { id: "ai_score", label: "AI Score" },
  { id: "live_signals_view", label: "Live Signals" },
];

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

function GhostIcon({ tier, lit }: { tier: TierKey; lit: boolean }) {
  return (
    <img
      src={TIER_IMAGE[tier]}
      alt={tier}
      width={32}
      height={32}
      style={{
        objectFit: "contain",
        flexShrink: 0,
        opacity: lit ? 1 : 0.45,
        transition: "opacity .2s",
      }}
    />
  );
}

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
  const [hovered, setHovered] = useState<TierKey | null>(null);
  const [mounted, setMounted] = useState(false);
  const [buyHovered, setBuyHovered] = useState(false);

  const errorCode = searchParams.get("error") ?? "";
  const errorMsg = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.default)
    : null;

  useEffect(() => {
    setMounted(true);
    if (session) router.push("/app");
  }, [session, router]);

  if (status === "loading") return null;
  if (session) return null;

  const activeTier = mounted && !tierLoading ? currentTier.key : null;

  return (
    <div
      style={{
        height: "100vh",
        maxHeight: "100vh",
        overflow: "hidden",
        background: "#080808",
        display: "flex",
        flexDirection: "row",
        ...MONO,
      }}
    >
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { overflow: hidden !important; height: 100%; }

        @keyframes dotpulse { 0%,100%{box-shadow:0 0 4px #00c47a55} 50%{box-shadow:0 0 12px #00c47a} }
        @keyframes scan { 0%{top:-1px;opacity:0} 5%{opacity:1} 95%{opacity:1} 100%{top:100%;opacity:0} }
        @keyframes flicker { 0%,89%,91%,93%,100%{opacity:1} 90%,92%{opacity:.65} }

        .brand { animation: flicker 9s ease-in-out infinite; }
        .live-dot {
          width:5px;height:5px;border-radius:50%;background:#00c47a;
          flex-shrink:0;animation:dotpulse 2s ease-in-out infinite;display:inline-block;
        }
        .scan-line {
          position:absolute;left:0;right:0;height:1px;
          background:linear-gradient(to right,transparent,#e8490f18,transparent);
          animation:scan 6s ease-in-out infinite;pointer-events:none;
        }

        .pc {
          background:#0d0d0d;
          border:1px solid #1e1e1e;
          border-radius:6px;
          position:relative;
          overflow:hidden;
          transition:border-color .2s, box-shadow .2s;
          cursor:default;
          display:flex;
          flex-direction:column;
          flex:1;
          min-height:0;
        }
        .pc:hover { border-color:#333; }
        .pc.pc-lit {
          border-color:var(--tc) !important;
          box-shadow:0 0 20px var(--tc-glow);
        }
        .pc.pc-recommended { border-color:#a855f740; }
        .pc-bar { height:2px;background:var(--tc);opacity:.3;transition:opacity .2s;flex-shrink:0; }
        .pc:hover .pc-bar, .pc.pc-lit .pc-bar { opacity:1; }
        .pc-ambient {
          position:absolute;inset:0;pointer-events:none;
          background:radial-gradient(ellipse at 50% -10%, var(--tc-soft) 0%, transparent 60%);
          opacity:0;transition:opacity .25s;
        }
        .pc:hover .pc-ambient, .pc.pc-lit .pc-ambient { opacity:1; }

        .sign-btn {
          width:100%;background:#e8490f;border:none;
          color:#fff;font-size:11px;font-weight:800;
          letter-spacing:.12em;padding:13px 20px;border-radius:4px;
          cursor:pointer;display:flex;align-items:center;
          justify-content:center;gap:9px;
          transition:background .15s, box-shadow .15s, transform .1s;
          font-family:var(--font-mono),'IBM Plex Mono',monospace;
          box-shadow:0 0 24px #e8490f44, 0 2px 6px #0008;
          flex-shrink:0;
        }
        .sign-btn:hover:not(:disabled) {
          background:#ff5c22;
          box-shadow:0 0 36px #e8490f66, 0 4px 12px #0008;
          transform:translateY(-1px);
        }
        .sign-btn:disabled { background:#181818;color:#444;cursor:not-allowed;box-shadow:none; }

        .step-row {
          display:flex;align-items:flex-start;gap:12px;
          padding:8px 0;border-bottom:1px solid #0f0f0f;flex-shrink:0;
        }
        .step-row:last-child { border-bottom:none; }
      `}</style>

      {/* ── LEFT — Tier cards ── */}
      <div
        style={{
          width: "52%",
          height: "100vh",
          overflow: "hidden",
          borderRight: "1px solid #111",
          background: "#080808",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          padding: "20px 24px 14px",
        }}
      >
        <div className="scan-line" />
        <div
          style={{
            position: "absolute",
            bottom: -100,
            left: -80,
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: "radial-gradient(circle,#e8490f07 0%,transparent 65%)",
            pointerEvents: "none",
          }}
        />

        {/* Wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
            flexShrink: 0,
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

        {/* Headline */}
        <div style={{ marginBottom: 12, flexShrink: 0 }}>
          <h2
            style={{
              color: "#eaeaea",
              fontSize: 17,
              fontWeight: 900,
              letterSpacing: ".02em",
              lineHeight: 1.25,
              marginBottom: 3,
            }}
          >
            HOLD WRAITH. <span style={{ color: "#e8490f" }}>UNLOCK</span> THE
            MACHINE.
          </h2>
          <p style={{ color: "#444", fontSize: 10, lineHeight: 1.5 }}>
            Four token-gated tiers. Balance auto-detected on wallet connect.
          </p>
        </div>

        {/* Cards stacked vertically, fill remaining space */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            flex: 1,
            minHeight: 0,
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
                    padding: "8px 12px",
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    flex: 1,
                    minHeight: 0,
                    position: "relative",
                  }}
                >
                  {/* Badge */}
                  {(isRecommended || isActive) && (
                    <div
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 8,
                        fontSize: 7,
                        fontWeight: 900,
                        letterSpacing: ".1em",
                        color: isActive ? tc : "#a855f7",
                        background: isActive ? `${tc}18` : "#a855f714",
                        border: `1px solid ${isActive ? tc + "44" : "#a855f740"}`,
                        padding: "2px 6px",
                        borderRadius: 2,
                      }}
                    >
                      {isActive ? "YOUR TIER" : "POPULAR"}
                    </div>
                  )}

                  {/* Ghost icon */}
                  <GhostIcon tier={key} lit={lit} />

                  {/* Name + subtitle */}
                  <div style={{ flexShrink: 0, minWidth: 90 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 900,
                        letterSpacing: ".14em",
                        color: lit ? tc : "#c0c0c0",
                        transition: "color .2s",
                      }}
                    >
                      {key}
                    </div>
                    <div style={{ fontSize: 8, color: "#444", marginTop: 1 }}>
                      {TIER_SUBTITLE[key]}
                    </div>
                  </div>

                  {/* Divider */}
                  <div
                    style={{
                      width: 1,
                      height: 24,
                      background: "#1e1e1e",
                      flexShrink: 0,
                    }}
                  />

                  {/* Fee */}
                  <div style={{ flexShrink: 0, minWidth: 70 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 3,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 20,
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
                          fontSize: 8,
                          color: "#444",
                          letterSpacing: ".06em",
                        }}
                      >
                        /trade
                      </span>
                    </div>
                    <div style={{ fontSize: 8, color: "#555", marginTop: 1 }}>
                      {TIER_PITCH[key]}
                    </div>
                  </div>

                  {/* Divider */}
                  <div
                    style={{
                      width: 1,
                      height: 24,
                      background: "#1e1e1e",
                      flexShrink: 0,
                    }}
                  />

                  {/* Features inline */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap" as const,
                      gap: "2px 8px",
                      flex: 1,
                      minWidth: 0,
                      alignContent: "center",
                    }}
                  >
                    {ALL_FEATURES.map((f) => {
                      const has =
                        t.features.find((x) => x.id === f.id)?.unlocked ??
                        false;
                      return (
                        <div
                          key={f.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 9,
                              color: has ? (lit ? tc : "#00c47a") : "#252525",
                              fontWeight: 900,
                            }}
                          >
                            {has ? "✓" : "—"}
                          </span>
                          <span
                            style={{
                              fontSize: 8,
                              color: has ? "#888" : "#2a2a2a",
                              textDecoration: has ? "none" : "line-through",
                              whiteSpace: "nowrap" as const,
                            }}
                          >
                            {f.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Buy CTA */}
        <div
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid #111",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <span
            style={{ color: "#2a2a2a", fontSize: 9, letterSpacing: ".1em" }}
          >
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
              border: `1px solid ${buyHovered ? "#e8490f55" : "#e8490f28"}`,
              background: buyHovered ? "#e8490f12" : "transparent",
              padding: "5px 10px",
              borderRadius: 3,
              transition: "all .15s",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              ...MONO,
            }}
            onMouseEnter={() => setBuyHovered(true)}
            onMouseLeave={() => setBuyHovered(false)}
          >
            BUY WRAITH <span style={{ opacity: 0.5 }}>↗</span>
          </a>
        </div>
      </div>

      {/* ── RIGHT — Sign in panel ── */}
      <div
        style={{
          width: "48%",
          height: "100vh",
          overflow: "hidden",
          background: "#080808",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          padding: "0 48px",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -80,
            right: -80,
            width: 320,
            height: 320,
            borderRadius: "50%",
            background: "radial-gradient(circle,#e8490f0a 0%,transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div style={{ width: "100%", maxWidth: 360 }}>
          {/* Mini brand */}
          <div style={{ textAlign: "center" as const, marginBottom: 28 }}>
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
            <div style={{ color: "#222", fontSize: 8, letterSpacing: ".22em" }}>
              MEME TOKEN SNIPER · SOLANA
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <h1
              style={{
                color: "#e8e8e8",
                fontSize: 20,
                fontWeight: 900,
                letterSpacing: ".04em",
                lineHeight: 1.2,
                marginBottom: 8,
              }}
            >
              SIGN IN TO ACCESS
            </h1>
            <p style={{ color: "#525252", fontSize: 11, lineHeight: 1.8 }}>
              Connect your Google account, then link your Solana wallet — your
              WRAITH balance auto-detects your tier instantly.
            </p>
          </div>

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
                marginBottom: 16,
              }}
            >
              {errorMsg}
            </div>
          )}

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

          <button
            className="sign-btn"
            onClick={async () => {
              setLoading(true);
              await signIn("google", { callbackUrl: "/app" });
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

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              margin: "18px 0",
            }}
          >
            <div style={{ flex: 1, height: 1, background: "#111" }} />
            <span
              style={{ color: "#242424", fontSize: 8, letterSpacing: ".24em" }}
            >
              THEN
            </span>
            <div style={{ flex: 1, height: 1, background: "#111" }} />
          </div>

          <div style={{ marginBottom: 20 }}>
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
                    style={{ color: "#4a4a4a", fontSize: 10, lineHeight: 1.7 }}
                  >
                    {s.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              paddingTop: 14,
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
  );
}
