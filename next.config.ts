import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  // Turbopack's on-disk dev cache gets corrupted on Windows (every route 404s until .next is deleted); keep it in memory only.
  experimental: { turbopackFileSystemCacheForDev: false },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
