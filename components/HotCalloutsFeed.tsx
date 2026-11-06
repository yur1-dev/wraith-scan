"use client";

// Live feed of what traders are calling right now (public callouts, newest first).
// Keeps the last good list when the connection drops, can be paused, and never reflows while you read.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, WifiOff } from "lucide-react";
import XBadge from "@/components/XBadge";
import type { MemeTrend } from "@/app/app/page";
import { readLast, writeLast } from "@/lib/lastGood";
import { visibleInterval } from "@/lib/visibleInterval";

type Item = {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  xHandle?: string | null;
  avatarDataUrl: string;
  text: string;
  createdAt: number;
  mcapAtPost: number | null;
  hearts: number;
  reposts: number;
  comments: number;
  mint?: string;
  imageUrl?: string | null;
  position: { amountSol: number; entryMcap: number; currentMcap: number; currentPnlPct: number; symbol: string } | null;
};

const usd = (n?: number | null) => {
  if (!n || !Number.isFinite(n)) return "";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const ago = (ts: number) => {
  const m = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

export default function HotCalloutsFeed({ onSelectMeme }: { onSelectMeme: (meme: MemeTrend) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const load = useCallback(async () => {
    if (pausedRef.current) return;
    try {
      const r = await fetch("/api/callouts?limit=40", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      const list: Item[] = Array.isArray(j.callouts) ? j.callouts : [];
      setItems(list);
      setStale(false);
      writeLast("hot_callouts", list);
    } catch {
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = readLast<Item[]>("hot_callouts");
    if (saved?.length) { setItems(saved); setLoading(false); }
    void load();
    const t = visibleInterval(() => void load(), 15_000);
    const back = () => void load();
    window.addEventListener("online", back);
    return () => { window.clearInterval(t); window.removeEventListener("online", back); };
  }, [load]);

  const openToken = (c: Item) => {
    if (!c.mint) return;
    onSelectMeme({ keyword: c.position?.symbol || "TOKEN", score: 0, posts: 0, source: "callouts", contractAddress: c.mint, tokenImageUrl: c.imageUrl ?? undefined, mcap: c.position?.currentMcap });
  };

  return (
    <section className="hc-wrap" aria-label="Hot intel">
      <header className="hc-head">
        <strong>Hot intel</strong>
        <span className="hc-sub">Live calls from Wraith traders</span>
        {stale && <span className="hc-off" title="Showing the last saved list"><WifiOff size={12} /> offline</span>}
        <button type="button" className="hc-btn" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? "Paused" : "Live"}
        </button>
      </header>
      {loading ? (
        <div className="hc-list">{[0, 1, 2, 3].map((i) => <div key={i} className="wx-skel" style={{ height: 96, borderRadius: 14 }} />)}</div>
      ) : items.length === 0 ? (
        <div className="hc-empty">No intel yet. Post one from any token page and it shows up here.</div>
      ) : (
        <div className="hc-list">
          {items.map((c) => {
            const long = c.text.length > 180;
            const expanded = open.has(c.id);
            const pnl = c.position?.currentPnlPct;
            return (
              <article key={c.id} className="hc-card">
                <div className="hc-top">
                  {c.avatarDataUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.avatarDataUrl} alt="" className="hc-av" /> : <span className="hc-av fb">{c.displayName.slice(0, 1).toUpperCase()}</span>}
                  <Link href={`/app/u/${encodeURIComponent(c.username ?? c.userId)}`} className="hc-name">{c.displayName}</Link>
                  <XBadge handle={c.xHandle} />
                  <span className="hc-age">{ago(c.createdAt)}</span>
                  {c.mcapAtPost ? <span className="hc-mc">{usd(c.mcapAtPost)} MC</span> : null}
                </div>
                <p className={`hc-text${long && !expanded ? " clamp" : ""}`}>{c.text}</p>
                {long && <button type="button" className="hc-more" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>{expanded ? "Show less" : "Show more"}</button>}
                {c.mint && (
                  <button type="button" className="hc-token" onClick={() => openToken(c)}>
                    <span><b>{c.position?.symbol ?? "Token"}</b><small>{c.mint.slice(0, 4)}…{c.mint.slice(-4)}</small></span>
                    {c.position && (
                      <span className="hc-pos">
                        <small>Entry {usd(c.position.entryMcap)}</small>
                        <b style={{ color: (pnl ?? 0) >= 0 ? "var(--win)" : "var(--loss)" }}>{(pnl ?? 0) >= 0 ? "+" : ""}{(pnl ?? 0).toFixed(1)}%</b>
                      </span>
                    )}
                  </button>
                )}
                <div className="hc-foot"><span>♥ {c.hearts}</span><span>↻ {c.reposts}</span><span>💬 {c.comments}</span></div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
