"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import Header from "@/components/Header";
import TraderFollowButton from "@/components/TraderFollowButton";
import PhotoViewer from "@/components/PhotoViewer";
import Radar from "@/components/Radar";
import { useCash } from "@/lib/cash";
import { fmtHold, fmtMult, type TraderStatsResult } from "@/lib/traderStats";

type Trader = {
  userId: string;
  username?: string | null;
  displayName: string;
  bio: string;
  xHandle: string;
  avatarDataUrl: string;
  closedTradeCount: number;
  openPositionCount: number;
  profitSol: number;
  stats?: TraderStatsResult;
  openPositions: {
    symbol?: string;
    mint?: string;
  }[];
};

type Period = "d1" | "d7" | "d30" | "all";
const PERIODS: { key: Period; label: string; long: string }[] = [
  { key: "d1", label: "24H", long: "Daily" },
  { key: "d7", label: "7D", long: "Weekly" },
  { key: "d30", label: "30D", long: "Monthly" },
  { key: "all", label: "All", long: "All-time" },
];

function Spark({ curve }: { curve: number[] }) {
  if (curve.length < 2) return <svg className="tc-spark tone-flat" viewBox="0 0 100 28" preserveAspectRatio="none"><line x1="0" x2="100" y1="14" y2="14" /></svg>;
  const min = Math.min(...curve), max = Math.max(...curve);
  const span = max - min || 1;
  const pts = curve.map((v, i) => `${(i / (curve.length - 1)) * 100},${26 - ((v - min) / span) * 24}`).join(" ");
  const tone = curve[curve.length - 1] >= 0 ? "up" : "down";
  return (
    <svg className={`tc-spark tone-${tone}`} viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function TradersPage() {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<"pnl" | "active" | "open">("pnl");
  const [period, setPeriod] = useState<Period>("d7");
  const [viewer, setViewer] = useState<string | null>(null);
  const { money } = useCash();

  const gain = (t: Trader, p: Period) => t.stats?.pnlSol[p] ?? (p === "all" ? t.profitSol : 0);

  const sorted = useMemo(() => {
    const list = [...traders];
    if (sort === "active") list.sort((a, b) => b.closedTradeCount + b.openPositionCount - (a.closedTradeCount + a.openPositionCount));
    else if (sort === "open") list.sort((a, b) => b.openPositionCount - a.openPositionCount || gain(b, period) - gain(a, period));
    else list.sort((a, b) => gain(b, period) - gain(a, period));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traders, sort, period]);

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

  const periodMeta = PERIODS.find((p) => p.key === period)!;

  return (
    <main className="wraith-dashboard profile-page">
      <Header />
      <div className="profile-shell traders-shell">
        <section className="traders-heading">
          <span className="profile-eyebrow">WRAITH COMMUNITY</span>
          <h1>{periodMeta.long} ranking</h1>
          <p>Who is making money, and what they are good at.</p>
          <div className="tc-periods" role="tablist" aria-label="Ranking period">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" role="tab" aria-selected={period === p.key} className={period === p.key ? "on" : ""} onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="trader-tabs" role="tablist">
            {([["pnl", "Top gains"], ["active", "Most active"], ["open", "Live now"]] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={sort === key} className={sort === key ? "on" : ""} onClick={() => setSort(key)}>{label}</button>
            ))}
          </div>
        </section>
        {viewer && <PhotoViewer src={viewer} onClose={() => setViewer(null)} />}
        {error && <div className="profile-message is-error">{error}</div>}
        {loading ? (
          <div className="traders-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="trader-card trader-card-skeleton" key={index} />
            ))}
          </div>
        ) : traders.length ? (
          <div className="traders-grid">
            {sorted.map((trader, index) => {
              const s = trader.stats;
              const pnl = gain(trader, period);
              const tone = pnl > 0 ? "up" : pnl < 0 ? "down" : "flat";
              const podium = index < 3 && sort === "pnl" && pnl > 0 ? ` podium-${index + 1}` : "";
              return (
                <article className={`tc${podium}`} key={trader.userId}>
                  <div className="tc-main">
                    <span className="tc-rank">{index + 1}</span>
                    {trader.avatarDataUrl ? (
                      <Image className="tc-avatar wx-tappable" src={trader.avatarDataUrl} alt="" width={46} height={46} unoptimized onClick={() => setViewer(trader.avatarDataUrl)} />
                    ) : (
                      <span className="tc-avatar tc-avatar-fallback">{trader.displayName.slice(0, 1).toUpperCase()}</span>
                    )}
                    <Link className="tc-id" href={`/app/u/${encodeURIComponent(trader.username ?? trader.userId)}`}>
                      <strong>{trader.displayName}</strong>
                      <span className="tc-tags">
                        {(s?.tags.length ? s.tags : ["Unrated"]).map((t) => (
                          <i key={t}>{t}</i>
                        ))}
                      </span>
                    </Link>
                    <span className="trader-follow"><TraderFollowButton traderId={trader.userId} compact /></span>
                  </div>

                  <div className="tc-body">
                    <div className="tc-pnl">
                      <small>{periodMeta.label} GAIN</small>
                      <strong className={tone}>{money(pnl, true)}</strong>
                      <Spark curve={s?.curve ?? []} />
                    </div>
                    <Radar values={s?.radar.map((p) => p.value) ?? [0, 0, 0, 0, 0, 0]} size={92} />
                  </div>

                  <div className="tc-gains">
                    {PERIODS.filter((p) => p.key !== "all").map((p) => {
                      const v = gain(trader, p.key);
                      return (
                        <span key={p.key} className={p.key === period ? "on" : ""}>
                          <small>{p.label}</small>
                          <b className={v > 0 ? "up" : v < 0 ? "down" : ""}>{money(v, true)}</b>
                        </span>
                      );
                    })}
                  </div>

                  <div className="tc-foot">
                    <span><small>WIN</small><b>{s?.winRate == null ? "-" : `${s.winRate.toFixed(0)}%`}</b></span>
                    <span><small>TRADES</small><b>{trader.closedTradeCount}</b></span>
                    <span><small>BEST</small><b>{s && s.bestPct > 0 ? fmtMult(s.bestPct) : "-"}</b></span>
                    <span><small>HOLD</small><b>{fmtHold(s?.avgHoldMs ?? null)}</b></span>
                  </div>

                  {trader.openPositions.length > 0 && (
                    <div className="tc-live">
                      <i className="tc-live-dot" />
                      <span>LIVE</span>
                      {trader.openPositions.slice(0, 3).map((position) => (
                        <em key={position.mint}>{position.symbol || "Token"}</em>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
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
