"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};

const ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: "Failed to start Google sign-in.",
  OAuthCallback: "Google sign-in was cancelled or failed.",
  OAuthCreateAccount: "Could not create your account. Try again.",
  EmailCreateAccount: "Could not create your account. Try again.",
  Callback: "Sign-in callback error. Try again.",
  OAuthAccountNotLinked: "This email is linked to a different provider.",
  default: "Sign-in failed. Please try again.",
};

function GoogleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 48 48"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.14 0 5.95 1.08 8.17 2.86l6.09-6.09C34.46 3.04 29.53 1 24 1 14.82 1 7.07 6.48 3.64 14.22l7.1 5.52C12.48 13.48 17.77 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.52 24.5c0-1.64-.15-3.22-.43-4.74H24v8.98h12.67c-.55 2.9-2.2 5.36-4.68 7.01l7.18 5.58C43.36 37.28 46.52 31.36 46.52 24.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.74 28.26A14.5 14.5 0 0 1 9.5 24c0-1.49.26-2.93.72-4.27l-7.1-5.52A23.93 23.93 0 0 0 0 24c0 3.86.92 7.5 2.54 10.72l8.2-6.46z"
      />
      <path
        fill="#34A853"
        d="M24 47c5.52 0 10.16-1.83 13.54-4.96l-7.18-5.58c-1.83 1.23-4.18 1.96-6.36 1.96-6.22 0-11.5-3.98-13.26-9.5l-8.2 6.46C7.07 41.52 14.82 47 24 47z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);

  const errorCode = searchParams.get("error") ?? "";
  const errorMsg = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.default)
    : null;

  useEffect(() => {
    if (session) router.push("/");
  }, [session, router]);

  if (status === "loading") return null;
  if (session) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#030303",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#060606",
          border: "1px solid #1a1a1a",
          borderRadius: 10,
          padding: "40px 48px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          width: 340,
        }}
      >
        {/* Logo + wordmark */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              color: "#e8490f",
              fontSize: 28,
              fontWeight: 900,
              letterSpacing: "0.25em",
              ...MONO,
            }}
          >
            WRAITH
          </div>
          <div
            style={{
              color: "#333",
              fontSize: 9,
              letterSpacing: "0.18em",
              ...MONO,
            }}
          >
            MEME TOKEN SNIPER
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: "100%", height: 1, background: "#111" }} />

        {/* Error message */}
        {errorMsg && (
          <div
            style={{
              width: "100%",
              background: "#1a0800",
              border: "1px solid #e8490f44",
              borderRadius: 5,
              padding: "10px 12px",
              color: "#e8490f",
              fontSize: 10,
              ...MONO,
              textAlign: "center",
              lineHeight: 1.7,
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Sign in button */}
        <button
          onClick={async () => {
            setLoading(true);
            await signIn("google", { callbackUrl: "/" });
            setLoading(false);
          }}
          disabled={loading}
          style={{
            width: "100%",
            background: loading ? "#0a0a0a" : "#fff",
            border: "1px solid #2a2a2a",
            color: loading ? "#444" : "#111",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            padding: "11px 16px",
            borderRadius: 5,
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            transition: "all 0.15s",
            ...MONO,
          }}
          onMouseEnter={(e) => {
            if (!loading)
              (e.currentTarget as HTMLElement).style.background = "#f0f0f0";
          }}
          onMouseLeave={(e) => {
            if (!loading)
              (e.currentTarget as HTMLElement).style.background = "#fff";
          }}
        >
          {loading ? (
            "REDIRECTING..."
          ) : (
            <>
              <GoogleIcon />
              SIGN IN WITH GOOGLE
            </>
          )}
        </button>

        <div
          style={{
            color: "#222",
            fontSize: 8,
            ...MONO,
            textAlign: "center",
            lineHeight: 1.8,
          }}
        >
          Your data syncs across all your devices.
          <br />
          Nothing is stored in your browser.
        </div>
      </div>
    </div>
  );
}
