"use client";

import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import type { WalletError } from "@solana/wallet-adapter-base";
import { useCallback, useMemo } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";
import PrivyEmbeddedWallets from "@/components/PrivyEmbeddedWallets";

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
  const wallets = useMemo(() => [new SolflareWalletAdapter()], []);

  const onError = useCallback((error: WalletError) => {
    console.warn("[wallet]", error.name, error.message);
    // Drop the saved wallet so autoConnect stops retrying a broken one
    try {
      localStorage.removeItem("walletName");
    } catch {}
  }, []);

  return (
    <ConnectionProvider endpoint={RPC_HTTP} config={{ wsEndpoint: RPC_WS }}>
      <SolanaWalletProvider
        wallets={wallets}
        autoConnect={async (adapter) => adapter.name !== "MetaMask"}
        onError={onError}
      >
        <PrivyEmbeddedWallets>
          <WalletModalProvider>{children}</WalletModalProvider>
        </PrivyEmbeddedWallets>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
