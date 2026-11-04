import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

// 1200x630 share banner used for Telegram posts (wins + fresh signals).
// /api/banner?kind=win&sym=FOO&x=3.5&called=13000&now=45500&peak=45500&chain=Solana&score=73&img=<token image url>
export const runtime = "nodejs";

const RANKS = [
  { min: 0, name: "SHADE", color: "#2fe0c0", glow: "rgba(47,224,192,.35)", art: "/shade.png" },
  { min: 2, name: "SPECTER", color: "#b98cff", glow: "rgba(185,140,255,.38)", art: "/specter.png" },
  { min: 5, name: "WRAITH", color: "#ff7b3d", glow: "rgba(255,123,61,.42)", art: "/tier-wraith.png" },
];
const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
const clean = (v: string | null, max: number) => (v ?? "").replace(/[^\p{L}\p{N} ._$-]/gu, "").slice(0, max);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const origin = req.nextUrl.origin;
  const kind = sp.get("kind") === "signal" ? "signal" : "win";
  const sym = clean(sp.get("sym"), 12) || "TOKEN";
  const x = Math.max(0, Number(sp.get("x")) || 0);
  const called = Number(sp.get("called")) || 0;
  const now = Number(sp.get("now")) || 0;
  const peak = Number(sp.get("peak")) || 0;
  const score = Math.round(Number(sp.get("score")) || 0);
  const chain = clean(sp.get("chain"), 14) || "Solana";
  const tier = sp.get("tier") === "HOT" ? "HOT" : "WATCH";
  const rank = kind === "win" ? [...RANKS].reverse().find((r) => x >= r.min) ?? RANKS[0] : tier === "HOT" ? RANKS[2] : RANKS[1];
  const accent = rank.color;
  const tokenImg = sp.get("img");
  const big = kind === "win" ? `${x.toFixed(x >= 10 ? 1 : 2)}x` : `${score}`;
  const bigLabel = kind === "win" ? "FROM THE CALL" : "SIGNAL SCORE / 100";
  const title = kind === "win" ? "WRAITH WIN" : tier === "HOT" ? "HOT SIGNAL" : "WATCH SIGNAL";

  const stat = (label: string, value: string) => (
    <div style={{ display: "flex", flexDirection: "column", marginRight: 44 }}>
      <div style={{ display: "flex", fontSize: 22, color: "#ffffff88", letterSpacing: 3 }}>{label}</div>
      <div style={{ display: "flex", fontSize: 40, color: "#fff", fontWeight: 800 }}>{value}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", position: "relative", background: "#08080a", color: "#fff", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -80, top: -60, width: 760, height: 760, borderRadius: 380, background: rank.glow, display: "flex" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 8, background: accent, display: "flex" }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${origin}${rank.art}`} width={560} height={656} style={{ position: "absolute", right: 10, bottom: -70 }} alt="" />
        <div style={{ position: "absolute", inset: 0, display: "flex", background: "linear-gradient(90deg,#08080a 42%,rgba(8,8,10,.55) 66%,rgba(8,8,10,0) 100%)" }} />
        <div style={{ display: "flex", flexDirection: "column", padding: "48px 64px", width: 820, height: 630, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {tokenImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tokenImg} width={64} height={64} style={{ borderRadius: 32, marginRight: 18, border: `3px solid ${accent}` }} alt="" />
            ) : null}
            <div style={{ display: "flex", fontSize: 46, fontWeight: 800 }}>${sym}</div>
            <div style={{ display: "flex", marginLeft: 20, padding: "6px 16px", border: `2px solid ${accent}`, color: accent, fontSize: 22, letterSpacing: 4 }}>{kind === "win" ? rank.name : tier}</div>
            <div style={{ display: "flex", marginLeft: 16, fontSize: 22, color: "#ffffff77", textTransform: "capitalize" }}>{chain}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 26, color: accent, letterSpacing: 8, fontWeight: 800 }}>{title}</div>
            <div style={{ display: "flex", fontSize: big.length > 5 ? 190 : 230, fontWeight: 900, color: accent, lineHeight: 1 }}>{big}</div>
            <div style={{ display: "flex", fontSize: 24, color: "#ffffff99", letterSpacing: 5, marginTop: 6 }}>{bigLabel}</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ display: "flex" }}>
              {stat(kind === "win" ? "CALLED" : "MCAP", usd(kind === "win" ? called : now))}
              {kind === "win" ? stat("NOW", usd(now)) : null}
              {kind === "win" && peak > now * 1.05 ? stat("PEAK", usd(peak)) : null}
            </div>
            <div style={{ display: "flex", fontSize: 26, color: "#ff7b3d", letterSpacing: 8, fontWeight: 900 }}>WRAITH.FARM</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } },
  );
}
