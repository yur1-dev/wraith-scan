"use client";

// Patterns view: what the scanner has learned from its own track record. Everything shown here is measured from real,
// matured calls (did the token reach 2x from the price it was flagged at?). Nothing is a promise about the future.
import { useEffect, useState } from "react";
import { Brain, FlaskConical, ShieldAlert, Target } from "lucide-react";
import { fmtUsd, type MarketToken } from "@/lib/market";
import { TokenIcon } from "@/components/TokenIcon";

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
                    <span className="pt-name">{p.trap ? <ShieldAlert size={13} /> : null}{p.label}<em>{p.hint}</em></span>
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
          <p className="pt-foot">Hit rates are measured on finished calls, never assumed. A pattern marked a trap that still wins often means that rule needs rethinking, and the scanner will keep showing the real number.</p>
        </>
      )}
    </div>
  );
}
