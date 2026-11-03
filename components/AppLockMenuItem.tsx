"use client";

import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { appLockEnabled, appLockSupported, disableAppLock, enableAppLock } from "@/components/AppLock";

/** Profile-menu row: turn the fingerprint / face / screen-lock on or off. */
export default function AppLockMenuItem() {
  const [on, setOn] = useState(false);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setOk(appLockSupported());
    const sync = () => setOn(appLockEnabled());
    sync();
    window.addEventListener("wraith:applock-changed", sync);
    return () => window.removeEventListener("wraith:applock-changed", sync);
  }, []);

  if (!ok) return null;

  const toggle = async () => {
    if (busy) return;
    setMsg("");
    if (on) { disableAppLock(); return; }
    setBusy(true);
    try {
      const done = await enableAppLock();
      if (!done) setMsg("Not enabled");
      else { try { localStorage.setItem("wraith_last_active", String(Date.now())); } catch {} }
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setMsg(name === "NotAllowedError" ? "Cancelled" : "Set a screen lock on your phone first");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="wraith-profile-menu-item" type="button" role="menuitem" onClick={() => void toggle()} disabled={busy}>
      <Fingerprint size={17} strokeWidth={1.8} />
      <span className="wraith-profile-menu-label">Fingerprint unlock</span>
      <span className="wraith-profile-menu-detail">{busy ? "…" : msg || (on ? "On" : "Off")}</span>
    </button>
  );
}
