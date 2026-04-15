"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Header() {
  const { publicKey } = useWallet();

  return (
    <header className="border-b border-[#1a1a1a] px-4 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#e8490f] rounded-sm flex items-center justify-center">
            <span className="text-white text-xs font-bold">W</span>
          </div>
          <div>
            <h1 className="text-[#e8490f] text-lg font-bold tracking-[0.2em] uppercase">
              WRAITH
            </h1>
            <p className="text-[#444] text-[10px] tracking-widest uppercase">
              Meme Token Sniper
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {publicKey && (
            <div className="text-[#444] text-xs">
              <span className="text-[#e8490f]">●</span>{" "}
              {publicKey.toString().slice(0, 4)}...
              {publicKey.toString().slice(-4)}
            </div>
          )}
          <WalletMultiButton
            style={{
              background: "transparent",
              border: "1px solid #e8490f",
              color: "#e8490f",
              fontSize: "12px",
              fontFamily: "monospace",
              padding: "8px 16px",
              borderRadius: "4px",
              letterSpacing: "0.1em",
            }}
          />
        </div>
      </div>
    </header>
  );
}
