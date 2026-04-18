"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import WalletModal from "./WalletModal";

const MONO = {
  fontFamily: "'JetBrains Mono', 'Fira Mono', monospace" as const,
};

function trimAddress(addr: string) {
  return `${addr.slice(0, 4)}..${addr.slice(-4)}`;
}

export default function Header() {
  const { connected, publicKey, disconnect, connecting } = useWallet();
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Close modal on connect
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
          borderBottom: "1px solid #111",
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
              width: 30,
              height: 30,
              background: "#e8490f",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 900,
              color: "#fff",
              ...MONO,
              boxShadow: "0 0 12px #e8490f55",
            }}
          >
            W
          </div>
          <div>
            <div
              style={{
                color: "#e0e0e0",
                fontSize: 13,
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
                color: "#2a2a2a",
                fontSize: 8,
                letterSpacing: "0.1em",
                ...MONO,
                lineHeight: 1,
                marginTop: 2,
              }}
            >
              MEME TOKEN SNIPER
            </div>
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

        {/* Center — ticker/status bar (optional extras) */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{
              fontSize: 9,
              color: "#1a1a1a",
              ...MONO,
              border: "1px solid #141414",
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
              {/* Address chip — click to copy */}
              <button
                onClick={handleCopy}
                style={{
                  background: "#0a0a0a",
                  border: "1px solid #1a1a1a",
                  color: copied ? "#00c47a" : "#555",
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

              {/* Disconnect */}
              <button
                onClick={() => disconnect()}
                style={{
                  background: "transparent",
                  border: "1px solid #1a1a1a",
                  color: "#333",
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
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "#1a1a1a";
                  (e.currentTarget as HTMLElement).style.color = "#333";
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
                color: connecting ? "#555" : "#fff",
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
