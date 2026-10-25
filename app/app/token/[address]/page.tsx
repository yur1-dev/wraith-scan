"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Activity, Bookmark, Flame, Users, Wallet } from "lucide-react";
import { ToastProvider } from "@/components/Toast";
import type { MemeTrend } from "@/app/app/page";
import { readTokenNav, cacheTokenNav } from "@/lib/tokenNav";
import { readTokenFavorites, TOKEN_FAVORITES_EVENT } from "@/lib/tokenFavorites";
import { SOLANA_MINT_RE } from "@/lib/market";
import { chainOf, EVM_ADDR_RE } from "@/lib/chains";
import FollowingSidebar from "@/components/FollowingSidebar";
import { TokenIcon } from "@/components/TokenIcon";

const Header = dynamic(() => import("@/components/Header"), { ssr: false });
const TokenPanel = dynamic(() => import("@/components/TokenPanel"), { ssr: false });
const TokenMarketList = dynamic(() => import("@/components/TokenMarketList"), { ssr: false });
const EvmTokenView = dynamic(() => import("@/components/EvmTokenView"), { ssr: false });
const TokenTradeDock = dynamic(() => import("@/components/TokenTradeDock"), { ssr: false });

type SideTab = "tokens" | "saved" | "following";
type MobileTab = "chart" | "trade" | "market";

const SIDE_TABS: { key: SideTab; label: string; icon: React.ReactNode }[] = [
  { key: "tokens", label: "Market", icon: <Flame size={13} /> },
  { key: "saved", label: "Saved", icon: <Bookmark size={13} /> },
  { key: "following", label: "Following", icon: <Users size={13} /> },
];

export default function TokenPage() {
  const params = useParams();
  const router = useRouter();
  const address = decodeURIComponent((params?.address as string) ?? "");
  const [meme, setMeme] = useState<MemeTrend | null>(null);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>("tokens");
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  const [favorites, setFavorites] = useState<MemeTrend[]>([]);
  const isEvm = EVM_ADDR_RE.test(address);
  const validMint = SOLANA_MINT_RE.test(address) || isEvm;

  useEffect(() => {
    const load = () => setFavorites(readTokenFavorites());
    load();
    window.addEventListener(TOKEN_FAVORITES_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(TOKEN_FAVORITES_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const go = useCallback(
    (next: MemeTrend) => {
      if (!next.contractAddress) return;
      cacheTokenNav(next);
      setMobileTab("chart");
      const evm = EVM_ADDR_RE.test(next.contractAddress) ? chainOf(next.source) : null;
      router.push(`/app/token/${encodeURIComponent(next.contractAddress)}${evm ? `?chain=${evm.key}` : ""}`);
    },
    [router],
  );

  // Resolve the token identity: sessionStorage handoff first, API for direct links.
  useEffect(() => {
    if (!address || !validMint || isEvm) return;
    const cached = readTokenNav(address);
    if (cached) {
      setMeme(cached);
      return;
    }
    setMeme({ keyword: address.slice(0, 4).toUpperCase(), score: 0, posts: 0, source: "direct", contractAddress: address });
    let alive = true;
    fetch(`/api/token-price?mint=${encodeURIComponent(address)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { symbol?: string | null; marketCap?: number | null; liquidity?: number | null; imageUrl?: string | null } | null) => {
        if (!alive || !d?.symbol) return;
        const next: MemeTrend = {
          keyword: d.symbol,
          score: 0,
          posts: 0,
          source: "direct",
          contractAddress: address,
          mcap: d.marketCap ?? undefined,
          liquidity: d.liquidity ?? undefined,
          tokenImageUrl: d.imageUrl ?? undefined,
        };
        cacheTokenNav(next);
        setMeme(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [address, validMint, isEvm]);

  const sidebar = (
    <>
      <nav className="wx-side-tabs" aria-label="Token sidebar">
        {SIDE_TABS.map((t) => (
          <button key={t.key} type="button" className={sideTab === t.key ? "on" : ""} aria-pressed={sideTab === t.key} onClick={() => setSideTab(t.key)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="wx-side-body">
        {sideTab === "tokens" && <TokenMarketList onSelectMeme={go} selectedMeme={meme} />}
        {sideTab === "following" && <FollowingSidebar />}
        {sideTab === "saved" &&
          (favorites.length ? (
            <div className="wx-side-scroll">
              {favorites.map((f) => (
                <button key={f.contractAddress} type="button" className="wx-side-row" onClick={() => go(f)}>
                  <TokenIcon contractAddress={f.contractAddress} imageUrl={f.tokenImageUrl} symbol={f.keyword} size={36} />
                  <span className="mid">
                    <strong>{f.keyword}</strong>
                  </span>
                  <Bookmark size={14} fill="currentColor" color="var(--accent)" />
                </button>
              ))}
            </div>
          ) : (
            <div className="wx-empty small"><span>Bookmark a token to keep it here.</span></div>
          ))}
      </div>
    </>
  );

  if (isEvm) {
    return (
      <ToastProvider>
        <div className="wraith-dashboard wraith-token-page wx-page">
          <Header onSelectMeme={go} />
          <EvmTokenView address={address} sidebar={sidebar} />
        </div>
      </ToastProvider>
    );
  }

  if (!validMint) {
    return (
      <ToastProvider>
        <div className="wraith-dashboard wx-page">
          <Header onSelectMeme={go} />
          <div className="wx-empty" style={{ flex: 1 }}>
            <strong>That isn&apos;t a valid token address</strong>
            <span>Check the link, or pick a token from the market.</span>
            <button type="button" className="wx-btn primary" onClick={() => router.push("/app")}>Back to market</button>
          </div>
        </div>
      </ToastProvider>
    );
  }

  if (!meme || isMobile === null) return <div className="wraith-dashboard wx-page" />;


  return (
    <ToastProvider>
      <div className="wraith-dashboard wraith-token-page wx-page">
        <Header onSelectMeme={go} />

        {isMobile ? (
          <>
            <div className="wx-mobile-body">
              <div style={{ display: mobileTab === "chart" ? "block" : "none", height: "100%" }}>
                <TokenPanel selectedMeme={meme} />
              </div>
              <div style={{ display: mobileTab === "trade" ? "block" : "none", height: "100%" }}>
                <TokenTradeDock meme={meme} />
              </div>
              <div style={{ display: mobileTab === "market" ? "flex" : "none", height: "100%", flexDirection: "column" }}>{sidebar}</div>
            </div>
            <nav className="wx-mobile-nav" aria-label="Token sections">
              {(
                [
                  ["chart", "Chart", <Activity key="c" size={18} />],
                  ["trade", "Trade", <Wallet key="t" size={18} />],
                  ["market", "Market", <Flame key="m" size={18} />],
                ] as const
              ).map(([key, label, icon]) => (
                <button key={key} type="button" className={mobileTab === key ? "on" : ""} onClick={() => setMobileTab(key)}>
                  {icon}
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </>
        ) : (
          <div className="wx-workspace">
            <aside className="wx-sidebar">{sidebar}</aside>
            <div className="wx-center">
              <TokenPanel selectedMeme={meme} />
            </div>
            <aside className="wx-dock">
              <TokenTradeDock meme={meme} />
            </aside>
          </div>
        )}
      </div>
    </ToastProvider>
  );
}
