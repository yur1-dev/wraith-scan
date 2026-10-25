// lib/telegramBot.ts (server only)
// Everything the Wraith Telegram bot needs: user prefs, de-duplicated broadcasting, and the premium message layouts.
import { getDb } from "@/lib/mongoClient";
import { fmtAge, fmtPct } from "@/lib/market";
import type { Signal } from "@/app/api/signals/route";
import type { SignalCall } from "@/lib/signalCalls";
import { chainName, esc, fmtUsd, footer, header, rule, scoreBar, tokenKeyboard } from "@/lib/telegramUi";

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? "";
export const WIN_LADDER = [2, 3, 5, 10, 25, 50, 100, 250, 500, 1000];
export const milestoneFor = (x: number) => [...WIN_LADDER].reverse().find((m) => x >= m) ?? 0;

export interface TgPrefs { signals: boolean; wins: boolean; minScore: number; chains: string[]; muteUntil: number }
export const DEFAULT_PREFS: TgPrefs = { signals: true, wins: true, minScore: 70, chains: [], muteUntil: 0 };
export const prefsOf = (u: { tgPrefs?: Partial<TgPrefs> } | null | undefined): TgPrefs => ({ ...DEFAULT_PREFS, ...(u?.tgPrefs ?? {}) });

export async function tg<T = unknown>(method: string, body: unknown): Promise<{ ok: boolean; result?: T; description?: string }> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch {
    return { ok: false, description: "network" };
  }
}

/** Atomically claim a de-dupe key. True = first time (go ahead and send). */
export async function claim(key: string): Promise<boolean> {
  try {
    const db = await getDb();
    await db.collection<{ _id: string; at: Date }>("tg_sent").insertOne({ _id: key, at: new Date() });
    return true;
  } catch {
    return false;
  }
}

type Markup = ReturnType<typeof tokenKeyboard>;

/** Send to every linked, eligible user whose prefs allow it. */
export async function broadcast(kind: "signal" | "win", text: string, opts: { chain?: string; score?: number; markup?: Markup; imageUrl?: string }) {
  const db = await getDb();
  const users = await db
    .collection("users")
    .find({ telegramChatId: { $exists: true, $ne: null }, tier: { $in: ["SPECTER", "WRAITH"] } }, { projection: { telegramChatId: 1, tgPrefs: 1 } })
    .toArray();
  const chain = opts.chain ?? "solana";
  let sent = 0;
  let skipped = 0;
  for (const u of users) {
    const p = prefsOf(u as { tgPrefs?: Partial<TgPrefs> });
    const ok =
      p.muteUntil < Date.now() &&
      (kind === "signal" ? p.signals && (opts.score ?? 100) >= p.minScore : p.wins) &&
      (p.chains.length === 0 || p.chains.includes(chain));
    if (!ok) { skipped++; continue; }
    const chat = String(u.telegramChatId);
    let res = opts.imageUrl && text.length < 1000
      ? await tg("sendPhoto", { chat_id: chat, photo: opts.imageUrl, caption: text, parse_mode: "HTML", reply_markup: opts.markup })
      : { ok: false };
    if (!res.ok) res = await tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: opts.markup });
    if (res.ok) sent++;
  }
  return { sent, skipped };
}

// ── message layouts ────────────────────────────────────────────────────────

export function signalMessage(s: Signal): string {
  const t = s.token;
  const m = s.meta ?? {};
  const hot = s.tier === "HOT";
  const chain = t.chain ?? "solana";
  const h1 = t.change.h1;
  const buyShare = m.buyVol1h !== undefined && m.sellVol1h !== undefined && m.buyVol1h + m.sellVol1h > 0 ? Math.round((m.buyVol1h / (m.buyVol1h + m.sellVol1h)) * 100) : null;
  const L: string[] = [
    header(hot ? "🟢" : "🟡", hot ? "HOT SIGNAL" : "WATCH SIGNAL", t.symbol, chain, t.name),
    `💰 <b>MCap</b>  ${fmtUsd(t.mcap)}    💧 <b>Liq</b>  ${fmtUsd(t.liquidity)}`,
    `${(h1 ?? 0) >= 0 ? "🟩" : "🟥"} <b>1h</b>  ${fmtPct(h1)}    📊 <b>Vol 1h</b>  ${fmtUsd(t.volume.h1)}`,
    `🕒 <b>Age</b>  ${t.createdAt ? fmtAge(t.createdAt) : "—"}${m.holders ? `    🧑‍🤝‍🧑 <b>Holders</b>  ${m.holders.toLocaleString("en-US")}` : ""}`,
  ];
  if (buyShare !== null) L.push(`⚖️ <b>Buy / sell</b>  ${buyShare}% / ${100 - buyShare}%`);
  L.push(`📈 <b>Score</b>  ${s.score}/100  <code>${scoreBar(s.score)}</code>`);
  if (s.tags.length) L.push(rule, `✅ ${s.tags.map(esc).join("  ·  ")}`);
  if (s.risks.length) L.push(`⚠️ ${s.risks.map(esc).join("  ·  ")}`);
  L.push(rule, `<code>${t.address}</code>`, "", footer);
  return L.join("\n");
}

export function winMessage(c: Pick<SignalCall, "address" | "chain" | "symbol" | "name" | "spottedAt" | "spottedMcap" | "peakMcap" | "lastMcap" | "score" | "tier">, milestone: number): string {
  const x = c.lastMcap / c.spottedMcap;
  const peakX = c.peakMcap / c.spottedMcap;
  const spotted = new Date(c.spottedAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" });
  const L: string[] = [
    header("🏆", `WRAITH WIN · ${milestone}x`, c.symbol, c.chain, c.name),
    `🚀 <b>${x.toFixed(x >= 10 ? 1 : 2)}x</b> from the call${peakX > x * 1.05 ? `   <i>(peak ${peakX.toFixed(peakX >= 10 ? 1 : 2)}x)</i>` : ""}`,
    `📍 <b>Called</b>  ${fmtUsd(c.spottedMcap)}  <i>${spotted} PHT</i>`,
    `📊 <b>Now</b>  ${fmtUsd(c.lastMcap)}    🏔 <b>Peak</b>  ${fmtUsd(c.peakMcap)}`,
    `⏱ <b>Since call</b>  ${fmtAge(c.spottedAt)}`,
    `📈 <b>Score at call</b>  ${c.score}/100  <code>${scoreBar(c.score)}</code>`,
    rule,
    `<code>${c.address}</code>`,
    "",
    footer,
  ];
  return L.join("\n");
}

export const walletLine = (chain?: string) => chainName(chain);
