import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { MongoDBAdapter } from "@next-auth/mongodb-adapter";
import clientPromise from "@/lib/mongoClient";

// ─── ALLOWLIST ────────────────────────────────────────────────────────────────
// Only these emails can sign in. Add more as needed.
const ALLOWED_EMAILS = [
  "yuriesb01@gmail.com", // ← replace with your actual Gmail
];

// ─── TYPE AUGMENTATION ────────────────────────────────────────────────────────
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
  }
}

// ─── AUTH CONFIG ──────────────────────────────────────────────────────────────
export const authOptions: NextAuthOptions = {
  adapter: MongoDBAdapter(clientPromise),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60,
    updateAge: 30 * 60,
  },
  callbacks: {
    async signIn({ user }) {
      // Block anyone not on the allowlist — they'll see NextAuth's Access Denied page
      if (!user.email || !ALLOWED_EMAILS.includes(user.email)) {
        return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.userId) session.user.id = token.userId;
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login", // sends error param back to your login page instead of NextAuth's ugly default
  },
};
