import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import "./wraith-ui.css";
import "./wraith-polish.css";
import "./wraith-responsive.css";
import "./wraith-mobile.css";
import WalletProvider from "@/components/WalletProvider";
import AppLock from "@/components/AppLock";
import { WraithTierProvider } from "@/hooks/useWraithTier";

const mono = IBM_Plex_Mono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "WRAITH — Meme Token Sniper",
  description: "Scan viral memes, find Solana tokens, buy instantly.",
  applicationName: "Wraith",
  appleWebApp: { capable: true, title: "Wraith", statusBarStyle: "black-translucent" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0c0c0d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={mono.variable}>
      <body>
        <WalletProvider>
          <WraithTierProvider>{children}</WraithTierProvider>
          <AppLock />
        </WalletProvider>
      </body>
    </html>
  );
}
