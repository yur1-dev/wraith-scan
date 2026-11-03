import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import "./wraith-ui.css";
import "./wraith-polish.css";
import "./wraith-responsive.css";
import "./wraith-mobile.css";
import WalletProvider from "@/components/WalletProvider";
import AppLock from "@/components/AppLock";
import BootSplash from "@/components/BootSplash";
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
    <html lang="en" className={mono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `var a=false;try{if(document.referrer.indexOf("android-app://")===0)sessionStorage.setItem("wx_app","1");a=sessionStorage.getItem("wx_app")==="1"||navigator.standalone===true||matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches}catch(e){}try{var l=JSON.parse(localStorage.getItem("wraith_applock_v1")||"null");if(a&&l&&l.on)document.documentElement.classList.add("wx-prelock")}catch(e){}` }} />
      </head>
      <body>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div id="wx-boot" aria-hidden="true"><img src="/logo.png" alt="" width="60" height="67" /></div>
        <BootSplash />
        <WalletProvider>
          <WraithTierProvider>{children}</WraithTierProvider>
          <AppLock />
        </WalletProvider>
      </body>
    </html>
  );
}
