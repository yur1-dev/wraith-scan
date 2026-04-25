"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSession, signOut } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import WalletModal from "./WalletModal";
import { TierBadge } from "@/hooks/useWraithTier";

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};

function trimAddress(addr: string) {
  return `${addr.slice(0, 4)}..${addr.slice(-4)}`;
}

export default function Header() {
  const { connected, publicKey, disconnect, connecting } = useWallet();
  const { data: session } = useSession();
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

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
          {/*  */}
        </div>

        {/* Center — nav */}
        <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {[
            // { label: "SNIPER", href: "/" },
            // { label: "SIGNALS", href: "/?tab=signals" },
            // { label: "PAPER", href: "/?tab=paper" },
          ].map(({ label, href }) => (
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
                    minWidth: 180,
                    zIndex: 200,
                    overflow: "hidden",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
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
                        maxWidth: 152,
                      }}
                    >
                      {session.user?.email ?? "—"}
                    </div>
                  </div>

                  <Link
                    href="/access"
                    style={{
                      display: "block",
                      color: "#444",
                      fontSize: 10,
                      ...MONO,
                      padding: "10px 14px",
                      textDecoration: "none",
                      letterSpacing: ".06em",
                      borderBottom: "1px solid #0d0d0d",
                      transition: "background .15s, color .15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#0a0a0a";
                      e.currentTarget.style.color = "#e8490f";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "#444";
                    }}
                  >
                    VIEW TIERS
                  </Link>

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
