import { createCanvas, loadImage, GlobalFonts, type Image } from "@napi-rs/canvas";
import path from "path";
import type { NextRequest } from "next/server";
import { drawShareCard, SHARE_RANKS, SHARE_VARIANTS, type ShareParams } from "@/lib/shareCard";

// Telegram banner: the same canvas renderer as the in-app share card, drawn on the server and returned as a PNG.
// /api/banner?kind=win&sym=FOO&x=3.5&called=13000&now=45500&peak=45500&chain=solana&img=<token image url>
// /api/banner?kind=signal&sym=FOO&now=13000&score=73&tier=HOT&chain=solana&img=<token image url>
export const runtime = "nodejs";

let fontsReady = false;
function fonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "assets", "fonts");
  try {
    GlobalFonts.registerFromPath(path.join(dir, "anton-latin-400-normal.woff"), "Impact");
    GlobalFonts.registerFromPath(path.join(dir, "ibm-plex-mono-latin-600-normal.woff"), "IBM Plex Mono");
    GlobalFonts.registerFromPath(path.join(dir, "ibm-plex-mono-latin-700-normal.woff"), "IBM Plex Mono");
  } catch (e) {
    console.error("[banner] font registration failed", e);
  }
  fontsReady = true;
}

const clean = (v: string | null, max: number) => (v ?? "").replace(/[^\p{L}\p{N} ._$-]/gu, "").slice(0, max);
const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const CHAINS: Record<string, string> = { solana: "Solana", ethereum: "Ethereum", base: "Base", bsc: "BNB Chain", monad: "Monad", arc: "Arc", robinhood: "Robinhood" };

async function img(url: string | null, same: string | null): Promise<Image | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000), headers: same ? {} : { "user-agent": "wraith-banner" } });
    if (!r.ok) return null;
    return await loadImage(Buffer.from(await r.arrayBuffer()));
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  fonts();
  const sp = req.nextUrl.searchParams, origin = req.nextUrl.origin;
  const kind = sp.get("kind") === "signal" ? "signal" : "win";
  const sym = clean(sp.get("sym"), 12) || "TOKEN";
  const x = Math.max(1, Number(sp.get("x")) || 1);
  const called = Number(sp.get("called")) || 0, now = Number(sp.get("now")) || 0, peak = Number(sp.get("peak")) || 0;
  const score = Math.round(Number(sp.get("score")) || 0);
  const hot = sp.get("tier") === "HOT";
  const chain = CHAINS[(sp.get("chain") ?? "solana").toLowerCase()] ?? clean(sp.get("chain"), 14);
  const rankIdx = kind === "win" ? (x >= 5 ? 2 : x >= 2 ? 1 : 0) : hot ? 2 : 1;
  const art = ["/shade.png", "/specter.png", "/tier-wraith.png"][rankIdx];
  const variant = sp.get("v") ? Number(sp.get("v")) : hash(sym + (sp.get("kind") ?? ""));
  const [rankImg, tokenImg] = await Promise.all([img(`${origin}${art}`, "1"), img(sp.get("img"), null)]);

  const base: ShareParams = {
    symbol: sym, amountSol: 1, unit: "SOL", chainName: chain, entryMcap: called || now, exitMcap: now, pnl: (x - 1) * 100, solPnl: 1,
    mult: x, ago: "", rank: SHARE_RANKS[rankIdx], variant: variant % SHARE_VARIANTS, rankImg: rankImg as unknown as HTMLImageElement | null,
    tokenImg: tokenImg as unknown as CanvasImageSource | null, call: true, chipText: `${chain}${kind === "win" ? " · win" : " · signal"}`,
  };
  const p: ShareParams = kind === "win"
    ? { ...base, resText: `${x.toFixed(x >= 10 ? 1 : 2)}x`, subText: `${usd(called)} → ${usd(now)}${peak > now * 1.05 ? `  ·  peak ${usd(peak)}` : ""}` }
    : { ...base, rank: SHARE_RANKS[rankIdx], pnl: 0, mult: 1, entryMcap: now, exitMcap: now, bigText: `${score}`, resText: hot ? "HOT SIGNAL" : "WATCH SIGNAL", label: "WRAITH SCORE / 100", subText: `MCap ${usd(now)}  ·  ${chain}`, sealText: `${score}`, sealLabel: hot ? "HOT" : "WATCH" };

  const S = 1.5;
  const canvas = createCanvas(960 * S, 540 * S);
  const ctx = canvas.getContext("2d");
  ctx.scale(S, S);
  drawShareCard(ctx as unknown as CanvasRenderingContext2D, 3.4, p);
  const png = canvas.toBuffer("image/png");
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=3600, s-maxage=3600" } });
}
