"use client";

// components/TokenBoard.tsx
// Discover board — pump.fun-style cards or Fomo-style dense table.
// Click a token to open its workspace (chart + trade dock).

import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, List, RefreshCw, Search } from "lucide-react";
import type { MemeTrend } from "@/app/app/page";
import { useMarket } from "@/hooks/useMarket";
import {
  changeColor,
  fmtAge,
  fmtCount,
  fmtPct,
  fmtUsd,
  MARKET_CATEGORIES,
  type MarketCategory,
  type MarketToken,
} from "@/lib/market";
import { toMeme } from "@/lib/tokenMeme";
import { prefetchChart } from "@/lib/prefetchChart";
import { TokenIcon } from "@/components/TokenIcon";
import { QuickBuyButton } from "@/components/QuickBuyButton";
import { getActivePreset } from "@/lib/quickBuyPresets";

type View = "grid" | "list";

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function Change({ v }: { v: number | null }) {
  return <b style={{ color: changeColor(v) }}>{fmtPct(v)}</b>;
}

// Every card gets the same bar slot so rows line up: bonding-curve progress for
// curve tokens, otherwise a buy/sell pressure split from recent transactions.
function CardBar({ token }: { token: MarketToken }) {
  if (token.onCurve && token.curveProgress != null) {
    const pct = Math.round(token.curveProgress * 100);
    return (
      <div className="wx-curve-mini" title="Estimated bonding-curve progress">
        <div className="wx-bar"><i style={{ width: `${Math.max(3, pct)}%` }} /></div>
        <span>{pct}%</span>
      </div>
    );
  }
  const { buys, sells } = token.txns;
  const total = buys + sells;
  const buyPct = total > 0 ? Math.round((buys / total) * 100) : null;
  return (
    <div className="wx-pressure" title="Buy vs sell transactions">
      <div className="wx-pressure-bar">
        {buyPct !== null && (<><i className="buy" style={{ width: `${buyPct}%` }} /><i className="sell" style={{ width: `${100 - buyPct}%` }} /></>)}
      </div>
      <span className={buyPct !== null && buyPct < 50 ? "sell" : "buy"}>{buyPct !== null ? `${buyPct}% buys` : "No txns"}</span>
    </div>
  );
}

// Sanitize name: skip tokens whose symbol/name is clearly garbage data.
function safeName(name: string, symbol: string): string {
  if (!name || name === "?" || /^\[/.test(name)) return symbol;
  return name;
}

function Card({ token, onOpen, quickSol }: { token: MarketToken; onOpen: () => void; quickSol: number }) {
  return (
    <div
      className="wx-tcard"
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onMouseEnter={() => prefetchChart(token.address, token.onCurve)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="wx-tcard-top">
        <TokenIcon contractAddress={token.address} imageUrl={token.imageUrl} symbol={token.symbol} size={52} />
        <div className="wx-tcard-id">
          <div className="wx-tcard-sym">
            <strong>{token.symbol}</strong>
            {token.graduated && <span className="wx-badge">Graduated</span>}
            {token.onCurve && <span className="wx-badge accent">Curve</span>}
          </div>
          <span className="wx-tcard-name">{safeName(token.name, token.symbol)}</span>
        </div>
        <span className="wx-tcard-age">{fmtAge(token.createdAt)}</span>
      </div>

      <div className="wx-tcard-mc">
        <div>
          <span className="wx-kicker">Market cap</span>
          <strong>{fmtUsd(token.mcap, { decimals: 1 })}</strong>
        </div>
        <div className="wx-tcard-chg" style={{ color: changeColor(token.change.h1) }}>
          {fmtPct(token.change.h1)}
          <small>1h</small>
        </div>
      </div>

      <CardBar token={token} />

      <div className="wx-tcard-meta">
        <span>Vol <b>{fmtUsd(token.volume.h24)}</b></span>
        <span>Liq <b>{fmtUsd(token.liquidity)}</b></span>
        <span className="wx-qb" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <QuickBuyButton contractAddress={token.address} symbol={token.symbol} amountSol={quickSol} size="compact" />
        </span>
      </div>
    </div>
  );
}

function Row({ token, onOpen }: { token: MarketToken; onOpen: () => void }) {
  return (
    <button type="button" className="wx-trow" onClick={onOpen} onMouseEnter={() => prefetchChart(token.address, token.onCurve)}>
      <span className="wx-trow-id">
        <TokenIcon contractAddress={token.address} imageUrl={token.imageUrl} symbol={token.symbol} size={34} />
        <span>
          <strong>{token.symbol}</strong>
          <small>{safeName(token.name, token.symbol)}</small>
        </span>
      </span>
      <span className="c-age">{fmtAge(token.createdAt)}</span>
      <span><b>{fmtUsd(token.mcap)}</b></span>
      <span className="c-liq">{fmtUsd(token.liquidity)}</span>
      <span className="c-vol">{fmtUsd(token.volume.h24)}</span>
      <span className="c-5m"><Change v={token.change.m5} /></span>
      <span><Change v={token.change.h1} /></span>
      <span className="c-24h"><Change v={token.change.h24} /></span>
      <span className="c-tx">{fmtCount(token.txns.buys + token.txns.sells)}</span>
    </button>
  );
}

export default function TokenBoard({ onSelectMeme }: { onSelectMeme: (meme: MemeTrend) => void }) {
  const [category, setCategory] = useState<MarketCategory>("trending");
  const [view, setView] = useState<View>("grid");
  const [query, setQuery] = useState("");
  const [hideThin, setHideThin] = useState(true);
  const { tokens, loading, error, stale, updatedAt, refresh } = useMarket(category);
  const [, setNow] = useState(0);
  const [quickSol, setQuickSol] = useState(0.1);

  useEffect(() => {
    setCategory(readPref("wraith_board_cat", MARKET_CATEGORIES.map((c) => c.key), "trending"));
    setView(readPref("wraith_board_view", ["grid", "list"] as const, "grid"));
  }, []);
  useEffect(() => {
    const syncPreset = () => setQuickSol(getActivePreset().amounts[0] || 0.1);
    syncPreset();
    window.addEventListener("storage", syncPreset);
    return () => window.removeEventListener("storage", syncPreset);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tokens.filter((t) => {
      // Always filter [invalid] symbols regardless of other settings.
      if (!t.symbol || t.symbol === "?" || /^\[/.test(t.symbol)) return false;
      // Dead-token filter: require real liquidity AND some trading activity.
      if (hideThin && !t.onCurve) {
        if (t.liquidity < 8000) return false;
        if (t.volume.h24 === 0 && t.txns.buys + t.txns.sells === 0) return false;
      }
      if (!q) return true;
      return t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase() === q;
    });
  }, [tokens, query, hideThin]);

  const secondsAgo = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;

  return (
    <section className="wx-board">
      <div className="wx-board-bar">
        <div className="wx-seg lg" role="tablist" aria-label="Market category">
          {MARKET_CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={category === c.key}
              className={category === c.key ? "on" : ""}
              onClick={() => {
                setCategory(c.key);
                try { localStorage.setItem("wraith_board_cat", c.key); } catch { /* ignore */ }
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <label className="wx-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, ticker or address"
            aria-label="Filter tokens"
          />
        </label>

        <label className="wx-check" title="Hide tokens with under $5K liquidity (bonding-curve tokens always shown)">
          <input type="checkbox" checked={hideThin} onChange={(e) => setHideThin(e.target.checked)} />
          <span>Hide thin liquidity</span>
        </label>

        <div style={{ flex: 1 }} />

        <span className="wx-live">
          <i className={stale ? "stale" : ""} />
          {stale ? "Delayed" : "Live"}
          {secondsAgo !== null && <small> · {secondsAgo}s</small>}
        </span>

        <div className="wx-seg" aria-label="View">
          <button type="button" className={view === "grid" ? "on" : ""} onClick={() => { setView("grid"); try { localStorage.setItem("wraith_board_view", "grid"); } catch { /* ignore */ } }} aria-label="Card view" title="Cards">
            <LayoutGrid size={14} />
          </button>
          <button type="button" className={view === "list" ? "on" : ""} onClick={() => { setView("list"); try { localStorage.setItem("wraith_board_view", "list"); } catch { /* ignore */ } }} aria-label="Table view" title="Table">
            <List size={14} />
          </button>
        </div>
        <button type="button" className="wx-icon-btn" onClick={refresh} aria-label="Refresh" title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="wx-board-body">
        {loading && !tokens.length ? (
          <div className={view === "grid" ? "wx-grid" : "wx-table"}>
            {Array.from({ length: view === "grid" ? 12 : 14 }).map((_, i) => (
              <div key={i} className="wx-skel" style={{ height: view === "grid" ? 168 : 56, borderRadius: 14 }} />
            ))}
          </div>
        ) : error && !tokens.length ? (
          <div className="wx-empty">
            <strong>Market data unavailable</strong>
            <span>{error}</span>
            <button type="button" className="wx-btn primary" onClick={refresh}>
              <RefreshCw size={13} /> Try again
            </button>
          </div>
        ) : !shown.length ? (
          <div className="wx-empty">
            <strong>{query ? "No matches" : "Nothing here yet"}</strong>
            <span>{query ? "Try a different search, or clear the filter." : "New tokens appear here as soon as the providers index them."}</span>
          </div>
        ) : view === "grid" ? (
          <div className="wx-grid">
            {shown.map((t) => (
              <Card key={t.address} token={t} quickSol={quickSol} onOpen={() => onSelectMeme(toMeme(t))} />
            ))}
          </div>
        ) : (
          <div className="wx-table" role="table">
            <div className="wx-trow head" role="row">
              <span>Token</span>
              <span className="c-age">Age</span>
              <span>MCap</span>
              <span className="c-liq">Liq</span>
              <span className="c-vol">Vol 24h</span>
              <span className="c-5m">5m</span>
              <span>1h</span>
              <span className="c-24h">24h</span>
              <span className="c-tx">Txns</span>
            </div>
            {shown.map((t) => (
              <Row key={t.address} token={t} onOpen={() => onSelectMeme(toMeme(t))} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
