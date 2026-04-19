"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
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
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (connected) setModalOpen(false);
  }, [connected]);

  const handleCopy = () => {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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

          <div>
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
            {/* <div
              style={{
                color: "#555",
                fontSize: 9,
                letterSpacing: "0.1em",
                ...MONO,
                lineHeight: 1,
                marginTop: 2,
              }}
            >
              MEME TOKEN SNIPER
            </div> */}
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

        {/* Right — wallet */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                  padding: "6px 12px",
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
                  padding: "6px 12px",
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
                padding: "8px 20px",
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
        </div>
      </header>
    </>
  );
}
