"use client";

// components/SignalScanner.tsx
// Fast scanner: ranks live tokens across every Wraith chain by momentum, volume pressure, buy/sell
// balance, liquidity health and freshness. No AI or social calls — it polls one
// cached endpoint, so it is quick and cheap. The old AI/celeb scan is still
// available behind "Deep scan".

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Flame, LayoutGrid, List, Radar, RefreshCw, Sparkles, Zap } from "lucide-react";
import type { MemeTrend } from "@/app/app/page";
import { changeColor, fmtAge, fmtPct, fmtUsd, type MarketToken } from "@/lib/market";
import { toMeme } from "@/lib/tokenMeme";
import { TokenIcon } from "@/components/TokenIcon";
import ChainLogo from "@/components/ChainLogo";
import { CHAINS } from "@/lib/chains";

const chainName = (k?: string) => (!k || k === "solana" ? "Solana" : CHAINS[k]?.name ?? k);

interface Signal {
  token: MarketToken;
  score: number;
  tier: "HOT" | "WATCH";
  tags: string[];
  risks: string[];
}

type Filter = "all" | "hot" | "fresh" | "volume" | "safe";
type RailTab = "top" | "traction" | "early";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "hot", label: "Top picks" },
  { key: "fresh", label: "Fresh" },
  { key: "volume", label: "Volume" },
  { key: "safe", label: "Safer" },
];

function useSignals() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/signals", { cache: "no-store" });
      const data: { signals?: Signal[]; updatedAt?: number; error?: string } = await res.json();
      if (Array.isArray(data.signals) && data.signals.length) {
        setSignals(data.signals);
        setUpdatedAt(data.updatedAt ?? Date.now());
        setError("");
      } else if (!res.ok) {
        setError(data.error || "Signal sources are slow right now.");
      } else {
        setSignals([]);
        setUpdatedAt(data.updatedAt ?? Date.now());
      }
    } catch {
      setError("Could not reach the signal feed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      t = setTimeout(() => {
        void load();
        tick();
      }, document.hidden ? 60_000 : 20_000);
    };
    tick();
    return () => clearTimeout(t);
  }, [load]);

  return { signals, loading, error, updatedAt, reload: load };
}

function ScoreRing({ score, tier }: { score: number; tier: "HOT" | "WATCH" }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <div className={`sg-ring ${tier === "HOT" ? "hot" : "watch"}`} title={`Signal score ${score}/100`}>
      <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
        <circle cx="19" cy="19" r={r} fill="none" stroke="currentColor" strokeOpacity="0.16" strokeWidth="3" />
        <circle cx="19" cy="19" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 19 19)" />
      </svg>
      <b>{score}</b>
    </div>
  );
}

function Card({ s, onOpen }: { s: Signal; onOpen: () => void }) {
  const t = s.token;
  return (
    <div className="sg-card" role="link" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
      <div className="sg-card-top">
        <TokenIcon contractAddress={t.address} imageUrl={t.imageUrl} symbol={t.symbol} size={44} />
        <div className="sg-id">
          <strong>{t.symbol}</strong>
          <span><ChainLogo chain={t.chain ?? "solana"} size={13} /> {t.name && t.name !== t.symbol ? t.name : t.dex ?? chainName(t.chain)}</span>
        </div>
        <ScoreRing score={s.score} tier={s.tier} />
      </div>
      <div className="sg-metrics">
        <div><small>MCap</small><b>{fmtUsd(t.mcap)}</b></div>
        <div><small>1h</small><b style={{ color: changeColor(t.change.h1) }}>{fmtPct(t.change.h1)}</b></div>
        <div><small>Vol 1h</small><b>{fmtUsd(t.volume.h1)}</b></div>
        <div><small>Liq</small><b>{fmtUsd(t.liquidity)}</b></div>
        <div><small>Age</small><b>{t.createdAt ? fmtAge(t.createdAt) : "—"}</b></div>
      </div>
      <div className="sg-tags">
        {s.tags.map((x) => <span key={x} className="sg-tag">{x}</span>)}
        {s.risks.map((x) => <span key={x} className="sg-tag risk">{x}</span>)}
      </div>
    </div>
  );
}

function ListRow({ s, onOpen }: { s: Signal; onOpen: () => void }) {
  const t = s.token;
  return (
    <div className="wx-trow sg-trow" role="link" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
      <span className="wx-trow-id">
        <TokenIcon contractAddress={t.address} imageUrl={t.imageUrl} symbol={t.symbol} size={32} />
        <span>
          <strong>{t.symbol}</strong>
          <small><ChainLogo chain={t.chain ?? "solana"} size={12} /> {s.tags[0] ?? (t.name && t.name !== t.symbol ? t.name : chainName(t.chain))}</small>
        </span>
      </span>
      <b className={s.tier === "HOT" ? "sg-score hot" : "sg-score"}>{s.score}</b>
      <span>{fmtUsd(t.mcap)}</span>
      <span style={{ color: changeColor(t.change.h1) }}>{fmtPct(t.change.h1)}</span>
      <span className="c-vol">{fmtUsd(t.volume.h1)}</span>
      <span className="c-liq">{fmtUsd(t.liquidity)}</span>
      <span className="c-age">{t.createdAt ? fmtAge(t.createdAt) : "—"}</span>
    </div>
  );
}

function RailRow({ s, onOpen }: { s: Signal; onOpen: () => void }) {
  const t = s.token;
  return (
    <button type="button" className="sg-rail-row" onClick={onOpen}>
      <TokenIcon contractAddress={t.address} imageUrl={t.imageUrl} symbol={t.symbol} size={34} />
      <span className="mid">
        <strong>{t.symbol}</strong>
        <small><ChainLogo chain={t.chain ?? "solana"} size={12} /> {s.tags[0] ?? "Momentum"} · {fmtUsd(t.mcap)}</small>
      </span>
      <span className="end">
        <b className={s.tier === "HOT" ? "hot" : "watch"}>{s.score}</b>
        <small style={{ color: changeColor(t.change.h1) }}>{fmtPct(t.change.h1)}</small>
      </span>
    </button>
  );
}

export default function SignalScanner({
  onSelectMeme,
  deepScan,
}: {
  onSelectMeme: (meme: MemeTrend) => void;
  deepScan: ReactNode;
}) {
  const { signals, loading, error, updatedAt, reload } = useSignals();
  const [filter, setFilter] = useState<Filter>("all");
  const [railTab, setRailTab] = useState<RailTab>("top");
  const [chainFilter, setChainFilter] = useState<string>("all");
  const [deep, setDeep] = useState(false);
  const [view, setViewState] = useState<"grid" | "list">("grid");
  useEffect(() => {
    try { if (localStorage.getItem("wraith_board_view") === "list") setViewState("list"); } catch { /* ignore */ }
  }, []);
  const setView = (v: "grid" | "list") => {
    setViewState(v);
    try { localStorage.setItem("wraith_board_view", v); } catch { /* ignore */ }
  };
  const [, force] = useState(0);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const byChain = useMemo(() => (chainFilter === "all" ? signals : signals.filter((s) => (s.token.chain ?? "solana") === chainFilter)), [signals, chainFilter]);
  const chainCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of signals) m.set(s.token.chain ?? "solana", (m.get(s.token.chain ?? "solana") ?? 0) + 1);
    return m;
  }, [signals]);

  const shown = useMemo(() => {
    const signals = byChain;
    switch (filter) {
      case "hot": return signals.filter((s) => s.tier === "HOT");
      case "fresh": return signals.filter((s) => s.tags.includes("Fresh") || s.tags.includes("New today"));
      case "volume": return signals.filter((s) => s.tags.includes("Volume surge"));
      case "safe": return signals.filter((s) => s.risks.length === 0 && s.token.liquidity >= 15_000);
      default: return signals;
    }
  }, [byChain, filter]);

  const railList = useMemo(() => {
    const signals = byChain;
    const list =
      railTab === "traction"
        ? signals.filter((s) => s.tags.includes("Volume surge") || s.tags.includes("Buy pressure"))
        : railTab === "early"
          ? signals.filter((s) => s.tags.includes("Fresh") || s.tags.includes("New today"))
          : signals;
    return list.slice(0, 14);
  }, [byChain, railTab]);

  const open = (s: Signal) => onSelectMeme(toMeme(s.token));
  const secondsAgo = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;
  const hotCount = signals.filter((s) => s.tier === "HOT").length;

  return (
    <>
      <aside className="wx-scanner-rail sg-rail">
        <header className="sg-rail-head">
          <div className="sg-rail-title"><span className="sg-dot" />Live signals</div>
          <span className="sg-count">{signals.length}</span>
        </header>
        <div className="sg-rail-tabs" role="tablist">
          {([["top", "For you"], ["traction", "Traction"], ["early", "Early"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={railTab === k} className={railTab === k ? "on" : ""} onClick={() => setRailTab(k)}>{label}</button>
          ))}
        </div>
        <p className="sg-rail-note">Ranked by volume pressure, momentum, buy/sell balance, liquidity and age. Research leads, not guaranteed outcomes.</p>
        <div className="sg-rail-list">
          {loading && !signals.length
            ? Array.from({ length: 7 }).map((_, i) => <div key={i} className="wx-skel" style={{ height: 52, margin: "6px 12px", borderRadius: 12 }} />)
            : railList.length
              ? railList.map((s) => <RailRow key={s.token.address} s={s} onOpen={() => open(s)} />)
              : <div className="wx-empty small"><span>{error || "Nothing matches this view right now."}</span></div>}
        </div>
      </aside>

      <div className="wx-scanner-main sg-main">
        <header className="sg-head">
          <div>
            <div className="sg-title"><Radar size={15} /> Discover <span className="sg-live"><i />{error && !signals.length ? "Offline" : "Live"}</span></div>
            <p>{signals.length ? `${signals.length} scored · ${hotCount} top picks${secondsAgo !== null ? ` · updated ${secondsAgo}s ago` : ""}` : loading ? "Scoring live markets…" : "No tokens passed the filters yet."}</p>
          </div>
          <div className="sg-head-actions">
            <div className="wx-seg" aria-label="View">
              <button type="button" className={view === "grid" ? "on" : ""} onClick={() => setView("grid")} aria-label="Card view" title="Cards"><LayoutGrid size={14} /></button>
              <button type="button" className={view === "list" ? "on" : ""} onClick={() => setView("list")} aria-label="Table view" title="Table"><List size={14} /></button>
            </div>
            <button type="button" className={`sg-btn${deep ? " on" : ""}`} onClick={() => setDeep((d) => !d)} title="Slower AI + celebrity/X scan. Uses API credits, so it only runs when you open it.">
              <Sparkles size={13} /> Deep scan
            </button>
            <button type="button" className="sg-btn primary" onClick={() => void reload()}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </header>

        {deep ? (
          <div className="sg-deep">{deepScan}</div>
        ) : (
          <>
            <div className="sg-filters sg-chains" role="tablist" aria-label="Chain">
              <button type="button" role="tab" aria-selected={chainFilter === "all"} className={chainFilter === "all" ? "on" : ""} onClick={() => setChainFilter("all")}>All chains</button>
              {["solana", ...Object.keys(CHAINS)].filter((k) => chainCounts.has(k)).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={chainFilter === k} className={chainFilter === k ? "on" : ""} onClick={() => setChainFilter(k)}>
                  <ChainLogo chain={k} size={14} />{chainName(k)} <small style={{ opacity: 0.6 }}>{chainCounts.get(k)}</small>
                </button>
              ))}
            </div>
            <div className="sg-filters" role="tablist" aria-label="Signal filters">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
                  {f.key === "hot" && <Flame size={12} />}{f.key === "fresh" && <Zap size={12} />}{f.label}
                </button>
              ))}
            </div>
            <div className="sg-body">
              {loading && !signals.length ? (
                <div className="sg-grid">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="wx-skel" style={{ height: 176, borderRadius: 16 }} />)}</div>
              ) : shown.length ? (
                view === "grid" ? (
                  <div className="sg-grid">{shown.map((s) => <Card key={s.token.address} s={s} onOpen={() => open(s)} />)}</div>
                ) : (
                  <div className="wx-table sg-table" role="table">
                    <div className="wx-trow sg-trow head" role="row">
                      <span>Token</span><span>Score</span><span>MCap</span><span>1h</span><span className="c-vol">Vol 1h</span><span className="c-liq">Liq</span><span className="c-age">Age</span>
                    </div>
                    {shown.map((s) => <ListRow key={s.token.address} s={s} onOpen={() => open(s)} />)}
                  </div>
                )
              ) : (
                <div className="wx-empty">
                  <strong>{error ? "Signal feed unavailable" : "No matches for this filter"}</strong>
                  <span>{error || "Try another filter. The feed refreshes every 20 seconds."}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
