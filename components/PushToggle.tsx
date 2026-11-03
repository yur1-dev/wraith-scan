"use client";

// Turns real phone notifications on/off for this device and keeps the server in sync
// with what you want to hear about (categories + the tokens you saved).

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import { readTokenFavorites, TOKEN_FAVORITES_EVENT } from "@/lib/tokenFavorites";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function key(b64: string) {
  const p = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(p);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Prefs = { trader: boolean; callout: boolean; saved: boolean; signal: boolean };
type State = "checking" | "unsupported" | "off" | "on" | "blocked";

export default function PushToggle({ prefs }: { prefs: Prefs }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const payload = useCallback((sub: PushSubscription) => ({
    subscription: sub.toJSON(),
    prefs: prefsRef.current,
    saved: readTokenFavorites()
      .filter((f) => f.contractAddress && SOL.test(f.contractAddress))
      .map((f) => ({ mint: f.contractAddress, symbol: f.keyword })),
  }), []);

  const sync = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return;
      await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(sub)) });
    } catch { /* retry next change */ }
  }, [payload]);

  useEffect(() => {
    if (!VAPID || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setState("unsupported"); return; }
    if (Notification.permission === "denied") { setState("blocked"); return; }
    navigator.serviceWorker.getRegistration("/sw.js")
      .then((r) => r?.pushManager.getSubscription())
      .then((s) => setState(s && Notification.permission === "granted" ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  // keep the server in step when you change categories or save / unsave a token
  useEffect(() => {
    if (state !== "on") return;
    const t = setTimeout(() => void sync(), 600);
    return () => clearTimeout(t);
  }, [state, prefs, sync]);
  useEffect(() => {
    if (state !== "on") return;
    const h = () => void sync();
    window.addEventListener(TOKEN_FAVORITES_EVENT, h);
    return () => window.removeEventListener(TOKEN_FAVORITES_EVENT, h);
  }, [state, sync]);

  const enable = async () => {
    setBusy(true); setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID) as BufferSource });
      const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(sub)) });
      if (!r.ok) throw new Error("save failed");
      setState("on");
      await fetch("/api/push/test", { method: "POST" }).catch(() => undefined);
    } catch {
      setMsg("Could not turn on notifications on this device.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true); setMsg("");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  };

  if (state === "checking" || !VAPID) return null;
  if (state === "unsupported") {
    return <p className="wx-push-note">Phone notifications need a supported browser. On iPhone, add Wraith to your Home Screen first.</p>;
  }
  if (state === "blocked") {
    return <p className="wx-push-note">Notifications are blocked for Wraith. Turn them on in your phone's app settings, then come back.</p>;
  }
  return (
    <div className="wx-push">
      {state === "on" ? (
        <>
          <span><BellRing size={15} /> Phone notifications are on</span>
          <span>
            <button type="button" disabled={busy} onClick={() => void fetch("/api/push/test", { method: "POST" })}>Send test</button>
            <button type="button" disabled={busy} onClick={() => void disable()}>Turn off</button>
          </span>
        </>
      ) : (
        <>
          <span><BellRing size={15} /> Get alerts on your phone, even when the app is closed</span>
          <button type="button" className="primary" disabled={busy} onClick={() => void enable()}>{busy ? "…" : "Turn on"}</button>
        </>
      )}
      {msg && <small>{msg}</small>}
    </div>
  );
}
