"use client";

import { useState, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSession, signOut } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import WalletModal from "./WalletModal";
import { TierBadge, useWraithTier } from "@/hooks/useWraithTier";

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};

function trimAddress(addr: string) {
  return `${addr.slice(0, 4)}..${addr.slice(-4)}`;
}

// Tiers that can access Telegram alerts (SPECTER and above)
const TELEGRAM_TIERS = ["SPECTER", "WRAITH"];

export default function Header() {
  const { connected, publicKey, disconnect, connecting } = useWallet();
  const { data: session } = useSession();
  const { tier } = useWraithTier();
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [tgLinking, setTgLinking] = useState(false);
  const [tgLinked, setTgLinked] = useState(false);
  const [tgTooltip, setTgTooltip] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canUseTelegram = TELEGRAM_TIERS.includes(tier?.key ?? "");

  useEffect(() => {
    if (connected) setModalOpen(false);
  }, [connected]);

  const handleCopy = () => {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = () => setUserMenuOpen(false);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [userMenuOpen]);

  // Check if already linked on mount
  useEffect(() => {
    if (!session) return;
    fetch("/api/user/telegram-status")
      .then((r) => r.json())
      .then((d) => {
        if (d.linked) setTgLinked(true);
      })
      .catch(() => {});
  }, [session]);

  // Poll for linked status after clicking connect
  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);

    let attempts = 0;
    const MAX = 10; // 10 × 3s = 30s max

    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch("/api/user/telegram-status");
        const d = await r.json();
        if (d.linked) {
          setTgLinked(true);
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      } catch {
        // silent
      }
      if (attempts >= MAX) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
    }, 3000);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleConnectTelegram = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canUseTelegram || tgLinked) return;
    setTgLinking(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank");
        startPolling();
      }
    } catch {
      // silent
    } finally {
      setTgLinking(false);
    }
  };

  return (
    <>
      <WalletModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <header
        style={{
          background: "#020202",
          borderBottom: "1px solid #0d0d0d",
          padding: "0 24px",
          height: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          ...MONO,
        }}
      >
        {/* Left — branding */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            minWidth: 160,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              position: "relative",
              flexShrink: 0,
            }}
          >
            <Image
              src="/logo.png"
              alt="Wraith logo"
              fill
              sizes="28px"
              style={{
                objectFit: "contain",
                mixBlendMode: "screen",
                filter: "drop-shadow(0 0 5px #e8490f77)",
              }}
              priority
            />
          </div>

          <span
            style={{
              color: "#e0e0e0",
              fontSize: 16,
              fontWeight: 900,
              letterSpacing: ".22em",
              lineHeight: 1,
            }}
          >
            WRAITH
          </span>
        </div>

        {/* Center — nav */}
        <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {[].map(({ label, href }: { label: string; href: string }) => (
            <Link
              key={label}
              href={href}
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: ".16em",
                color: "#272727",
                textDecoration: "none",
                padding: "6px 14px",
                borderRadius: 3,
                transition: "color .15s, background .15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#888";
                e.currentTarget.style.background = "#0a0a0a";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#272727";
                e.currentTarget.style.background = "transparent";
              }}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Right — wallet + user */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 160,
            justifyContent: "flex-end",
          }}
        >
          {connected && publicKey ? (
            <>
              <TierBadge compact />

              <button
                onClick={handleCopy}
                style={{
                  background: "#080808",
                  border: "1px solid #181818",
                  color: copied ? "#00c47a" : "#444",
                  fontSize: 10,
                  ...MONO,
                  padding: "0 12px",
                  height: 30,
                  borderRadius: 4,
                  cursor: "pointer",
                  letterSpacing: ".05em",
                  transition: "all .15s",
                }}
                onMouseEnter={(e) => {
                  if (!copied) e.currentTarget.style.color = "#666";
                }}
                onMouseLeave={(e) => {
                  if (!copied) e.currentTarget.style.color = "#444";
                }}
              >
                {copied ? "COPIED" : trimAddress(publicKey.toString())}
              </button>

              <button
                onClick={() => disconnect()}
                style={{
                  background: "transparent",
                  border: "1px solid #181818",
                  color: "#2a2a2a",
                  fontSize: 10,
                  ...MONO,
                  padding: "0 12px",
                  height: 30,
                  borderRadius: 4,
                  cursor: "pointer",
                  transition: "all .15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#ff444433";
                  e.currentTarget.style.color = "#ff4444";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#181818";
                  e.currentTarget.style.color = "#2a2a2a";
                }}
              >
                DISCONNECT
              </button>
            </>
          ) : (
            <button
              onClick={() => setModalOpen(true)}
              disabled={connecting}
              style={{
                background: connecting ? "#0a0a0a" : "#e8490f",
                border: "none",
                color: connecting ? "#444" : "#fff",
                fontSize: 11,
                fontWeight: 700,
                ...MONO,
                padding: "0 18px",
                height: 30,
                borderRadius: 4,
                cursor: connecting ? "not-allowed" : "pointer",
                letterSpacing: ".1em",
                boxShadow: connecting ? "none" : "0 0 14px #e8490f33",
                transition: "all .15s",
              }}
              onMouseEnter={(e) => {
                if (!connecting) e.currentTarget.style.background = "#ff5a1f";
              }}
              onMouseLeave={(e) => {
                if (!connecting) e.currentTarget.style.background = "#e8490f";
              }}
            >
              {connecting ? "CONNECTING..." : "CONNECT WALLET"}
            </button>
          )}

          {session && (
            <div
              style={{
                width: 1,
                height: 20,
                background: "#111",
                margin: "0 2px",
              }}
            />
          )}

          {session && (
            <div style={{ position: "relative" }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setUserMenuOpen((v) => !v);
                }}
                style={{
                  background: "transparent",
                  border: "1px solid #181818",
                  borderRadius: 4,
                  padding: "0 8px",
                  height: 30,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  transition: "border-color .15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#2a2a2a";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#181818";
                }}
              >
                {session.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt="avatar"
                    width={20}
                    height={20}
                    style={{ borderRadius: "50%", display: "block" }}
                  />
                ) : (
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "#e8490f18",
                      border: "1px solid #e8490f33",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#e8490f",
                      fontSize: 8,
                      fontWeight: 700,
                      ...MONO,
                    }}
                  >
                    {(session.user?.name ??
                      session.user?.email ??
                      "?")[0].toUpperCase()}
                  </div>
                )}

                <span style={{ color: "#333", fontSize: 10, ...MONO }}>
                  {session.user?.name?.split(" ")[0] ??
                    session.user?.email?.split("@")[0] ??
                    "USER"}
                </span>

                {/* Telegram linked indicator dot on avatar button */}
                {tgLinked && (
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#00c47a",
                      boxShadow: "0 0 6px #00c47a88",
                      flexShrink: 0,
                    }}
                  />
                )}

                <svg
                  width="7"
                  height="7"
                  viewBox="0 0 8 8"
                  style={{
                    transform: userMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform .15s",
                  }}
                >
                  <path
                    d="M1 2.5L4 5.5L7 2.5"
                    stroke="#333"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              {userMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: 0,
                    background: "#060606",
                    border: "1px solid #111",
                    borderRadius: 5,
                    minWidth: 200,
                    zIndex: 200,
                    overflow: "hidden",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* User info */}
                  <div
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid #0d0d0d",
                    }}
                  >
                    <div
                      style={{
                        color: "#555",
                        fontSize: 9,
                        ...MONO,
                        marginBottom: 3,
                      }}
                    >
                      SIGNED IN AS
                    </div>
                    <div
                      style={{
                        color: "#888",
                        fontSize: 10,
                        ...MONO,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 172,
                      }}
                    >
                      {session.user?.email ?? "—"}
                    </div>
                  </div>

                  {/* Connect Telegram — tier gated */}
                  <div
                    style={{ position: "relative" }}
                    onMouseEnter={() => !canUseTelegram && setTgTooltip(true)}
                    onMouseLeave={() => setTgTooltip(false)}
                  >
                    <button
                      onClick={
                        canUseTelegram && !tgLinked
                          ? handleConnectTelegram
                          : undefined
                      }
                      disabled={tgLinking}
                      style={{
                        width: "100%",
                        background: tgLinked ? "#001a0d" : "transparent",
                        border: "none",
                        borderBottom: "1px solid #0d0d0d",
                        color: tgLinked
                          ? "#00c47a"
                          : canUseTelegram
                            ? "#2b9fd4"
                            : "#2a2a2a",
                        fontSize: 10,
                        ...MONO,
                        padding: "10px 14px",
                        cursor:
                          tgLinked || !canUseTelegram ? "default" : "pointer",
                        textAlign: "left",
                        letterSpacing: ".06em",
                        transition: "background .15s, color .15s",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                      onMouseEnter={(e) => {
                        if (canUseTelegram && !tgLinked) {
                          e.currentTarget.style.background = "#0a1520";
                          e.currentTarget.style.color = "#3ab8f0";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (canUseTelegram && !tgLinked) {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "#2b9fd4";
                        }
                      }}
                    >
                      {/* Telegram icon */}
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        style={{
                          flexShrink: 0,
                          opacity: canUseTelegram ? 1 : 0.3,
                        }}
                      >
                        <path
                          d="M22 2L11 13"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M22 2L15 22L11 13L2 9L22 2Z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>

                      <span>
                        {tgLinking
                          ? "OPENING..."
                          : tgLinked
                            ? "TELEGRAM LINKED"
                            : "CONNECT TELEGRAM"}
                      </span>

                      {/* Green dot when linked */}
                      {tgLinked && (
                        <div
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#00c47a",
                            boxShadow: "0 0 6px #00c47a88",
                            marginLeft: "auto",
                            flexShrink: 0,
                          }}
                        />
                      )}

                      {/* Lock icon for non-eligible tiers */}
                      {!canUseTelegram && (
                        <svg
                          width="9"
                          height="9"
                          viewBox="0 0 24 24"
                          fill="none"
                          style={{ marginLeft: "auto", opacity: 0.4 }}
                        >
                          <rect
                            x="3"
                            y="11"
                            width="18"
                            height="11"
                            rx="2"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                          <path
                            d="M7 11V7C7 4.24 9.24 2 12 2C14.76 2 17 4.24 17 7V11"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                        </svg>
                      )}
                    </button>

                    {/* Tooltip for locked state */}
                    {tgTooltip && !canUseTelegram && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "calc(100% + 6px)",
                          left: 14,
                          background: "#0a0a0a",
                          border: "1px solid #1a1a1a",
                          borderRadius: 4,
                          padding: "6px 10px",
                          fontSize: 9,
                          color: "#e8490f",
                          ...MONO,
                          whiteSpace: "nowrap",
                          zIndex: 300,
                          letterSpacing: ".05em",
                          pointerEvents: "none",
                        }}
                      >
                        SPECTER TIER REQUIRED
                        <div
                          style={{
                            position: "absolute",
                            bottom: -4,
                            left: 12,
                            width: 7,
                            height: 7,
                            background: "#0a0a0a",
                            border: "1px solid #1a1a1a",
                            borderTop: "none",
                            borderLeft: "none",
                            transform: "rotate(45deg)",
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Sign out */}
                  <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    style={{
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      color: "#ff4444",
                      fontSize: 10,
                      ...MONO,
                      padding: "10px 14px",
                      cursor: "pointer",
                      textAlign: "left",
                      letterSpacing: ".06em",
                      transition: "background .15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#1a0000";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    SIGN OUT
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>
    </>
  );
}
