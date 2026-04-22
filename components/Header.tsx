"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSession, signOut } from "next-auth/react";
import Image from "next/image";
import WalletModal from "./WalletModal";

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
          background: "#030303",
          borderBottom: "1px solid #1a1a1a",
          padding: "0 20px",
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        {/* Left — branding */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              position: "relative",
              flexShrink: 0,
            }}
          >
            <Image
              src="/logo.png"
              alt="Wraith logo"
              fill
              sizes="32px"
              style={{
                objectFit: "contain",
                mixBlendMode: "screen",
                filter: "drop-shadow(0 0 6px #e8490f88)",
              }}
              priority
            />
          </div>

          <div
            style={{
              color: "#e0e0e0",
              fontSize: 21,
              fontWeight: 700,
              letterSpacing: "0.15em",
              ...MONO,
              lineHeight: 1,
            }}
          >
            WRAITH
          </div>

          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#00c47a",
              boxShadow: "0 0 6px #00c47a",
              marginLeft: 4,
            }}
          />
          <span style={{ color: "#00c47a", fontSize: 10, ...MONO }}>LIVE</span>
        </div>

        {/* Center */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{
              fontSize: 10,
              color: "#444",
              ...MONO,
              border: "1px solid #222",
              padding: "3px 10px",
              borderRadius: 4,
            }}
          >
            ◈ SOLANA
          </span>
        </div>

        {/* Right — wallet + user account */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Wallet controls */}
          {connected && publicKey ? (
            <>
              <button
                onClick={handleCopy}
                style={{
                  background: "#0a0a0a",
                  border: "1px solid #222",
                  color: copied ? "#00c47a" : "#888",
                  fontSize: 10,
                  ...MONO,
                  padding: "0 12px",
                  height: 32,
                  borderRadius: 4,
                  cursor: "pointer",
                  letterSpacing: "0.05em",
                  transition: "all 0.15s",
                }}
              >
                {copied ? "COPIED!" : trimAddress(publicKey.toString())}
              </button>

              <button
                onClick={() => disconnect()}
                style={{
                  background: "transparent",
                  border: "1px solid #222",
                  color: "#555",
                  fontSize: 10,
                  ...MONO,
                  padding: "0 12px",
                  height: 32,
                  borderRadius: 4,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "#ff444433";
                  (e.currentTarget as HTMLElement).style.color = "#ff4444";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "#222";
                  (e.currentTarget as HTMLElement).style.color = "#555";
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
                background: connecting ? "#111" : "#e8490f",
                border: "none",
                color: connecting ? "#666" : "#fff",
                fontSize: 11,
                fontWeight: 700,
                ...MONO,
                padding: "0 20px",
                height: 32,
                borderRadius: 5,
                cursor: connecting ? "not-allowed" : "pointer",
                letterSpacing: "0.1em",
                boxShadow: connecting ? "none" : "0 0 16px #e8490f44",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!connecting)
                  (e.currentTarget as HTMLElement).style.background = "#ff5a1f";
              }}
              onMouseLeave={(e) => {
                if (!connecting)
                  (e.currentTarget as HTMLElement).style.background = "#e8490f";
              }}
            >
              {connecting ? "CONNECTING..." : "CONNECT WALLET"}
            </button>
          )}

          {/* Divider */}
          {session && (
            <div
              style={{
                width: 1,
                height: 24,
                background: "#1a1a1a",
                margin: "0 4px",
              }}
            />
          )}

          {/* Google account menu */}
          {session && (
            <div style={{ position: "relative" }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setUserMenuOpen((v) => !v);
                }}
                style={{
                  background: "transparent",
                  border: "1px solid #222",
                  borderRadius: 4,
                  padding: "0 8px",
                  height: 32,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "#333";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "#222";
                }}
              >
                {/* Avatar */}
                {session.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt="avatar"
                    width={22}
                    height={22}
                    style={{ borderRadius: "50%", display: "block" }}
                  />
                ) : (
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "#e8490f22",
                      border: "1px solid #e8490f44",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#e8490f",
                      fontSize: 9,
                      fontWeight: 700,
                      ...MONO,
                    }}
                  >
                    {(session.user?.name ??
                      session.user?.email ??
                      "?")[0].toUpperCase()}
                  </div>
                )}

                <span style={{ color: "#555", fontSize: 10, ...MONO }}>
                  {session.user?.name?.split(" ")[0] ??
                    session.user?.email?.split("@")[0] ??
                    "USER"}
                </span>

                {/* Chevron */}
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  style={{
                    transform: userMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.15s",
                  }}
                >
                  <path
                    d="M1 2.5L4 5.5L7 2.5"
                    stroke="#444"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              {/* Dropdown */}
              {userMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: 0,
                    background: "#060606",
                    border: "1px solid #1a1a1a",
                    borderRadius: 6,
                    minWidth: 180,
                    zIndex: 100,
                    overflow: "hidden",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Account info */}
                  <div
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid #111",
                    }}
                  >
                    <div
                      style={{
                        color: "#888",
                        fontSize: 9,
                        ...MONO,
                        marginBottom: 2,
                      }}
                    >
                      SIGNED IN AS
                    </div>
                    <div
                      style={{
                        color: "#e0e0e0",
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
                      letterSpacing: "0.05em",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "#1a0000";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
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
