import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./wraith-ui.css";
import "./wraith-polish.css";
import "./wraith-responsive.css";
import "./wraith-mobile.css";
import WalletProvider from "@/components/WalletProvider";
import BootSplash from "@/components/BootSplash";
import FcmLink from "@/components/FcmLink";
import SwRegister from "@/components/SwRegister";
import { WraithTierProvider } from "@/hooks/useWraithTier";

// Self-hosted (latin subset). next/font/google downloads from Google at build/dev time, which broke Turbopack once Google
// switched some families to "fonts.gstatic.com/l/font?kit=..." URLs, and makes every build depend on Google being up.
const mono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-mono",
});

const display = localFont({
  src: [{ path: "./fonts/anton-latin-400-normal.woff2", weight: "400", style: "normal" }],
  display: "swap",
  variable: "--font-display",
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
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${mono.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `html,body{background:#0c0c0d}#wx-boot{position:fixed;inset:0;z-index:2147483000;display:none;place-items:center;background:#0c0c0d}#wx-boot img{width:min(18vw,110px);height:auto}@media (display-mode:standalone),(display-mode:fullscreen),(display-mode:minimal-ui){#wx-boot{display:grid}}#wx-boot[hidden]{display:none!important}` }} />
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var L=localStorage,d=document.documentElement;if(location.pathname.indexOf("/app")!==0)return;var b=null;try{b=JSON.parse(L.getItem("wraith_applock_v1")||"null")}catch(e){}var bo=!!(b&&b.on&&window.PublicKeyCredential),pn=L.getItem("wraith_pin_enabled")==="true"&&!!L.getItem("wraith_pin_hash");if(!bo&&!pn)return;var t=parseInt(L.getItem("wraith_pin_timeout_ms")||"300000",10);if(t===0)return;var la=parseInt(L.getItem("wraith_last_active")||"0",10);if(Date.now()-la<=t)return;d.classList.add("wx-prelock");if(bo){var s=b.id.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((b.id.length+3)%4),r=atob(s),u=new Uint8Array(r.length);for(var i=0;i<r.length;i++)u[i]=r.charCodeAt(i);window.__wxBio=navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rpId:location.hostname,allowCredentials:[{id:u,type:"public-key",transports:["internal"]}],userVerification:"required",timeout:60000}});window.__wxBio.catch(function(){})}}catch(e){}})();` }} />
      </head>
      <body>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div id="wx-boot" aria-hidden="true"><img src="/ghost.png" alt="" /></div>
        <BootSplash />
        <FcmLink />
        <SwRegister />
        <WalletProvider>
          <WraithTierProvider>{children}</WraithTierProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
