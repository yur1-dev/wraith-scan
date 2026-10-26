import type { Metadata } from "next";
import Landing from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: "Wraith: trade every chain from one cash balance",
  description: "Scan new meme tokens on Solana, Base, Ethereum, BNB Chain, Monad, Arc and Robinhood Chain, and buy them with the stablecoins you already hold.",
  openGraph: {
    title: "Wraith: trade every chain from one cash balance",
    description: "Multi-chain meme-token scanner and trading platform with Telegram alerts and OMEN holder tiers.",
    images: [{ url: "/wraith.png" }],
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function Page() {
  return <Landing />;
}
