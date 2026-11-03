"use client";
// "Download app" button + sheet: Android APK (until Play Store), Play Store (soon), iPhone via Add to Home Screen.
import { useEffect, useState } from "react";

const APK_URL = "/downloads/wraith.apk";

export default function DownloadApp({ className = "ws-btn lg", label = "Download app" }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [os, setOs] = useState<"android" | "ios" | "other">("other");

  useEffect(() => {
    const ua = navigator.userAgent || "";
    setOs(/android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) ? "ios" : "other");
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const android = (
    <section className="dl-card">
      <h4>Android</h4>
      <a className="dl-btn" href={APK_URL} download="WRAITH.apk">Download APK</a>
      <ol>
        <li>Open the downloaded file.</li>
        <li>If Android asks, allow installs from this source.</li>
        <li>Tap Install, then open WRAITH.</li>
      </ol>
      <span className="dl-soon">Google Play: coming soon</span>
    </section>
  );
  const ios = (
    <section className="dl-card">
      <h4>iPhone / iPad</h4>
      <ol>
        <li>Open <b>wraith.farm</b> in Safari.</li>
        <li>Tap the Share button.</li>
        <li>Choose <b>Add to Home Screen</b>.</li>
      </ol>
      <span className="dl-soon">App Store: coming soon</span>
    </section>
  );

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className="dl-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="dl-sheet" role="dialog" aria-modal="true" aria-label="Download the WRAITH app">
            <button type="button" className="dl-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            <h3>Get WRAITH on your phone</h3>
            <p className="dl-sub">Same account, same wallets. Install it now, store listings are coming.</p>
            {os === "ios" ? <>{ios}{android}</> : <>{android}{ios}</>}
          </div>
        </div>
      )}
    </>
  );
}
