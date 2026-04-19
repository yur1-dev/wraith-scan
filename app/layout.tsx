import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import WalletProvider from "@/components/WalletProvider";

const mono = IBM_Plex_Mono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "WRAITH — Meme Token Sniper",
  description: "Scan viral memes, find Solana tokens, buy instantly.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={mono.variable}>
      <body style={{ fontFamily: "var(--font-mono)" }}>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
