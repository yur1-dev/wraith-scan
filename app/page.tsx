"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";

const Header = dynamic(() => import("@/components/Header"), { ssr: false });
const MemeScanner = dynamic(() => import("@/components/MemeScanner"), {
  ssr: false,
});
const TokenPanel = dynamic(() => import("@/components/TokenPanel"), {
  ssr: false,
});
const WinsPanel = dynamic(() => import("@/components/WinsPanel"), {
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

const MIN_PX = 220;
const HANDLE_W = 6;

export default function Home() {
  const [selectedMeme, setSelectedMeme] = useState<MemeTrend | null>(null);
  const [leftW, setLeftW] = useState(430);
  const [rightW, setRightW] = useState(420);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<null | "left" | "right">(null);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = side;
      startX.current = e.clientX;
      startW.current = side === "left" ? leftW : rightW;
    },
    [leftW, rightW],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const dx = e.clientX - startX.current;
      const totalW = containerRef.current.offsetWidth;
      if (dragging.current === "left") {
        const next = Math.max(
          MIN_PX,
          Math.min(
            startW.current + dx,
            totalW - rightW - MIN_PX - HANDLE_W * 2,
          ),
        );
        setLeftW(next);
      } else {
        const next = Math.max(
          MIN_PX,
          Math.min(startW.current - dx, totalW - leftW - MIN_PX - HANDLE_W * 2),
        );
        setRightW(next);
      }
    };
    const onUp = () => {
      dragging.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [leftW, rightW]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#030303",
        color: "#e0e0e0",
        fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
        userSelect: dragging.current ? "none" : "auto",
      }}
    >
      <Header />
      <main style={{ maxWidth: 1600, margin: "0 auto", padding: "12px 16px" }}>
        <div
          ref={containerRef}
          style={{
            display: "flex",
            gap: 0,
            height: "calc(100vh - 80px)",
          }}
        >
          {/* LEFT — Meme Scanner */}
          <div
            style={{
              width: leftW,
              flexShrink: 0,
              minWidth: MIN_PX,
              overflow: "hidden",
            }}
          >
            <MemeScanner
              onSelectMeme={setSelectedMeme}
              selectedMeme={selectedMeme}
            />
          </div>

          {/* Drag handle LEFT */}
          <div
            onMouseDown={onMouseDown("left")}
            style={{
              width: HANDLE_W,
              flexShrink: 0,
              cursor: "col-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
            }}
          >
            <div
              style={{
                width: 2,
                height: "100%",
                background: "#141414",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  "#e8490f66")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "#141414")
              }
            />
          </div>

          {/* CENTER — Token Panel */}
          <div style={{ flex: 1, minWidth: MIN_PX, overflow: "hidden" }}>
            <TokenPanel selectedMeme={selectedMeme} />
          </div>

          {/* Drag handle RIGHT */}
          <div
            onMouseDown={onMouseDown("right")}
            style={{
              width: HANDLE_W,
              flexShrink: 0,
              cursor: "col-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
            }}
          >
            <div
              style={{
                width: 2,
                height: "100%",
                background: "#141414",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  "#e8490f66")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "#141414")
              }
            />
          </div>

          {/* RIGHT — Win Tracker */}
          <div
            style={{
              width: rightW,
              flexShrink: 0,
              minWidth: MIN_PX,
              overflow: "hidden",
            }}
          >
            <WinsPanel onSelectMeme={setSelectedMeme} />
          </div>
        </div>
      </main>
    </div>
  );
}
