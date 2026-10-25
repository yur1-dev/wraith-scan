"use client";

import { CALLOUT_POSTED_EVENT, useLiveRefresh } from "@/lib/useLiveRefresh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ImageIcon, Repeat2, MessageCircle } from "lucide-react";

interface CalloutPosition {
  amountSol: number;
  entryMcap: number;
  currentMcap: number;
  currentPnlPct: number;
  symbol: string;
}

interface Callout {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  avatarDataUrl: string;
  text: string;
  createdAt: number;
  mcapAtPost: number | null;
  hearts: number;
  hearted: boolean;
  reposts: number;
  reposted: boolean;
  comments: number;
  imageUrl?: string | null;
  position: CalloutPosition | null;
  repostedFrom?: { displayName: string; username: string | null; text: string } | null;
}

function timeAgo(ts: number) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
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

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export function TokenCallouts({ mint, currentMcap }: { mint: string; currentMcap?: number | null }) {
  const { authenticated, login } = usePrivy();
  // which callout just got a like / repost (drives the small pop animations)
  const [fx, setFx] = useState<{ id: string; kind: "heart" | "repost"; n: number } | null>(null);
  const fxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fire = (id: string, kind: "heart" | "repost") => {
    if (fxTimer.current) clearTimeout(fxTimer.current);
    setFx({ id, kind, n: Date.now() });
    fxTimer.current = setTimeout(() => setFx(null), 800);
  };
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postErr, setPostErr] = useState("");
  const [commentOpen, setCommentOpen] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [repostingId, setRepostingId] = useState<string | null>(null);
  const [canPost, setCanPost] = useState<boolean | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const TEXT_MAX = 280;

  const load = useCallback(async () => {
    if (!mint) return;
    try {
      const r = await fetch(`/api/callouts?mint=${encodeURIComponent(mint)}&limit=30`);
      const d = await r.json();
      if (r.ok) {
        setCallouts(d.callouts ?? []);
        setTotal(d.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [mint]);

  useEffect(() => {
    setLoading(true);
    setCallouts([]);
    void load();
  }, [load]);
  useLiveRefresh(() => void load(), 8000);

  const loadCanPost = useCallback(async () => {
    if (!mint || !authenticated) return;
    try {
      const r = await fetch(`/api/token-activity?mint=${encodeURIComponent(mint)}`, { cache: "no-store" });
      const d: { canPost?: boolean } = await r.json();
      setCanPost(!!d.canPost);
    } catch {
      setCanPost(false);
    }
  }, [mint, authenticated]);
  useEffect(() => {
    setCanPost(null);
    void loadCanPost();
    const h = () => void loadCanPost();
    window.addEventListener("wraith:trade-recorded", h);
    return () => window.removeEventListener("wraith:trade-recorded", h);
  }, [loadCanPost]);

  const handleImage = (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setPostErr("Image must be under 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const post = async () => {
    if (!text.trim() || posting) return;
    setPosting(true);
    setPostErr("");
    try {
      const r = await fetch("/api/callouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint, text: text.trim(), mcapAtPost: currentMcap ?? null, imageUrl: imagePreview }),
      });
      const d = await r.json();
      if (!r.ok) { setPostErr(d.error ?? "Could not post."); return; }
      setText("");
      setImagePreview(null);
      await load();
      window.dispatchEvent(new Event(CALLOUT_POSTED_EVENT));
    } catch {
      setPostErr("Could not post.");
    } finally {
      setPosting(false);
    }
  };

  const toggleHeart = async (callout: Callout) => {
    if (!authenticated) { login(); return; }
    if (!callout.hearted) fire(callout.id, "heart");
    setCallouts((prev) =>
      prev.map((c) =>
        c.id === callout.id
          ? { ...c, hearted: !c.hearted, hearts: c.hearted ? c.hearts - 1 : c.hearts + 1 }
          : c,
      ),
    );
    try {
      await fetch(`/api/callouts/${callout.id}/heart`, { method: "POST" });
    } catch {
      await load();
    }
  };

  const repost = async (callout: Callout) => {
    if (!authenticated) { login(); return; }
    if (repostingId) return;
    if (!callout.reposted) fire(callout.id, "repost");
    setRepostingId(callout.id);
    setCallouts((prev) =>
      prev.map((c) =>
        c.id === callout.id
          ? { ...c, reposted: !c.reposted, reposts: c.reposted ? (c.reposts || 1) - 1 : (c.reposts || 0) + 1 }
          : c,
      ),
    );
    try {
      await fetch(`/api/callouts/${callout.id}/repost`, { method: "POST" });
    } catch {
      await load();
    } finally {
      setRepostingId(null);
    }
  };

  const submitComment = async (callout: Callout) => {
    if (!commentText.trim() || posting) return;
    setPosting(true);
    try {
      const r = await fetch("/api/callouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint, text: commentText.trim(), mcapAtPost: currentMcap ?? null, parentId: callout.id }),
      });
      if (r.ok) {
        setCommentText("");
        setCommentOpen(null);
        setPostErr("");
        await load();
        window.dispatchEvent(new Event(CALLOUT_POSTED_EVENT));
      } else {
        const d: { error?: string } = await r.json().catch(() => ({}));
        setPostErr(d.error || "Could not post comment.");
      }
    } catch { /* ignore */ } finally {
      setPosting(false);
    }
  };

  return (
    <div className="callouts-shell">
      {/* Compose */}
      {authenticated && canPost === false ? (
        <div className="callouts-compose callouts-locked">
          <b>Trade it to post intel</b>
          <span>Buy or sell this token on Wraith and you can share your take here.</span>
        </div>
      ) : authenticated ? (
        <div className="callouts-compose">
          <textarea
            ref={textareaRef}
            className="callouts-textarea"
            placeholder="What's your take? Your open position on this token will be attached automatically."
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={TEXT_MAX}
            rows={3}
          />
          {imagePreview && (
            <div className="callouts-img-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="preview" />
              <button type="button" onClick={() => setImagePreview(null)} aria-label="Remove image">✕</button>
            </div>
          )}
          <div className="callouts-compose-foot">
            {postErr && <span className="callouts-err">{postErr}</span>}
            <button
              type="button"
              className="callouts-img-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image"
            >
              <ImageIcon size={14} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => handleImage(e.target.files?.[0])}
            />
            <span className="callouts-charcount">{text.length}/{TEXT_MAX}</span>
            <button
              type="button"
              className="callouts-post-btn"
              onClick={() => void post()}
              disabled={posting || !text.trim()}
            >
              {posting ? "Posting…" : "Post callout"}
            </button>
          </div>
        </div>
      ) : (
        <div className="callouts-auth-prompt">
          <span>Sign in to post callouts</span>
        </div>
      )}

      {/* Feed */}
      <div className="callouts-feed">
        {loading && (
          <div className="callouts-empty">
            <div className="callouts-loading-dot" />
            <div className="callouts-loading-dot" />
            <div className="callouts-loading-dot" />
          </div>
        )}
        {!loading && callouts.length === 0 && (
          <div className="callouts-empty">
            <strong>No callouts yet</strong>
            <span>Be the first to share your take on this token.</span>
          </div>
        )}
        {callouts.map((c) => (
          <div key={c.id} className="callout-card">
            {/* Repost attribution */}
            {c.repostedFrom && (
              <div className="callout-repost-banner">
                <Repeat2 size={11} />
                <span>Reposted from {c.repostedFrom.displayName}</span>
              </div>
            )}

            {/* Header */}
            <div className="callout-header">
              <div className="callout-avatar">
                {c.avatarDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.avatarDataUrl} alt="" className="callout-avatar-img" />
                ) : (
                  <span className="callout-avatar-fallback">{c.displayName.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="callout-meta">
                <Link href={`/app/u/${encodeURIComponent(c.username ?? c.userId)}`} className="callout-name">
                  {c.displayName}
                </Link>
                {c.username && <span className="callout-handle">@{c.username}</span>}
              </div>
              <span className="callout-age">{timeAgo(c.createdAt)} ago</span>
              {c.mcapAtPost && (
                <span className="callout-mcap-badge">{mcapLabel(c.mcapAtPost)} MC</span>
              )}
            </div>

            {/* Text */}
            <p className="callout-text">{c.text}</p>

            {/* Image */}
            {c.imageUrl && (
              <div className="callout-img-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageUrl} alt="" className="callout-img" />
              </div>
            )}

            {/* Position card */}
            {c.position && (
              <div className="callout-position">
                <span className="callout-position-label">Position</span>
                <span className="callout-position-symbol">{c.position.symbol}</span>
                <span className="callout-position-entry">Entry {mcapLabel(c.position.entryMcap)}</span>
                <span className={`callout-position-pnl${(c.position.currentPnlPct ?? 0) >= 0 ? " is-positive" : " is-negative"}`}>
                  {(c.position.currentPnlPct ?? 0) > 0 ? "+" : ""}{(c.position.currentPnlPct ?? 0).toFixed(1)}%
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="callout-actions">
              <button
                type="button"
                className={`callout-heart-btn${c.hearted ? " hearted" : ""}`}
                onClick={() => void toggleHeart(c)}
                aria-label={c.hearted ? "Unlike" : "Like"}
                aria-pressed={c.hearted}
              >
                <span className={`callout-fx-wrap${fx?.id === c.id && fx.kind === "heart" ? " pop" : ""}`} key={fx?.id === c.id && fx.kind === "heart" ? fx.n : "h"}>
                  <HeartIcon filled={c.hearted} />
                  {fx?.id === c.id && fx.kind === "heart" && (
                    <span className="callout-burst" aria-hidden="true">
                      {Array.from({ length: 8 }).map((_, i) => <i key={i} style={{ ["--a" as string]: `${i * 45}deg` }} />)}
                    </span>
                  )}
                </span>
                {c.hearts > 0 && <span className="callout-count" key={c.hearts}>{c.hearts}</span>}
              </button>

              <button
                type="button"
                className={`callout-action-btn${c.reposted ? " active" : ""}`}
                onClick={() => void repost(c)}
                disabled={repostingId === c.id}
                aria-label="Repost"
                aria-pressed={c.reposted}
                title="Repost callout"
              >
                <span className={`callout-fx-wrap${fx?.id === c.id && fx.kind === "repost" ? " spin" : ""}`} key={fx?.id === c.id && fx.kind === "repost" ? fx.n : "r"}>
                  <Repeat2 size={16} />
                </span>
                {c.reposts > 0 && <span className="callout-count" key={c.reposts}>{c.reposts}</span>}
              </button>

              <button
                type="button"
                className={`callout-action-btn${commentOpen === c.id ? " active" : ""}`}
                onClick={() => { if (!authenticated) { login(); return; } setCommentOpen(commentOpen === c.id ? null : c.id); }}
                aria-label="Comment"
                title="Add a comment"
              >
                <MessageCircle size={16} />
                {c.comments > 0 && <span>{c.comments}</span>}
              </button>
            </div>

            {/* Inline comment box */}
            {commentOpen === c.id && (
              <div className="callout-comment-box">
                <textarea
                  className="callouts-textarea"
                  placeholder="Add your reply…"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  maxLength={TEXT_MAX}
                  rows={2}
                  autoFocus
                />
                <div className="callouts-compose-foot">
                  <span className="callouts-charcount">{commentText.length}/{TEXT_MAX}</span>
                  <button
                    type="button"
                    className="callouts-post-btn"
                    onClick={() => void submitComment(c)}
                    disabled={posting || !commentText.trim()}
                  >
                    {posting ? "Posting…" : "Reply"}
                  </button>
                </div>
                {postErr && <div style={{ marginTop: 6, fontSize: 12, color: "#f87171" }}>{postErr}</div>}
              </div>
            )}
          </div>
        ))}
        {!loading && total > callouts.length && (
          <button type="button" className="callouts-load-more" onClick={() => void load()}>
            Show more
          </button>
        )}
      </div>
    </div>
  );
}
