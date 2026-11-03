"use client";

// Native Android app only: the app adds ?fcm=<token> to the address it opens. This saves that token and
// links it to the signed-in account so the server can send real (Firebase) push notifications.

import { useEffect } from "react";
import { readTokenFavorites, TOKEN_FAVORITES_EVENT } from "@/lib/tokenFavorites";

const TOKEN_KEY = "wraith_fcm_token";
const LINKED_KEY = "wraith_fcm_linked";
const OFF_KEY = "wraith_fcm_off";
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* blocked */ } };

export default function FcmLink() {
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const t = u.searchParams.get("fcm");
      if (t) {
        if (get(TOKEN_KEY) !== t) set(LINKED_KEY, null);
        set(TOKEN_KEY, t);
        u.searchParams.delete("fcm");
        window.history.replaceState(null, "", u.pathname + u.search + u.hash);
      }
    } catch { /* ignore */ }

    let stopped = false;
    let tries = 0;

    const link = async (force = false) => {
      const token = get(TOKEN_KEY);
      if (!token || get(OFF_KEY)) return;
      if (!force && get(LINKED_KEY) === token) return;
      try {
        const r = await fetch("/api/push/fcm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            prefs: { trader: true, callout: true, saved: true, signal: true },
            saved: readTokenFavorites().filter((f) => f.contractAddress && SOL.test(f.contractAddress)).map((f) => ({ mint: f.contractAddress, symbol: f.keyword })),
          }),
        });
        if (r.ok) {
          set(LINKED_KEY, token);
          window.dispatchEvent(new Event("wraith:fcm-linked"));
        }
      } catch { /* retry */ }
    };

    void link();
    // you may sign in after the app opened, so keep trying for a while
    const timer = window.setInterval(() => {
      if (stopped || ++tries > 80) { window.clearInterval(timer); return; }
      void link();
    }, 15_000);
    const onFavs = () => { if (get(LINKED_KEY)) void link(true); };
    const onRelink = () => { set(OFF_KEY, null); void link(true); };
    window.addEventListener(TOKEN_FAVORITES_EVENT, onFavs);
    window.addEventListener("wraith:fcm-relink", onRelink);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener(TOKEN_FAVORITES_EVENT, onFavs);
      window.removeEventListener("wraith:fcm-relink", onRelink);
    };
  }, []);
  return null;
}
