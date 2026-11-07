"use client";

// Patterns view: what the scanner has learned from its own track record. Everything shown here is measured from real,
// matured calls (did the token reach 2x from the price it was flagged at?). Nothing is a promise about the future.
import { useEffect, useState } from "react";
import { Brain, Copy, ExternalLink, FlaskConical, ShieldAlert, Target, Wallet } from "lucide-react";
import { fmtUsd, type MarketToken } from "@/lib/market";
import { TokenIcon } from "@/components/TokenIcon";
import WalletAvatar from "@/components/WalletAvatar";
import { asKind, KIND_INFO, walletName } from "@/lib/walletIdentity";

interface PatternStat { id: string; label: string; hint: string; trap: boolean; calls: number; wins: number; rate: number | null; lift: number | null }
interface Learning {
  model: null | {
    n: number; wins: number; base: number; trainedAt: number; active: boolean;
    holdout: { n: number; auc: number; baseRate: number; topQuartileRate: number; bottomQuartileRate: number; folds?: number[] };
    top: { name: string; w: number }[];
  };
  patterns: PatternStat[];
  coverage: { calls: number; withIntel: number; withIntelPct: number };
}
interface Sig { token: MarketToken; score: number; tier: "HOT" | "WATCH"; tags: string[]; risks: string[]; patterns?: string[]; odds?: number }

interface WalletRow { wallet: string; calls: number; wins: number; dumps: number; winRate: number; dumpRate: number; kind: string; holdPct: number | null; flipPct: number | null; medOffsetS: number | null; avgSol: number | null }
interface WalletBoard { proven: WalletRow[]; holders: WalletRow[]; dumpers: WalletRow[]; counts: { tracked: number; proven: number; dumpers: number } }
type WTab = "proven" | "holders" | "dumpers";
const WTABS: { key: WTab; label: string; hint: string }[] = [
  { key: "proven", label: "Proven", hint: "Early in 3+ calls and in a winner (2x) at least 30% of the time, without ending in a big loss most of the time. Being early in winners does not always mean skill: some are bots." },
  { key: "holders", label: "Holders", hint: "Proven wallets that are usually still holding 30 minutes after buying, instead of selling quickly." },
  { key: "dumpers", label: "Wall of shame", hint: "Early in 4+ calls and ended in a 50%+ loss in at least 75% of them. If these are in a token you are about to buy, be careful." },
];
const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function Wallets() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<WTab>("proven");
  const [d, setD] = useState<WalletBoard | null>(null);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!open || d) return;
    let alive = true;
    fetch("/api/wallet-board").then((r) => (r.ok ? r.json() : Promise.reject())).then((j: WalletBoard) => { if (alive) setD(j); }).catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [open, d]);
  const rows = d ? (d[tab] ?? []) : [];
  const copy = (w: string) => { void navigator.clipboard.writeText(w).then(() => { setCopied(w); window.setTimeout(() => setCopied(null), 1200); }).catch(() => undefined); };
  return (
    <div className="pw">
      <button type="button" className="pw-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Wallet size={15} />
        <span><b>Wallets behind the patterns</b><em>{d ? `${d.counts.proven.toLocaleString()} proven · ${d.counts.dumpers.toLocaleString()} repeat dumpers · ${d.counts.tracked.toLocaleString()} tracked` : "Proven wallets and repeat dumpers the scanner tracks"}</em></span>
        <i>{open ? "Hide" : "Show"}</i>
      </button>
      {open && (
        <div className="pw-body">
          <div className="pw-tabs" role="tablist">
            {WTABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>
          <p className="pw-hint">{WTABS.find((t) => t.key === tab)?.hint}</p>
          {err ? <div className="pt-note">Could not load wallets right now.</div> : !d ? <div className="pt-note">Loading…</div> : rows.length === 0 ? <div className="pt-note">{tab === "holders" ? "No wallets typed as holders yet." : "None yet."}</div> : (
            <div className="pw-list">
              {rows.map((r, i) => {
                const kind = asKind(r.kind);
                const info = KIND_INFO[kind];
                const shame = tab === "dumpers";
                return (
                  <div key={r.wallet} className="pw-card">
                    <span className="pw-rank">{i + 1}</span>
                    <WalletAvatar address={r.wallet} kind={kind} size={44} />
                    <div className="pw-main">
                      <div className="pw-title"><b>{walletName(r.wallet)}</b><code title={r.wallet}>{shortAddr(r.wallet)}</code></div>
                      <div className="pw-tags">
                        <span className="pw-kind" style={{ color: info.color, borderColor: info.color }} title={info.blurb}>{info.label}</span>
                        {r.holdPct !== null && <span>holds {r.holdPct}%</span>}
                        {r.medOffsetS !== null && <span>buys at ~{r.medOffsetS}s</span>}
                        {r.avgSol !== null && <span>{r.avgSol} SOL avg</span>}
                      </div>
                      <div className="pw-bar" title={shame ? `${r.dumps} of ${r.calls} ended in a 50%+ loss` : `${r.wins} of ${r.calls} reached 2x`}>
                        <i className={shame ? "bad" : "good"} style={{ width: `${Math.max(4, Math.round((shame ? r.dumpRate : r.winRate) * 100))}%` }} />
                      </div>
                      <div className="pw-rec">{shame ? <><b>{r.dumps}</b> dumps in {r.calls} calls · {Math.round(r.dumpRate * 100)}%</> : <><b>{r.wins}</b> wins in {r.calls} calls · {Math.round(r.winRate * 100)}% · {Math.round(r.dumpRate * 100)}% ended in a loss</>}</div>
                    </div>
                    <div className="pw-act">
                      <button type="button" onClick={() => copy(r.wallet)} aria-label="Copy wallet address">{copied === r.wallet ? "Copied" : <Copy size={14} />}</button>
                      <a href={`https://solscan.io/account/${r.wallet}`} target="_blank" rel="noopener noreferrer" aria-label="Open on Solscan"><ExternalLink size={14} /></a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(d)}%`);
const ago = (t: number) => { const h = Math.round((Date.now() - t) / 3_600_000); return h < 1 ? "under an hour ago" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; };

export default function PatternsPanel({ signals, onOpen }: { signals: Sig[]; onOpen: (s: Sig) => void }) {
  const [data, setData] = useState<Learning | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/signal-learning", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Learning) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, []);

  const m = data?.model ?? null;
  const nowCount = (id: string) => signals.filter((s) => s.patterns?.includes(id)).length;
  const matching = (id: string) => signals.filter((s) => s.patterns?.includes(id)).slice(0, 6);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="pt-wrap">
      {err ? (
        <div className="pt-note">Could not load what the scanner has learned right now.</div>
      ) : !data ? (
        <div className="pt-note">Loading…</div>
      ) : (
        <>
          <div className="pt-cards">
            <div className="pt-card">
              <Brain size={15} /><small>Learning from</small>
              <b>{(m?.n ?? data.coverage.calls).toLocaleString()} calls</b>
              <span>{m ? `${m.wins.toLocaleString()} reached 2x (${pct(m.base)}) · retrained ${ago(m.trainedAt)}` : "Not enough finished calls yet"}</span>
            </div>
            <div className="pt-card">
              <FlaskConical size={15} /><small>Score on unseen calls</small>
              <b>{m ? `${m.holdout.auc.toFixed(2)} AUC` : "n/a"}</b>
              <span>{m ? `0.50 is a coin flip. Tested on later calls it never trained on: the top quarter of picks hit ${pct(m.holdout.topQuartileRate, 0)} vs ${pct(m.holdout.bottomQuartileRate, 0)} for the bottom (${m.holdout.n} calls, ${m.holdout.folds?.length ?? 1} rounds).` : "Needs 300+ finished calls"}</span>
            </div>
            <div className="pt-card">
              <Target size={15} /><small>Model status</small>
              <b className={m?.active ? "ok" : "off"}>{m?.active ? "Active" : "Learning"}</b>
              <span>{m?.active ? "Beats chance on later calls it never saw, so it nudges scores by up to ±6 and shows win odds. The edge is modest: treat it as a tilt, not a guarantee." : "Not better than chance yet, so it is NOT changing any scores. It retrains daily as calls finish."}</span>
            </div>
          </div>

          {data.coverage.calls > 0 && data.coverage.withIntelPct < 40 && (
            <div className="pt-note">
              Only {data.coverage.withIntelPct}% of past calls recorded smart-wallet, buyer-flow and dev-history data, so the strongest signals have little to learn from yet. That share grows with every new call.
            </div>
          )}

          <div className="pt-table" role="table" aria-label="Pattern track record">
            <div className="pt-row head" role="row">
              <span>Pattern</span><span>Calls</span><span>Hit 2x</span><span>vs avg</span><span>Now</span>
            </div>
            {data.patterns.map((p) => {
              const n = nowCount(p.id);
              const good = p.lift !== null && p.lift >= 1.15;
              const bad = p.lift !== null && p.lift <= 0.85;
              return (
                <div key={p.id} className="pt-item">
                  <button type="button" className="pt-row" role="row" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                    <span className="pt-name"><span className="pt-title">{p.trap ? <ShieldAlert size={14} /> : null}<span>{p.label}</span></span><em>{p.hint}</em></span>
                    <span>{p.calls.toLocaleString()}</span>
                    <span>{p.rate === null ? <i className="mut" title="Needs 15 or more finished calls before a hit rate means anything">too few</i> : pct(p.rate)}</span>
                    <span className={good ? "up" : bad ? "down" : ""}>{p.lift === null ? "n/a" : `${p.lift.toFixed(2)}×`}</span>
                    <span className={n ? "now" : "mut"}>{n || "–"}</span>
                  </button>
                  {open === p.id && (
                    <div className="pt-match">
                      {matching(p.id).length ? matching(p.id).map((s) => (
                        <button key={s.token.address} type="button" onClick={() => onOpen(s)}>
                          <TokenIcon contractAddress={s.token.address} imageUrl={s.token.imageUrl} symbol={s.token.symbol} size={20} />
                          <b>{s.token.symbol}</b><span>{fmtUsd(s.token.mcap)}</span><i>{s.score}{s.odds !== undefined ? ` · ${s.odds}%` : ""}</i>
                        </button>
                      )) : <span className="mut">No token matches this right now.</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Wallets />
          <p className="pt-foot">Hit rates are measured on finished calls, never assumed. A pattern marked a trap that still wins often means that rule needs rethinking, and the scanner will keep showing the real number.</p>
        </>
      )}
    </div>
  );
}
