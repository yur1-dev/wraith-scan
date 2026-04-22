"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};

export default function LoginPage() {
  const { data: session } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session) router.push("/");
  }, [session, router]);

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
        <div
          style={{
            color: "#e8490f",
            fontSize: 22,
            fontWeight: 900,
            letterSpacing: "0.2em",
            ...MONO,
          }}
        >
          WRAITH
        </div>

        <div
          style={{
            color: "#444",
            fontSize: 10,
            letterSpacing: "0.14em",
            ...MONO,
          }}
        >
          MEME TOKEN SNIPER
        </div>

        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          style={{
            width: "100%",
            background: "#e8490f",
            border: "none",
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            padding: "12px",
            borderRadius: 5,
            cursor: "pointer",
            ...MONO,
          }}
        >
          SIGN IN WITH GOOGLE
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
