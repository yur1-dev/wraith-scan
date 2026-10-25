"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bookmark, Heart, MessageCircle, Repeat2, Rss, Send } from "lucide-react";
import { TokenIcon } from "@/components/TokenIcon";
import { useTokenMeta, type TokenMeta } from "@/lib/useTokenMeta";
import { CALLOUT_POSTED_EVENT, useLiveRefresh } from "@/lib/useLiveRefresh";
import { readTokenFavorites, toggleTokenFavorite, TOKEN_FAVORITES_EVENT } from "@/lib/tokenFavorites";

interface CalloutItem {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  avatarDataUrl: string;
  text: string;
  createdAt: number;
  mcapAtPost: number | null;
  hearts: number;
  hearted?: boolean;
  reposts: number;
  reposted?: boolean;
  comments: number;
  imageUrl?: string | null;
  repostedFrom?: { displayName: string; username: string | null } | null;
  mint?: string;
}
interface Comment {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  avatarDataUrl: string;
  text: string;
  createdAt: number;
}
interface Gate {
  signedIn: boolean;
  ok: boolean;
  heldUsd: number;
  minUsd: number;
  reason?: string;
}

function timeAgo(ts: number) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.max(0, Math.floor(diff))}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function mcapLabel(v?: number | null) {
  if (!v || !Number.isFinite(v)) return null;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function Face({ src, name, small }: { src?: string; name: string; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const cls = small ? "fi-avatar sm" : "fi-avatar";
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={cls} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className={`${cls} fallback`}>{name.slice(0, 1).toUpperCase()}</span>;
}

function Thread({ callout, meta, onCount }: { callout: CalloutItem; meta?: TokenMeta; onCount: (n: number) => void }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const symbol = meta?.symbol ?? "this token";

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/callouts/${callout.id}/comments`, { cache: "no-store" });
      const d: { comments?: Comment[] } = await r.json();
      if (r.ok) {
        setComments(d.comments ?? []);
        onCount((d.comments ?? []).length);
      } else setComments([]);
    } catch {
      setComments([]);
    }
  }, [callout.id, onCount]);

  useEffect(() => { void load(); }, [load]);

  // The balance check is slower, so it loads separately and never blocks the comments.
  useEffect(() => {
    let alive = true;
    void fetch(`/api/callouts/${callout.id}/gate`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { gate?: Gate }) => { if (alive && d.gate) setGate(d.gate); })
      .catch(() => {});
    return () => { alive = false; };
  }, [callout.id]);

  const send = async () => {
    if (!text.trim() || busy || !callout.mint) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/callouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint: callout.mint, text: text.trim(), parentId: callout.id, mcapAtPost: meta?.mcap ?? null }),
      });
      const d: { error?: string } = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || "Could not post comment."); return; }
      setText("");
      await load();
      window.dispatchEvent(new Event(CALLOUT_POSTED_EVENT));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fi-thread">
      {comments === null ? (
        <div className="fi-thread-note">Loading…</div>
      ) : comments.length === 0 ? (
        <div className="fi-thread-note">No comments yet.</div>
      ) : (
        comments.map((c) => (
          <div key={c.id} className="fi-comment">
            <Face src={c.avatarDataUrl} name={c.displayName} small />
            <div>
              <Link href={`/app/u/${encodeURIComponent(c.username ?? c.userId)}`} className="fi-name">{c.displayName}</Link>
              <span className="fi-age"> · {timeAgo(c.createdAt)}</span>
              <p>{c.text}</p>
            </div>
          </div>
        ))
      )}

      {gate && !gate.signedIn ? (
        <div className="fi-gate">Sign in to comment.</div>
      ) : gate && !gate.ok ? (
        <div className="fi-gate">
          <b>Hold ${gate.minUsd} of {symbol} to comment.</b>
          <span>{gate.reason ?? `You hold $${gate.heldUsd.toFixed(2)} right now.`}</span>
          {callout.mint && <Link href={`/app/token/${callout.mint}`}>Open {symbol} →</Link>}
        </div>
      ) : gate ? (
        <div className="fi-compose">
          <input value={text} maxLength={280} placeholder="Add a comment…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
          <button type="button" onClick={() => void send()} disabled={busy || !text.trim()} aria-label="Send comment"><Send size={14} /></button>
        </div>
      ) : null}
      {err && <div className="fi-err">{err}</div>}
    </div>
  );
}

export default function FollowingIntelSidebar() {
  const [callouts, setCallouts] = useState<CalloutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const meta = useTokenMeta(callouts.map((c) => c.mint ?? ""));

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/callouts?following=1&limit=20", { cache: "no-store" });
      const d = await r.json();
      if (r.ok) setCallouts(d.callouts ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(() => void load(), 8000);

  useEffect(() => {
    const sync = () => setSaved(new Set(readTokenFavorites().map((f) => f.contractAddress ?? "")));
    sync();
    window.addEventListener(TOKEN_FAVORITES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(TOKEN_FAVORITES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const patch = (id: string, fn: (c: CalloutItem) => CalloutItem) =>
    setCallouts((list) => list.map((c) => (c.id === id ? fn(c) : c)));

  const heart = async (c: CalloutItem) => {
    patch(c.id, (x) => ({ ...x, hearted: !x.hearted, hearts: x.hearts + (x.hearted ? -1 : 1) }));
    try {
      const r = await fetch(`/api/callouts/${c.id}/heart`, { method: "POST" });
      if (!r.ok) patch(c.id, () => c);
    } catch { patch(c.id, () => c); }
  };

  const repost = async (c: CalloutItem) => {
    patch(c.id, (x) => ({ ...x, reposted: !x.reposted, reposts: x.reposts + (x.reposted ? -1 : 1) }));
    try {
      const r = await fetch(`/api/callouts/${c.id}/repost`, { method: "POST" });
      if (!r.ok) patch(c.id, () => c);
    } catch { patch(c.id, () => c); }
  };

  const save = (c: CalloutItem) => {
    if (!c.mint) return;
    const m = meta[c.mint];
    toggleTokenFavorite({
      keyword: m?.symbol ?? c.mint.slice(0, 4).toUpperCase(),
      score: 0,
      posts: 0,
      source: "saved",
      contractAddress: c.mint,
      tokenImageUrl: m?.imageUrl,
      mcap: m?.mcap ?? c.mcapAtPost ?? undefined,
    });
  };

  return (
    <div className="fi-sidebar">
      <div className="fi-header">
        <Rss size={13} color="var(--orange-hot)" />
        <span className="fi-title">Following Intel</span>
      </div>

      {loading ? (
        <div className="fi-empty">
          <div className="callouts-loading-dot" />
          <div className="callouts-loading-dot" />
          <div className="callouts-loading-dot" />
        </div>
      ) : callouts.length === 0 ? (
        <div className="fi-empty">
          <strong>No intels yet</strong>
          <span>Follow traders to see their callouts here.</span>
        </div>
      ) : (
        <div className="fi-feed">
          {callouts.map((c) => {
            const m = c.mint ? meta[c.mint] : undefined;
            const isSaved = !!c.mint && saved.has(c.mint);
            return (
              <div key={c.id} className="fi-card">
                {c.repostedFrom && (
                  <div className="fi-repost-label">
                    <Repeat2 size={10} />
                    <span>Reposted from {c.repostedFrom.displayName}</span>
                  </div>
                )}
                <div className="fi-card-top">
                  <Face src={c.avatarDataUrl} name={c.displayName} />
                  <div className="fi-meta">
                    <Link href={`/app/u/${encodeURIComponent(c.username ?? c.userId)}`} className="fi-name">{c.displayName}</Link>
                    <span className="fi-age">{timeAgo(c.createdAt)}</span>
                  </div>
                  {c.mcapAtPost && <span className="fi-mcap">{mcapLabel(c.mcapAtPost)}</span>}
                </div>

                {c.mint && (
                  <Link href={`/app/token/${c.mint}`} className="fi-token">
                    <TokenIcon contractAddress={c.mint} imageUrl={m?.imageUrl} symbol={m?.symbol ?? "?"} size={18} />
                    <b>{m ? `$${m.symbol}` : `${c.mint.slice(0, 4)}…${c.mint.slice(-4)}`}</b>
                    {m && <span>{mcapLabel(m.mcap)} now</span>}
                  </Link>
                )}

                <p className="fi-text">{c.text}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.imageUrl && <img src={c.imageUrl} alt="" className="fi-img" />}

                <div className="fi-actions">
                  <button type="button" className={c.hearted ? "on heart" : ""} onClick={() => void heart(c)} aria-label="Like" aria-pressed={!!c.hearted}>
                    <Heart size={14} fill={c.hearted ? "currentColor" : "none"} /> {c.hearts > 0 && <span>{c.hearts}</span>}
                  </button>
                  <button type="button" className={openThread === c.id ? "on" : ""} onClick={() => setOpenThread(openThread === c.id ? null : c.id)} aria-label="Comments" aria-expanded={openThread === c.id}>
                    <MessageCircle size={14} /> {c.comments > 0 && <span>{c.comments}</span>}
                  </button>
                  <button type="button" className={c.reposted ? "on repost" : ""} onClick={() => void repost(c)} aria-label="Repost" aria-pressed={!!c.reposted}>
                    <Repeat2 size={15} /> {c.reposts > 0 && <span>{c.reposts}</span>}
                  </button>
                  <button type="button" className={isSaved ? "on save" : ""} onClick={() => save(c)} aria-label={isSaved ? "Remove saved token" : "Save token"} title={isSaved ? "Saved. Click to remove" : "Save this token"} aria-pressed={isSaved}>
                    <Bookmark size={14} fill={isSaved ? "currentColor" : "none"} />
                  </button>
                </div>

                {openThread === c.id && (
                  <Thread callout={c} meta={m} onCount={(n) => patch(c.id, (x) => ({ ...x, comments: n }))} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
