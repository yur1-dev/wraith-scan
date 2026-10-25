"use client";

import { useCallback, useEffect, useState } from "react";
import { Repeat2 } from "lucide-react";

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
  reposts: number;
  comments: number;
  imageUrl?: string | null;
  repostedFrom?: { displayName: string; username: string | null; text: string } | null;
  position: {
    symbol: string;
    entryMcap: number;
    currentPnlPct: number;
  } | null;
}

function timeAgo(ts: number) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function mcapLabel(v?: number | null) {
  if (!v || !Number.isFinite(v)) return null;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export default function ProfileCallouts({ userId }: { userId: string }) {
  const [callouts, setCallouts] = useState<CalloutItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(`/api/callouts?userId=${encodeURIComponent(userId)}&limit=20`);
      const d = await r.json();
      if (r.ok) setCallouts(d.callouts ?? []);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    setCallouts([]);
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="profile-callouts-empty">
        <div className="callouts-loading-dot" /><div className="callouts-loading-dot" /><div className="callouts-loading-dot" />
      </div>
    );
  }

  if (callouts.length === 0) {
    return (
      <div className="profile-callouts-empty">
        <strong>No callouts yet</strong>
        <span>Open a token and share your take to see it here.</span>
      </div>
    );
  }

  return (
    <div className="profile-callouts-feed">
      {callouts.map((c) => (
        <div key={c.id} className="profile-callout-card">
          {c.repostedFrom && (
            <div className="callout-repost-banner">
              <Repeat2 size={11} />
              <span>Reposted from {c.repostedFrom.displayName}</span>
            </div>
          )}
          <div className="profile-callout-top">
            <span className="profile-callout-age">{timeAgo(c.createdAt)}</span>
            {c.mcapAtPost && <span className="callout-mcap-badge">{mcapLabel(c.mcapAtPost)} MC</span>}
          </div>
          <p className="callout-text">{c.text}</p>
          {c.imageUrl && (
            <div className="callout-img-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.imageUrl} alt="" className="callout-img" />
            </div>
          )}
          {c.position && (
            <div className="callout-position">
              <span className="callout-position-label">Position</span>
              <span className="callout-position-symbol">{c.position.symbol}</span>
              <span className="callout-position-entry">Entry {mcapLabel(c.position.entryMcap)}</span>
              <span className={`callout-position-pnl${c.position.currentPnlPct >= 0 ? " is-positive" : " is-negative"}`}>
                {c.position.currentPnlPct > 0 ? "+" : ""}{c.position.currentPnlPct.toFixed(1)}%
              </span>
            </div>
          )}
          <div className="profile-callout-foot">
            <span>❤ {c.hearts}</span>
            {c.reposts > 0 && <span>↺ {c.reposts}</span>}
            {c.comments > 0 && <span>💬 {c.comments}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
