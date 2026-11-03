// Web Push: real phone notifications (they show in the notification shade even when the app is closed).
// Needs env: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com).
import webpush from "web-push";
import { getDb } from "@/lib/mongoClient";
import { fcmConfigured, sendFcm } from "@/lib/fcm";
import type { SignalCall } from "@/lib/signalCalls";

export interface PushPrefs { trader: boolean; callout: boolean; saved: boolean; signal: boolean }
export interface PushSub {
  _id: string; // endpoint
  userId: string;
  p256dh: string;
  auth: string;
  prefs: PushPrefs;
  saved: { mint: string; symbol: string }[];
  base: Record<string, number>;
  cursor: number;
  createdAt: number;
  fcm?: boolean; // native Android push; _id is "fcm:<token>"
}
interface Msg { title: string; body: string; url: string; tag: string }

const COLLECTION = "push_subs";
const SAVED_MOVE = 0.25;
const MAX_PER_RUN = 5;

let ready: boolean | null = null;
/** true when either web push or native push can send */
export function pushAnyConfigured(): boolean { return pushConfigured() || fcmConfigured(); }

export function pushConfigured(): boolean {
  if (ready !== null) return ready;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { ready = false; return false; }
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@wraith.farm", pub, priv);
    ready = true;
  } catch (e) {
    console.error("[push] bad VAPID keys", e);
    ready = false;
  }
  return ready;
}

const k = (n?: number | null) => {
  if (!n || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

/** returns false when the subscription is dead and should be removed */
async function deliver(sub: PushSub, msg: Msg): Promise<boolean> {
  if (sub.fcm) return sendFcm(sub._id.slice(4), msg);
  if (!pushConfigured()) return true;
  try {
    await webpush.sendNotification({ endpoint: sub._id, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(msg), { TTL: 3600, urgency: "high" });
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return false;
    console.error("[push] send failed", code ?? e);
    return true;
  }
}

export async function sendTest(userId: string): Promise<number> {
  if (!pushAnyConfigured()) return 0;
  const db = await getDb();
  const all = await db.collection<PushSub>(COLLECTION).find({ userId }).toArray();
  const subs = all.some((s) => s.fcm) ? all.filter((s) => s.fcm) : all; // native push wins over web push
  let n = 0;
  for (const s of subs) {
    const ok = await deliver(s, { title: "Wraith notifications are on", body: "You will get calls, trader buys and saved-token moves here.", url: "/app", tag: "test" });
    if (ok) n++; else await db.collection<PushSub>(COLLECTION).deleteOne({ _id: s._id });
  }
  return n;
}

async function jupPrices(mints: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < mints.length; i += 50) {
    try {
      const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mints.slice(i, i + 50).join(",")}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const d = (await r.json()) as Record<string, { usdPrice?: number }>;
      for (const [m, v] of Object.entries(d)) if (v?.usdPrice && v.usdPrice > 0) out[m] = v.usdPrice;
    } catch { /* skip this chunk */ }
  }
  return out;
}

/** Called every minute by the cron. Sends each subscriber only what happened since their last run. */
export async function runPushAlerts(): Promise<{ subs: number; sent: number; removed: number }> {
  const res = { subs: 0, sent: 0, removed: 0 };
  if (!pushAnyConfigured()) return res;
  const db = await getDb();
  const col = db.collection<PushSub>(COLLECTION);
  const allSubs = await col.find({}).limit(3000).toArray();
  const fcmUsers = new Set(allSubs.filter((s) => s.fcm).map((s) => s.userId));
  const subs = allSubs.filter((s) => s.fcm || !fcmUsers.has(s.userId)); // one channel per user: no double alerts
  res.subs = subs.length;
  if (!subs.length) return res;
  const now = Date.now();
  const minCursor = Math.min(...subs.map((s) => s.cursor));

  // fresh HOT calls
  const hot = await db.collection<SignalCall>("signal_calls")
    .find({ spottedAt: { $gt: minCursor }, shadow: { $ne: true }, engine: 2, tier: "HOT" }).limit(50).toArray();

  // who follows whom
  const userIds = [...new Set(subs.map((s) => s.userId))];
  const follows = await db.collection("trader_follows").find({ followerId: { $in: userIds } }, { projection: { _id: 0, followerId: 1, traderId: 1 } }).limit(20000).toArray();
  const followMap = new Map<string, Set<string>>();
  for (const f of follows) {
    const set = followMap.get(String(f.followerId)) ?? new Set<string>();
    set.add(String(f.traderId));
    followMap.set(String(f.followerId), set);
  }
  const traderIds = [...new Set(follows.map((f) => String(f.traderId)))];

  type Ev = { traderId: string; name: string; type: "open" | "closed"; mint: string; symbol: string; entryMcap?: number; pnlPct?: number; ts: number };
  const events: Ev[] = [];
  type Co = { userId: string; name: string; text: string; mint?: string; id: string; ts: number };
  const callouts: Co[] = [];
  if (traderIds.length) {
    const [profiles, tradeDocs, posDocs, coDocs] = await Promise.all([
      db.collection("profiles").find({ userId: { $in: traderIds }, publicTrading: true }, { projection: { _id: 0, userId: 1, displayName: 1 } }).toArray(),
      db.collection("trades").find({ userId: { $in: traderIds } }, { projection: { _id: 0, userId: 1, trades: 1 } }).toArray(),
      db.collection("positions").find({ userId: { $in: traderIds } }, { projection: { _id: 0, userId: 1, positions: 1 } }).toArray(),
      db.collection("callouts").find({ userId: { $in: traderIds }, parentId: { $exists: false } }, { projection: { _id: 1, userId: 1, mint: 1, text: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(120).toArray(),
    ]);
    const names = new Map(profiles.map((p) => [String(p.userId), String(p.displayName || "A trader you follow")]));
    const publicIds = new Set(profiles.map((p) => String(p.userId)));
    for (const d of posDocs) {
      if (!publicIds.has(String(d.userId)) || !Array.isArray(d.positions)) continue;
      for (const p of d.positions as { mint?: string; symbol?: string; status?: string; entryMcap?: number; ts?: number }[]) {
        if (p.status === "watching" && p.mint && typeof p.ts === "number") events.push({ traderId: String(d.userId), name: names.get(String(d.userId)) ?? "", type: "open", mint: p.mint, symbol: p.symbol ?? "", entryMcap: p.entryMcap, ts: p.ts });
      }
    }
    for (const d of tradeDocs) {
      if (!publicIds.has(String(d.userId)) || !Array.isArray(d.trades)) continue;
      for (const t of d.trades as { mint?: string; symbol?: string; status?: string; pnlPct?: number; ts?: number }[]) {
        if (typeof t.pnlPct === "number" && t.status !== "failed" && t.mint && typeof t.ts === "number") events.push({ traderId: String(d.userId), name: names.get(String(d.userId)) ?? "", type: "closed", mint: t.mint, symbol: t.symbol ?? "", pnlPct: t.pnlPct, ts: t.ts });
      }
    }
    for (const c of coDocs) {
      if (!publicIds.has(String(c.userId))) continue;
      const ts = typeof c.createdAt === "number" ? c.createdAt : c.createdAt ? new Date(c.createdAt as Date).getTime() : 0;
      if (ts > 0) callouts.push({ userId: String(c.userId), name: names.get(String(c.userId)) ?? "", text: String(c.text ?? ""), mint: c.mint ? String(c.mint) : undefined, id: String(c._id), ts });
    }
  }

  // saved tokens
  const savedMints = [...new Set(subs.filter((s) => s.prefs.saved).flatMap((s) => s.saved.map((x) => x.mint)))].slice(0, 300);
  const prices = savedMints.length ? await jupPrices(savedMints) : {};

  const dead: string[] = [];
  const writes: Parameters<typeof col.bulkWrite>[0] = [];
  for (const sub of subs) {
    const msgs: Msg[] = [];
    const cur = sub.cursor;
    if (sub.prefs.signal) {
      for (const c of hot) if (c.spottedAt > cur) msgs.push({ title: `Fresh call: $${c.symbol}`, body: `Spotted at ${k(c.spottedMcap)} · score ${Math.round(c.score)}`, url: `/app/token/${c.address}`, tag: `s:${c.address}` });
    }
    const mine = followMap.get(sub.userId);
    if (mine && sub.prefs.trader) {
      for (const e of events) {
        if (!mine.has(e.traderId) || e.ts <= cur || e.ts > now) continue;
        msgs.push({
          title: `${e.name} ${e.type === "open" ? "bought" : "closed"} ${e.symbol ? `$${e.symbol}` : "a token"}`,
          body: e.type === "open" ? `In at ${k(e.entryMcap)} market cap` : `${(e.pnlPct ?? 0) >= 0 ? "+" : ""}${Math.round(e.pnlPct ?? 0)}% result`,
          url: `/app/token/${e.mint}`, tag: `t:${e.traderId}:${e.mint}:${e.type}`,
        });
      }
    }
    if (mine && sub.prefs.callout) {
      for (const c of callouts) {
        if (!mine.has(c.userId) || c.ts <= cur || c.ts > now) continue;
        msgs.push({ title: `${c.name} posted a callout`, body: c.text.slice(0, 110), url: c.mint ? `/app/token/${c.mint}` : `/app/u/${encodeURIComponent(c.userId)}`, tag: `c:${c.id}` });
      }
    }
    const base = { ...sub.base };
    if (sub.prefs.saved) {
      for (const s of sub.saved) {
        const px = prices[s.mint];
        if (!px) continue;
        const b = base[s.mint];
        if (!b) { base[s.mint] = px; continue; }
        const move = px / b - 1;
        if (Math.abs(move) >= SAVED_MOVE) {
          msgs.push({ title: `$${s.symbol} is ${move > 0 ? "up" : "down"} ${Math.abs(Math.round(move * 100))}%`, body: "A token you saved just moved", url: `/app/token/${s.mint}`, tag: `p:${s.mint}` });
          base[s.mint] = px;
        }
      }
    }

    let alive = true;
    const batch = msgs.slice(0, MAX_PER_RUN);
    if (msgs.length > MAX_PER_RUN) batch[MAX_PER_RUN - 1] = { title: `${msgs.length - MAX_PER_RUN + 1} more updates on Wraith`, body: "Open the app to see everything new.", url: "/app", tag: "more" };
    for (const m of batch) {
      if (!alive) break;
      alive = await deliver(sub, m);
      if (alive) res.sent++;
    }
    if (!alive) { dead.push(sub._id); continue; }
    writes.push({ updateOne: { filter: { _id: sub._id }, update: { $set: { cursor: now, base } } } });
  }
  if (writes.length) await col.bulkWrite(writes, { ordered: false }).catch((e) => console.error("[push] cursor update", e));
  if (dead.length) { await col.deleteMany({ _id: { $in: dead } }); res.removed = dead.length; }
  return res;
}
