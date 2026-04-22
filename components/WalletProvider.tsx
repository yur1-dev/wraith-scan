"use client";

import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { useMemo } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:3000");

const RPC_HTTP = `${APP_URL}/api/rpc`;
const RPC_WS = "wss://solana-rpc.publicnode.com";

export default function WalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const wallets = useMemo(
    () => [new SolflareWalletAdapter()], // ← Phantom removed, it self-registers now
    [],
  );

  return (
    <ConnectionProvider endpoint={RPC_HTTP} config={{ wsEndpoint: RPC_WS }}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
