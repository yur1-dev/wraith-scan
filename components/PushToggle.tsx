"use client";

// Turns real phone notifications on/off for this device and keeps the server in sync
// with what you want to hear about (categories + the tokens you saved).
// "Send test" fires one real alert and says in plain words what happened, so a silent phone is never a mystery.

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import { readTokenFavorites, TOKEN_FAVORITES_EVENT } from "@/lib/tokenFavorites";
import { enablePush } from "@/lib/pushClient";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TIPS = "If nothing pops up, open your phone's Settings → Apps → Wraith: allow Notifications, set Battery to Unrestricted and allow Auto-start.";

type Prefs = { trader: boolean; callout: boolean; saved: boolean; signal: boolean };
type State = "checking" | "unsupported" | "off" | "on" | "blocked";
type Report = {
  error?: string;
  sent?: number;
  configured?: { app: boolean; browser: boolean };
  registered?: { app: number; browser: number };
  results?: { kind: "app" | "browser"; ok: boolean; dead?: boolean; error?: string }[];
};
type Status = {
  configured: { app: boolean; browser: boolean };
  devices: { kind: "app" | "browser"; since: number; lastSentAt: number | null; lastError: string | null }[];
};

/** turns the server's test report into one plain sentence */
function explain(d: Report): { text: string; ok: boolean } {
  if (d.error) return { text: d.error, ok: false };
  const reg = d.registered ?? { app: 0, browser: 0 };
  const cfg = d.configured ?? { app: true, browser: true };
  const res = d.results ?? [];
  if (reg.app + reg.browser === 0) return { text: "The server still doesn't have this phone. Tap Turn off, then Turn on.", ok: false };
  if (!res.length) return { text: reg.app && !cfg.app ? "The server can't send to the Wraith app yet (Firebase key missing)." : "No active device found. Tap Turn off, then Turn on.", ok: false };
  const bad = res.find((r) => !r.ok);
  if (bad?.dead) return { text: "This phone's registration expired. Tap Turn off, then Turn on.", ok: false };
  if (bad) return { text: `Could not deliver (${bad.error ?? "unknown"}). Tap Turn off, then Turn on.`, ok: false };
  return { text: `Test sent. It should pop up in a few seconds. ${TIPS}`, ok: true };
}

function statusLine(s: Status): { text: string; bad: boolean } {
  if (!s.devices.length) return { text: "The server doesn't have this phone yet. Tap Send test to register it.", bad: true };
  if (!s.configured.app && s.devices.some((d) => d.kind === "app")) return { text: "The Wraith app is linked, but the server can't send app notifications yet.", bad: true };
  const d = s.devices[0];
  const what = s.devices.length > 1 ? `${s.devices.length} devices linked` : d.kind === "app" ? "Wraith app linked" : "This browser linked";
  if (d.lastError) return { text: `${what}, but the last alert failed (${d.lastError}). Tap Send test.`, bad: true };
  return { text: what, bad: false };
}

export default function PushToggle({ prefs }: { prefs: Prefs }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);
  const [perm, setPerm] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const fcmRef = useRef(false); // native Android push is linked
  const wantTest = useRef(false); // send a test alert as soon as the app finishes linking
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

  const check = useCallback(() => {
    if (fcmRef.current) { setState("on"); return; }
    // inside the Android app the phone permission is handled natively, so Chrome's (often stale) "denied" must not matter
    let nativeTok = false, nativeOff = false, nativeLinked = false;
    try {
      nativeTok = !!localStorage.getItem("wraith_fcm_token");
      nativeOff = !!localStorage.getItem("wraith_fcm_off");
      nativeLinked = !!localStorage.getItem("wraith_fcm_linked");
    } catch { /* blocked */ }
    if (nativeTok) {
      if (nativeLinked && !nativeOff) { fcmRef.current = true; setState("on"); } else setState("off");
      return;
    }
    if (!VAPID || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setState("unsupported"); return; }
    setPerm(Notification.permission);
    if (Notification.permission === "denied") { setState("blocked"); return; }
    navigator.serviceWorker.getRegistration("/sw.js")
      .then((r) => r?.pushManager.getSubscription())
      .then((s) => setState(s && Notification.permission === "granted" ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  const loadStatus = useCallback(() => {
    fetch("/api/push/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Status | null) => { if (d?.devices) setStatus(d); })
      .catch(() => undefined);
  }, []);

  const test = useCallback(async () => {
    setBusy(true); setMsg(""); setMsgOk(false);
    try {
      const run = async (): Promise<Report> => {
        const r = await fetch("/api/push/test", { method: "POST" });
        const d = (await r.json().catch(() => ({}))) as Report;
        if (!r.ok && !d.error) d.error = "Test failed. Try again.";
        return d;
      };
      let d = await run();
      if (!d.error && (d.registered?.app ?? 0) + (d.registered?.browser ?? 0) === 0) {
        // the server has no record of this phone: register it again and retry once
        let native = false;
        try { native = !!localStorage.getItem("wraith_fcm_token"); } catch { /* blocked */ }
        if (native) {
          window.dispatchEvent(new Event("wraith:fcm-relink"));
          await new Promise((res) => setTimeout(res, 2500));
        } else {
          await enablePush(prefsRef.current, true);
        }
        d = await run();
      }
      const e = explain(d);
      setMsg(e.text);
      setMsgOk(e.ok);
    } catch {
      setMsg("Test failed. Check your connection.");
    } finally {
      setBusy(false);
      loadStatus();
    }
  }, [loadStatus]);
  const testRef = useRef(test);
  testRef.current = test;

  // native Android push (Firebase): when the app has linked this phone, that is what "on" means
  useEffect(() => {
    const probe = () => {
      fetch("/api/push/fcm").then((r) => r.json()).then((d: { linked?: boolean }) => {
        if (d.linked) {
          fcmRef.current = true;
          setState("on");
          if (wantTest.current) { wantTest.current = false; void testRef.current(); }
        }
      }).catch(() => undefined);
    };
    probe();
    window.addEventListener("wraith:fcm-linked", probe);
    return () => window.removeEventListener("wraith:fcm-linked", probe);
  }, []);

  useEffect(() => {
    check();
    // re-check when you come back from the phone's Settings
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", check);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", check); };
  }, [check]);

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

  // what the server knows about this phone
  useEffect(() => {
    if (state === "on") loadStatus();
  }, [state, loadStatus]);

  const enable = async () => {
    setBusy(true); setMsg(""); setMsgOk(false);
    try {
      if (localStorage.getItem("wraith_fcm_token")) {
        // native app: link the phone for Firebase push instead of web push, then send a test alert
        wantTest.current = true;
        window.dispatchEvent(new Event("wraith:fcm-relink"));
        return;
      }
      const r = await enablePush(prefsRef.current, true);
      if (r !== "on") { setState(r === "blocked" ? "blocked" : "off"); return; }
      setState("on");
      await testRef.current();
    } catch {
      setMsg("Could not turn on notifications on this device.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true); setMsg(""); setMsgOk(false);
    try {
      if (fcmRef.current) {
        await fetch("/api/push/fcm", { method: "DELETE" }).catch(() => undefined);
        try { localStorage.setItem("wraith_fcm_off", "1"); localStorage.removeItem("wraith_fcm_linked"); } catch { /* blocked */ }
        fcmRef.current = false;
        setStatus(null);
        setState("off");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setStatus(null);
      setState("off");
    } finally {
      setBusy(false);
    }
  };

  if (state === "checking") return null;
  if (!VAPID && !fcmRef.current && state !== "on" && state !== "off") return null;
  if (state === "unsupported") {
    return <p className="wx-push-note">Phone notifications need a supported browser. On iPhone, add Wraith to your Home Screen first.</p>;
  }
  if (state === "blocked") {
    return (
      <div className="wx-push-note">
        <p style={{ margin: 0 }}>Notifications are blocked for Wraith. Switch them on in Settings → Apps → Wraith → Notifications, then come back here.</p>
        <p style={{ margin: "6px 0 0", opacity: 0.7, fontSize: 12 }}>Phone says: {perm || "denied"}</p>
        <button type="button" onClick={() => { check(); window.setTimeout(() => window.location.reload(), 300); }} style={{ marginTop: 8, padding: "7px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", fontWeight: 700, fontSize: 12.5 }}>Check again</button>
      </div>
    );
  }
  const line = state === "on" && status && !msg ? statusLine(status) : null;
  return (
    <div className="wx-push">
      {state === "on" ? (
        <>
          <span><BellRing size={15} /> Phone notifications are on</span>
          <span>
            <button type="button" disabled={busy} onClick={() => void test()}>{busy ? "…" : "Send test"}</button>
            <button type="button" disabled={busy} onClick={() => void disable()}>Turn off</button>
          </span>
        </>
      ) : (
        <>
          <span><BellRing size={15} /> Get alerts on your phone, even when the app is closed</span>
          <button type="button" className="primary" disabled={busy} onClick={() => void enable()}>{busy ? "…" : "Turn on"}</button>
        </>
      )}
      {line && <small style={line.bad ? undefined : { color: "var(--text-muted)" }}>{line.text}</small>}
      {msg && <small style={msgOk ? { color: "var(--text-muted)" } : undefined}>{msg}</small>}
    </div>
  );
}
