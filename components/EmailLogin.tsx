"use client";

// In-page email sign-in (one-time code). Works inside the Android app window, where Google's sign-in page is blocked.
import { useState } from "react";
import { useLoginWithEmail } from "@privy-io/react-auth";

const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function EmailLogin({ disabled, startOpen }: { disabled?: boolean; startOpen?: boolean }) {
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(!!startOpen);
  const sent = state.status === "awaiting-code-input" || state.status === "submitting-code";
  const busy = state.status === "sending-code" || state.status === "submitting-code" || disabled;

  const send = async () => {
    setErr(null);
    if (!MAIL_RE.test(email.trim())) { setErr("Enter a valid email address."); return; }
    try { await sendCode({ email: email.trim() }); } catch (e) { setErr(e instanceof Error ? e.message : "Could not send the code."); }
  };
  const verify = async () => {
    setErr(null);
    if (code.trim().length < 6) { setErr("Enter the 6-digit code."); return; }
    try { await loginWithCode({ code: code.trim() }); } catch (e) { setErr(e instanceof Error ? e.message : "That code did not work."); }
  };

  if (!open) {
    return <button type="button" className="wl-email-toggle" onClick={() => setOpen(true)} disabled={disabled}>Continue with email</button>;
  }
  return (
    <div className="wl-email">
      {!sent ? (
        <>
          <input type="email" inputMode="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
          <button type="button" className="wl-email-go" disabled={busy} onClick={() => void send()}>{state.status === "sending-code" ? "Sending…" : "Send code"}</button>
        </>
      ) : (
        <>
          <p>We sent a code to <b>{email.trim()}</b></p>
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") void verify(); }} />
          <button type="button" className="wl-email-go" disabled={busy} onClick={() => void verify()}>{state.status === "submitting-code" ? "Checking…" : "Sign in"}</button>
        </>
      )}
      {(err || state.status === "error") && <div className="wl-err" style={{ marginTop: 10 }}>{err ?? "Something went wrong. Try again."}</div>}
    </div>
  );
}
