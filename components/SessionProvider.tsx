"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import { Session } from "next-auth";

// ✅ #12 FIX: component renamed to AppSessionProvider to avoid shadowing
// the NextAuthSessionProvider import. Previously both were called SessionProvider
// which caused the wrong one to be used in ambiguous import contexts.
export default function AppSessionProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <NextAuthSessionProvider session={session}>
      {children}
    </NextAuthSessionProvider>
  );
}
