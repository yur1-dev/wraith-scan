"use client";

import { disarmLiveExit, type LiveExitRule } from "@/lib/liveExits";

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };
export default function ExitBox({ mint, symbol, on, setOn, prefs, setPrefs, allowed, armed }: {
  mint: string; symbol: string; on: boolean; setOn: (v: boolean) => void;
  prefs: { tp: string; sl: string; trail: string }; setPrefs: (p: { tp: string; sl: string; trail: string }) => void;
  allowed: boolean; armed: LiveExitRule | null;
}) {
  const field = (key: "tp" | "sl" | "trail", label: string, hint: string) => (
    <label style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: "block", color: "var(--text-muted)", fontSize: 9, marginBottom: 4 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", padding: "0 8px", height: 34 }}>
        <input aria-label={hint} inputMode="decimal" value={prefs[key]} onChange={(e) => setPrefs({ ...prefs, [key]: e.target.value.replace(/[^0-9.]/g, "") })} style={{ width: "100%", minWidth: 0, background: "transparent", border: 0, outline: 0, color: "var(--text)", fontSize: 13, ...MONO }} />
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>%</span>
      </div>
    </label>
  );
  if (!allowed) {
    return <a href="/#omen" style={{ display: "block", marginTop: 12, padding: "10px 12px", border: "1px dashed var(--border)", borderRadius: 10, color: "var(--text-muted)", fontSize: 11, textDecoration: "none" }}>🔒 Auto TP / SL / trailing stop unlocks at SHADE (10K OMEN)</a>;
  }
  return (
    <div style={{ marginTop: 12, padding: 12, border: `1px solid ${on ? "var(--orange)" : "var(--border)"}`, borderRadius: 10 }}>
      <button type="button" onClick={() => setOn(!on)} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", background: "none", border: 0, padding: 0, color: "var(--text)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
        <span>Auto-exit (TP / SL / trail)</span>
        <span style={{ color: on ? "#37d58a" : "var(--text-muted)", fontSize: 10 }}>{on ? "ON" : "OFF"}</span>
      </button>
      {on && (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {field("tp", "TAKE PROFIT +", "Take profit percent")}
            {field("sl", "STOP LOSS −", "Stop loss percent")}
            {field("trail", "TRAIL −", "Trailing stop percent from peak")}
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--text-dim)", fontSize: 10, lineHeight: 1.5 }}>After the buy fills, Wraith sells 100% of {symbol} to USDC when a level hits. Works only while Wraith is open in a tab; 0 turns a level off.</p>
        </>
      )}
      {armed && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 10, color: "var(--text-muted)" }}>
          <span>● Armed: {armed.tpPct ? `TP +${armed.tpPct}% ` : ""}{armed.slPct ? `SL −${armed.slPct}% ` : ""}{armed.trailPct ? `Trail −${armed.trailPct}%` : ""}</span>
          <button type="button" onClick={() => disarmLiveExit(mint)} style={{ background: "none", border: 0, color: "#e58d80", cursor: "pointer", fontSize: 10 }}>Cancel</button>
        </div>
      )}
    </div>
  );
}
