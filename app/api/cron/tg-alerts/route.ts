// GET /api/cron/tg-alerts  (every minute)
// Server-side alerts so Telegram works while you're away from the PC:
//   1. new HOT/WATCH signals  2. win milestones (2x, 3x, 5x, 10x…) on every tracked call.
// Auth: Vercel cron sends "Authorization: Bearer $CRON_SECRET"; external cron can use ?key=$CRON_SECRET.
// Free option if your host only runs daily crons: ping this URL every minute from cron-job.org.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { refreshCalls, type SignalCall } from "@/lib/signalCalls";
import type { Signal } from "@/app/api/signals/route";
import { broadcast, claim, milestoneFor, signalMessage, winMessage } from "@/lib/telegramBot";
import { tokenKeyboard } from "@/lib/telegramUi";
import { runPushAlerts, pushBroadcast } from "@/lib/push";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || req.nextUrl.searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (req.nextUrl.searchParams.get("grouptest") === "1") {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const gid = process.env.TELEGRAM_GROUP_CHAT_ID;
    const thread = Number(process.env.TELEGRAM_GROUP_THREAD_ID);
    if (!token || !gid) return NextResponse.json({ ok: false, error: "missing env", hasToken: !!token, hasGroupId: !!gid, signals: process.env.TELEGRAM_GROUP_SIGNALS });
    const demo = req.nextUrl.searchParams.get("demo") === "1";
    const text = demo
      ? "🧪 <b>TEST — HOT SIGNAL</b>  $DEMO\n💰 <b>MCap</b>  $48.2K    💧 <b>Liq</b>  $12.4K\n🟩 <b>1h</b>  +38.1%    📊 <b>Vol 1h</b>  $31.5K\n📈 <b>Score</b>  82/100\n\nThis is how Wraith calls and wins show up here."
      : "Wraith group feed test";
    if (demo) await pushBroadcast({ title: "🧪 Wraith test alert", body: "$DEMO spotted at $48.2K · score 82", url: "/app", tag: "demo" }, "signal").catch(() => 0);
    const body: Record<string, unknown> = { chat_id: gid, text, parse_mode: "HTML" };
    if (Number.isFinite(thread) && thread > 0) body.message_thread_id = thread;
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return NextResponse.json({ gid, thread, signals: process.env.TELEGRAM_GROUP_SIGNALS, telegram: await r.json() });
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    // No Telegram bot configured: phone push notifications still run.
    const push = await runPushAlerts().catch((e) => { console.error("[push alerts]", e); return null; });
    return NextResponse.json({ ok: true, telegram: false, push });
  }

  const db = await getDb();
  const state = db.collection<{ _id: string; at: Date }>("tg_state");
  // First ever run: mark everything that already exists as "seen" so nobody gets a flood of old alerts.
  const first = !(await state.findOne({ _id: "cron" }));
  await state.updateOne({ _id: "cron" }, { $set: { at: new Date() } }, { upsert: true });

  let signals: Signal[] = [];
  try {
    const r = await fetch(`${req.nextUrl.origin}/api/signals`, { cache: "no-store", signal: AbortSignal.timeout(40_000) });
    if (r.ok) signals = ((await r.json()) as { signals?: Signal[] }).signals ?? [];
  } catch { /* feed down: still do wins */ }
  await refreshCalls(true).catch(() => undefined);

  const calls = db.collection<SignalCall>("signal_calls");
  const out = { entries: 0, wins: 0, sent: 0 };

  // 1) fresh calls (spotted in the last 20 min)
  const fresh = await calls.find({ spottedAt: { $gt: Date.now() - 20 * 60_000 }, shadow: { $ne: true }, engine: 2 }).toArray();
  const feed = new Map(signals.map((s) => [s.token.address, s]));
  for (const c of fresh) {
    const sig = feed.get(c.address);
    if (!first && !sig) continue; // feed missed it this run: don't burn the claim, retry next run
    if (!(await claim(`entry:${c.address}`))) continue;
    if (first || !sig) continue;
    const r = await broadcast("signal", signalMessage(sig), { chain: c.chain ?? "solana", score: sig.score, markup: tokenKeyboard(c.address, c.chain ?? "solana"), imageUrl: sig.token.imageUrl });
    out.entries++; out.sent += r.sent;
  }

  // 2) win milestones across the last 7 days
  const tracked = await calls.find({ spottedAt: { $gt: Date.now() - 7 * 86_400_000 }, spottedMcap: { $gt: 0 }, shadow: { $ne: true }, engine: 2 }).toArray();
  for (const c of tracked) {
    const m = milestoneFor(c.lastMcap / c.spottedMcap);
    if (!m) continue;
    if (!(await claim(`win:${c.address}:${m}`))) continue;
    if (first) continue;
    const r = await broadcast("win", winMessage(c, m), { chain: c.chain ?? "solana", markup: tokenKeyboard(c.address, c.chain ?? "solana") });
    out.wins++; out.sent += r.sent;
    await pushBroadcast({ title: `🏆 ${m}x $${c.symbol}`, body: `${(c.lastMcap / c.spottedMcap).toFixed(2)}x from the call`, url: `/app/token/${c.address}`, tag: `w:${c.address}:${m}` }, "signal").catch(() => 0);
  }
  const push = await runPushAlerts().catch((e) => { console.error("[push alerts]", e); return null; });
  return NextResponse.json({ ok: true, first, ...out, push });
}
