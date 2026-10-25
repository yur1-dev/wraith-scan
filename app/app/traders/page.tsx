"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Users } from "lucide-react";
import Header from "@/components/Header";
import TraderFollowButton from "@/components/TraderFollowButton";

type Trader = {
  userId: string;
  displayName: string;
  bio: string;
  xHandle: string;
  avatarDataUrl: string;
  closedTradeCount: number;
  openPositionCount: number;
  profitSol: number;
  openPositions: {
    symbol?: string;
    mint?: string;
  }[];
};

function formatSol(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)} SOL`;
}

export default function TradersPage() {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/traders")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not load traders.");
        }
        if (active) setTraders(payload.traders ?? []);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Could not load traders.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="wraith-dashboard profile-page">
      <Header />
      <div className="profile-shell traders-shell">
        <section className="traders-heading">
          <span className="profile-eyebrow">WRAITH COMMUNITY</span>
          <h1>Traders</h1>
          <p>See open positions and recent closes from traders who opted in.</p>
        </section>
        {error && <div className="profile-message is-error">{error}</div>}
        {loading ? (
          <div className="traders-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="trader-card trader-card-skeleton" key={index} />
            ))}
          </div>
        ) : traders.length ? (
          <div className="traders-grid">
            {traders.map((trader, index) => (
              <article
                className="trader-card"
                key={trader.userId}
              >
                <div className="trader-card-top">
                  <span className="trader-rank">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {trader.avatarDataUrl ? (
                    <Image
                      className="trader-avatar"
                      src={trader.avatarDataUrl}
                      alt=""
                      width={48}
                      height={48}
                      unoptimized
                    />
                  ) : (
                    <span className="trader-avatar trader-avatar-fallback">
                      {trader.displayName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <Link className="trader-card-name" href={`/app/u/${encodeURIComponent(trader.userId)}`} style={{ color: "inherit", textDecoration: "none" }}>
                    <strong>{trader.displayName}</strong>
                    {trader.xHandle ? <small>@{trader.xHandle}</small> : null}
                  </Link>
                  <Link href={`/app/u/${encodeURIComponent(trader.userId)}`} aria-label={`View ${trader.displayName}`} style={{ display: "grid", placeItems: "center", color: "var(--text-muted)" }}><ArrowUpRight size={17} /></Link>
                </div>
                <p>{trader.bio || "WRAITH trader"}</p>
                <div className="trader-card-stats">
                  <div>
                    <span>REALIZED P&L</span>
                    <strong className={trader.profitSol >= 0 ? "is-positive" : "is-negative"}>
                      {formatSol(trader.profitSol)}
                    </strong>
                  </div>
                  <div>
                    <span>OPEN</span>
                    <strong>{trader.openPositionCount}</strong>
                  </div>
                  <div>
                    <span>CLOSED</span>
                    <strong>{trader.closedTradeCount}</strong>
                  </div>
                </div>
                {trader.openPositions.length > 0 ? (
                  <div className="trader-card-open">
                    <span>OPEN NOW</span>
                    {trader.openPositions.slice(0, 3).map((position) => (
                      <span key={position.mint}>
                        {position.symbol || "Token"}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="trader-card-open is-empty">
                    <Users size={13} /> No public open positions
                  </div>
                )}
                <div style={{ marginTop: 14 }}><TraderFollowButton traderId={trader.userId} compact /></div>
              </article>
            ))}
          </div>
        ) : (
          <div className="profile-panel traders-empty">
            <Users size={22} />
            <h2>No public trader profiles yet</h2>
            <p>
              Turn on “Share my trading activity” in your profile settings to
              appear here.
            </p>
            <Link href="/app/profile">Open my profile</Link>
          </div>
        )}
      </div>
    </main>
  );
}
