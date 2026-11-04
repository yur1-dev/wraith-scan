"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { UsersRound, WifiOff } from "lucide-react";
import TraderFollowButton from "@/components/TraderFollowButton";
import XBadge from "@/components/XBadge";
import { useCash } from "@/lib/cash";
import { readLast, writeLast } from "@/lib/lastGood";

type Trader = {
  userId: string;
  displayName: string;
  username?: string | null;
  xHandle?: string;
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

type Saved = { following: Trader[]; suggestions: Trader[] };

export default function FollowingSidebar() {
  const [following, setFollowing] = useState<Trader[]>([]);
  const [suggestions, setSuggestions] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const { money } = useCash();

  const refresh = useCallback(async () => {
    try {
      const [followed, top] = await Promise.all([
        loadTraders("/api/traders?following=1"),
        loadTraders("/api/traders"),
      ]);
      const followedIds = new Set(followed.map((trader) => trader.userId));
      const next = top.filter((trader) => !followedIds.has(trader.userId)).slice(0, 10);
      setFollowing(followed);
      setSuggestions(next);
      setStale(false);
      writeLast("following", { following: followed, suggestions: next } satisfies Saved);
    } catch {
      // offline or the server hiccuped: keep what is on screen and flag it
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = readLast<Saved>("following");
    if (saved) { setFollowing(saved.following); setSuggestions(saved.suggestions); setLoading(false); }
    void refresh();
    const online = () => void refresh();
    window.addEventListener("online", online);
    window.addEventListener("wraith:refresh", online);
    return () => { window.removeEventListener("online", online); window.removeEventListener("wraith:refresh", online); };
  }, [refresh]);

  const changed = (trader: Trader, isFollowing: boolean) => {
    setFollowing((current) => isFollowing
      ? [trader, ...current.filter((item) => item.userId !== trader.userId)]
      : current.filter((item) => item.userId !== trader.userId));
    if (isFollowing) setSuggestions((current) => current.filter((item) => item.userId !== trader.userId));
    else setSuggestions((current) => [trader, ...current].slice(0, 10));
  };

  const row = (trader: Trader, followed: boolean) => {
    const pnl = money(trader.profitSol, true);
    const tone = trader.profitSol > 0 ? "up" : trader.profitSol < 0 ? "down" : "";
    return (
      <div key={trader.userId} className="wx-trader-row">
        <Link href={`/app/u/${encodeURIComponent(trader.userId)}`} className="wx-trader-main">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {trader.avatarDataUrl ? <img src={trader.avatarDataUrl} alt="" className="wx-trader-av" /> : <span className="wx-trader-av fallback">{trader.displayName.slice(0, 1).toUpperCase()}</span>}
          <span className="wx-trader-text">
            <strong>{trader.displayName}<XBadge handle={trader.xHandle} size={11} /></strong>
            <small>
              {trader.username ? <span className="wx-trader-handle">@{trader.username}</span> : null}
              {trader.username ? <i>·</i> : null}
              <b className={tone}>{pnl}</b>
              <i>·</i>{trader.closedTradeCount} closed
            </small>
          </span>
        </Link>
        <TraderFollowButton traderId={trader.userId} initialFollowing={followed} statusKnown onChange={(next) => changed(trader, next)} compact />
      </div>
    );
  };

  const label: React.CSSProperties = { padding: "14px 14px 6px", color: "var(--text-muted)", fontSize: 10, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" };

  return (
    <section style={{ height: "100%", overflowY: "auto", color: "var(--text)" }}>
      <header style={{ padding: "14px 14px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
        <UsersRound size={15} color="var(--orange-hot)" />
        <strong style={{ fontSize: 14 }}>Traders</strong>
        {stale && <span title="Showing the last saved list" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontSize: 11 }}><WifiOff size={12} /> offline</span>}
      </header>
      {loading ? (
        <div style={{ padding: 14, display: "grid", gap: 10 }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="wx-skel" style={{ height: 52, borderRadius: 12 }} />)}
        </div>
      ) : (
        <>
          {following.length > 0 && (
            <>
              <div style={label}>Following · {following.length}</div>
              {following.map((trader) => row(trader, true))}
            </>
          )}
          <div style={label}>{following.length ? "Suggested" : "Top traders"}</div>
          {suggestions.length ? suggestions.map((trader) => row(trader, false)) : (
            <div style={{ padding: "14px 16px 20px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
              {following.length ? "You follow everyone on the leaderboard." : "No public traders yet. They show up here once they turn on public trading."}
            </div>
          )}
          {suggestions.length > 0 && <Link href="/app/traders" style={{ display: "block", padding: 14, color: "var(--orange-hot)", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>Browse all traders →</Link>}
        </>
      )}
    </section>
  );
}
