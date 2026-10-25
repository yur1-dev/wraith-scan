"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, UsersRound } from "lucide-react";
import TraderFollowButton from "@/components/TraderFollowButton";

type Trader = {
  userId: string;
  displayName: string;
  bio?: string;
  avatarDataUrl?: string;
  closedTradeCount: number;
  openPositionCount: number;
  profitSol: number;
  isFollowing?: boolean;
};

async function loadTraders(url: string): Promise<Trader[]> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load traders.");
  return Array.isArray(data.traders) ? data.traders : [];
}

export default function FollowingSidebar() {
  const [following, setFollowing] = useState<Trader[]>([]);
  const [suggestions, setSuggestions] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [followed, top] = await Promise.all([
        loadTraders("/api/traders?following=1").catch(() => [] as Trader[]),
        loadTraders("/api/traders"),
      ]);
      setFollowing(followed);
      const followedIds = new Set(followed.map((trader) => trader.userId));
      setSuggestions(top.filter((trader) => !followedIds.has(trader.userId)).slice(0, 10));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load traders.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const changed = (trader: Trader, isFollowing: boolean) => {
    setFollowing((current) => isFollowing
      ? [trader, ...current.filter((item) => item.userId !== trader.userId)]
      : current.filter((item) => item.userId !== trader.userId));
    if (isFollowing) setSuggestions((current) => current.filter((item) => item.userId !== trader.userId));
    else setSuggestions((current) => [trader, ...current].slice(0, 10));
  };

  const row = (trader: Trader, followed: boolean, _index: number) => (
    <div key={trader.userId} className="wx-trader-row">
      <Link href={`/app/u/${encodeURIComponent(trader.userId)}`} className="wx-trader-main">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {trader.avatarDataUrl ? <img src={trader.avatarDataUrl} alt="" className="wx-trader-av" /> : <span className="wx-trader-av fallback">{trader.displayName.slice(0, 1).toUpperCase()}</span>}
        <span className="wx-trader-text">
          <strong>{trader.displayName}</strong>
          <small>
            <b className={trader.profitSol >= 0 ? "up" : "down"}>{trader.profitSol >= 0 ? "+" : ""}{trader.profitSol.toFixed(2)} SOL</b>
            <i>·</i>{trader.closedTradeCount} closed
          </small>
        </span>
      </Link>
      <TraderFollowButton traderId={trader.userId} initialFollowing={followed} statusKnown onChange={(next) => changed(trader, next)} compact />
    </div>
  );

  return (
    <section style={{ height: "100%", overflowY: "auto", color: "var(--text)" }}>
      <header style={{ padding: "15px 14px 13px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><UsersRound size={15} color="var(--orange-hot)" /><strong style={{ fontSize: 14 }}>Traders</strong></div>
        <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>Follow public Wraith traders to build your feed and keep their activity close.</p>
      </header>
      {loading ? <div style={{ padding: 18, color: "var(--text-muted)", fontSize: 12 }}>Finding traders…</div> : error ? <div style={{ padding: 18, color: "var(--text-muted)", fontSize: 12 }}>{error}<button type="button" onClick={() => void refresh()} style={{ marginLeft: 8, color: "var(--orange-hot)", border: 0, background: "transparent", cursor: "pointer" }}>Retry</button></div> : <>
        {following.length > 0 && <>
          <div style={{ padding: "13px 14px 5px", color: "var(--text-muted)", fontSize: 10, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" }}>Following · {following.length}</div>
          {following.map((trader, index) => row(trader, true, index))}
        </>}
        <div style={{ padding: "15px 14px 6px", color: "var(--text-muted)", fontSize: 10, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" }}>{following.length ? "Top traders to follow" : "Top 10 public traders"}</div>
        {suggestions.length ? suggestions.map((trader, index) => row(trader, false, index)) : <div style={{ padding: "20px 16px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>{following.length ? "You’re following everyone in the current top traders list." : "No public trader profiles yet. Traders appear here after they turn on public trading."}</div>}
        {suggestions.length > 0 && <Link href="/app/traders" style={{ display: "block", padding: 14, color: "var(--orange-hot)", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>Browse all traders →</Link>}
      </>}
    </section>
  );
}
