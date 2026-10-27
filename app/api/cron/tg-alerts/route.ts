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

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || req.nextUrl.searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) return NextResponse.json({ error: "no bot token" }, { status: 503 });

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
    if (!(await claim(`entry:${c.address}`))) continue;
    if (first) continue;
    const sig = feed.get(c.address);
    if (!sig) continue;
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
  }
  return NextResponse.json({ ok: true, first, ...out });
}
