"use client";

import { useEffect, useState } from "react";
import { UserRoundPlus, UserRoundCheck } from "lucide-react";

export default function TraderFollowButton({
  traderId,
  initialFollowing = false,
  statusKnown = false,
  onChange,
  compact = false,
}: {
  traderId: string;
  initialFollowing?: boolean;
  statusKnown?: boolean;
  onChange?: (following: boolean, followers?: number) => void;
  compact?: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [followers, setFollowers] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (statusKnown) return;
    let active = true;
    fetch(`/api/traders/following?traderId=${encodeURIComponent(traderId)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) return;
        if (active) {
          setFollowing(result.following === true);
          setFollowers(typeof result.followers === "number" ? result.followers : null);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [statusKnown, traderId]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = following
        ? await fetch(`/api/traders/following?traderId=${encodeURIComponent(traderId)}`, { method: "DELETE" })
        : await fetch("/api/traders/following", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ traderId }),
          });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update your following list.");
      const next = result.following === true;
      setFollowing(next);
      if (typeof result.followers === "number") setFollowers(result.followers);
      onChange?.(next, result.followers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update your following list.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        title={error || (following ? "Unfollow trader" : "Follow trader")}
        aria-label={following ? "Unfollow trader" : "Follow trader"}
        style={{
          minHeight: compact ? 30 : 38,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          padding: compact ? "0 10px" : "0 15px",
          border: `1px solid ${following ? "var(--border)" : "var(--orange)"}`,
          borderRadius: 9,
          background: following ? "var(--surface-raised)" : "var(--orange)",
          color: following ? "var(--text)" : "#fff7f2",
          fontSize: compact ? 11 : 13,
          fontWeight: 700,
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.65 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {following ? <UserRoundCheck size={14} /> : <UserRoundPlus size={14} />}
        {busy ? "Saving" : following ? "Following" : "Follow"}
      </button>
    </span>
  );
}
