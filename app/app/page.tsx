"use client";

import { useTestMode } from "@/lib/testMode";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { cacheTokenNav } from "@/lib/tokenNav";
import { ToastProvider } from "@/components/Toast";

const Header = dynamic(() => import("@/components/Header"), { ssr: false });
const TokenBoard = dynamic(() => import("@/components/TokenBoard"), { ssr: false });
const MemeScanner = dynamic(() => import("@/components/MemeScanner"), { ssr: false });
const WinsBoard = dynamic(() => import("@/components/WinsBoard"), { ssr: false });
const TestMarket = dynamic(() => import("@/components/TestMarket"), { ssr: false });
const TestnetLab = dynamic(() => import("@/components/TestnetLab"), { ssr: false });
const SignalScanner = dynamic(() => import("@/components/SignalScanner"), { ssr: false });
const MarketCallsRail = dynamic(() => import("@/components/MarketCallsRail"), { ssr: false });

// Shared across the app (scanner, wins, favorites, token navigation).
export interface MemeTrend {
  keyword: string;
  score: number;
  posts: number;
  source: string;
  hasTicker?: boolean;
  crossPlatforms?: number;
  isNewCoin?: boolean;
  ageLabel?: string;
  mcap?: number;
  liquidity?: number;
  volume?: number;
  tokenImageUrl?: string;
  platforms?: string[];
  contractAddress?: string;
  celebMention?: string;
  aiContext?: string;
}

type View = "market" | "scanner" | "wins" | "testnet";
const VIEWS: { key: View; label: string; hint: string }[] = [
  { key: "market", label: "Market", hint: "Live Solana tokens" },
  { key: "scanner", label: "Scanner", hint: "Live momentum signals" },
  { key: "wins", label: "Wins", hint: "How our calls performed" },
  { key: "testnet", label: "Testnet", hint: "Practice with free devnet SOL" },
];

export default function Home() {
  const router = useRouter();
  const [testMode, setTestModeFlag] = useTestMode();
  const [view, setView] = useState<View>("market");
  const [selected, setSelected] = useState<MemeTrend | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem("wraith_home_view");
      if (v === "market" || v === "scanner" || v === "wins" || v === "testnet") setView(v);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Mobile tab bar switches the home view without a reload
  useEffect(() => {
    const h = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === "market" || v === "scanner" || v === "wins" || v === "testnet") setView(v);
    };
    window.addEventListener("wraith:view", h);
    return () => window.removeEventListener("wraith:view", h);
  }, []);

  const changeView = useCallback((next: View) => {
    setView(next);
    try {
      localStorage.setItem("wraith_home_view", next);
    } catch {
      /* ignore */
    }
  }, []);

  const handleSelectMeme = useCallback(
    (meme: MemeTrend) => {
      setSelected(meme);
      if (!meme.contractAddress) return;
      cacheTokenNav(meme);
      router.push(`/app/token/${encodeURIComponent(meme.contractAddress)}`);
    },
    [router],
  );

  return (
    <ToastProvider>
    <div className="wraith-dashboard wx-page">
      <Header onSelectMeme={handleSelectMeme} />

      {testMode && (
        <div className="wx-testbar" role="status">
          <span><b>TEST MODE</b> Solana devnet sandbox. Market and trades here use play money; Scanner and Wins still show real data.</span>
          <button type="button" onClick={() => setTestModeFlag(false)}>Turn off</button>
        </div>
      )}

      <nav className="wx-subnav" aria-label="Discover sections">
        <div className="wx-subnav-inner">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" className={view === v.key ? "on" : ""} aria-current={view === v.key ? "page" : undefined} onClick={() => changeView(v.key)}>
              {v.label}
            </button>
          ))}
          <span className="wx-subnav-hint">{VIEWS.find((v) => v.key === view)?.hint}</span>
        </div>
      </nav>

      <main className="wx-main">
        {view === "market" && (
          <div className="wx-market-layout">
            <MarketCallsRail onSelectMeme={handleSelectMeme} onOpenScanner={() => changeView("scanner")} />
            <div className="wx-market-main">
              {testMode ? (
                <TestMarket onSelectMeme={handleSelectMeme} onOpenTestnet={() => changeView("testnet")} />
              ) : (
                <TokenBoard onSelectMeme={handleSelectMeme} />
              )}
            </div>
          </div>
        )}

        {view === "scanner" && (
          <div className="wx-scanner-layout">
            <SignalScanner
              onSelectMeme={handleSelectMeme}
              deepScan={<MemeScanner onSelectMeme={handleSelectMeme} selectedMeme={selected} />}
            />
          </div>
        )}

        {view === "testnet" && (
          <div className="wx-wins-wrap">
            <TestnetLab />
          </div>
        )}

        {view === "wins" && (
          <div className="wx-wins-wrap">
            <WinsBoard onSelectMeme={handleSelectMeme} />
          </div>
        )}
      </main>
    </div>
    </ToastProvider>
  );
}
