"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

const Header = dynamic(() => import("@/components/Header"), { ssr: false });
const MemeScanner = dynamic(() => import("@/components/MemeScanner"), {
  ssr: false,
});
const TokenPanel = dynamic(() => import("@/components/TokenPanel"), {
  ssr: false,
});

export interface MemeTrend {
  keyword: string;
  score: number;
  posts: number;
  source: string;
  hasTicker?: boolean;
  crossPlatforms?: number;
  isNewCoin?: boolean;
  ageLabel?: string;
  mcap?: number;
  volume?: number;
  platforms?: string[];
}

export default function Home() {
  const [selectedMeme, setSelectedMeme] = useState<MemeTrend | null>(null);

  return (
    <div style={{ minHeight: "100vh", background: "#080808", color: "#fff" }}>
      <Header />
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 16px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            height: "calc(100vh - 120px)",
          }}
        >
          <MemeScanner
            onSelectMeme={setSelectedMeme}
            selectedMeme={selectedMeme}
          />
          <TokenPanel selectedMeme={selectedMeme} />
        </div>
      </main>
    </div>
  );
}
