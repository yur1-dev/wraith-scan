"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useWraithTier } from "@/hooks/useWraithTier";

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
const PaperTrader = dynamic(() => import("@/components/PaperTrader"), {
  ssr: false,
});
const LiveSignalsBar = dynamic(() => import("@/components/LiveSignalsBar"), {
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
  contractAddress?: string;
  celebMention?: string;
  aiContext?: string;
}

const MIN_PX = 220;
const HANDLE_W = 6;
const HANDLE_H = 6;
const MIN_TRADER_H = 48;
const COLLAPSED_H = 36;
const MIN_WINS_H = 80;
const DEFAULT_TRADER_H = 320;

type MobileTab = "scan" | "token" | "wins" | "sniper";

const MOBILE_TABS: { key: MobileTab; label: string; icon: string }[] = [
  { key: "scan", label: "SCAN", icon: "⚡" },
  { key: "token", label: "TOKEN", icon: "◈" },
  { key: "wins", label: "WINS", icon: "🏆" },
  { key: "sniper", label: "SNIPER", icon: "🎯" },
];

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };

const C = {
  bg: "#050505",
  border: "#1a1a1a",
  orange: "#e8490f",
  red: "#ff4444",
  muted: "#777",
  dim: "#444",
};

function LockedSniper() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        background: "#050505",
        border: "1px solid #1a1a1a",
        borderRadius: 8,
        padding: 24,
        textAlign: "center" as const,
        ...MONO,
      }}
    >
      <span style={{ fontSize: 28 }}>🔒</span>
      <div
        style={{
          color: "#e8490f",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.15em",
        }}
      >
        SNIPER LOCKED
      </div>
      <div
        style={{ color: "#555", fontSize: 9, lineHeight: 1.7, maxWidth: 200 }}
      >
        Hold{" "}
        <span style={{ color: "#00b4d8", fontWeight: 700 }}>
          10,000+ WRAITH
        </span>{" "}
        tokens to unlock the sniper.
      </div>
      <a
        href="/access"
        style={{
          marginTop: 4,
          background: "#e8490f",
          color: "#fff",
          fontSize: 9,
          fontWeight: 700,
          padding: "6px 14px",
          borderRadius: 4,
          textDecoration: "none",
          letterSpacing: "0.1em",
        }}
      >
        VIEW TIERS →
      </a>
    </div>
  );
}

export default function Home() {
  const { canUse: can } = useWraithTier();
  const canSnipe = can("sniper");

  const [selectedMeme, setSelectedMeme] = useState<MemeTrend | null>(null);
  const [leftW, setLeftW] = useState(430);
  const [rightW, setRightW] = useState(420);
  const [traderCollapsed, setTraderCollapsed] = useState(false);
  const lastExpandedH = useRef(DEFAULT_TRADER_H);
  const [paperTraderH, setPaperTraderH] = useState<number>(DEFAULT_TRADER_H);
  const [mobileTab, setMobileTab] = useState<MobileTab>("scan");
  const [isMobile, setIsMobile] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);
  const hDragging = useRef<null | "left" | "right">(null);
  const hStartX = useRef(0);
  const hStartW = useRef(0);
  const vDragging = useRef(false);
  const vStartY = useRef(0);
  const vStartH = useRef(0);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handleCollapseChange = useCallback(
    (collapsed: boolean) => {
      setTraderCollapsed(collapsed);
      if (collapsed) {
        lastExpandedH.current = paperTraderH;
        setPaperTraderH(COLLAPSED_H);
      } else {
        setPaperTraderH(lastExpandedH.current);
      }
    },
    [paperTraderH],
  );

  const handleSelectMeme = useCallback(
    (meme: MemeTrend) => {
      setSelectedMeme(meme);
      if (isMobile) setMobileTab("token");
    },
    [isMobile],
  );

  const onHMouseDown = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      hDragging.current = side;
      hStartX.current = e.clientX;
      hStartW.current = side === "left" ? leftW : rightW;
    },
    [leftW, rightW],
  );

  const onVMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (traderCollapsed) return;
      e.preventDefault();
      e.stopPropagation();
      vDragging.current = true;
      vStartY.current = e.clientY;
      vStartH.current = paperTraderH;
    },
    [paperTraderH, traderCollapsed],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (hDragging.current && containerRef.current) {
        const dx = e.clientX - hStartX.current;
        const totalW = containerRef.current.offsetWidth;
        if (hDragging.current === "left") {
          const next = Math.max(
            MIN_PX,
            Math.min(
              hStartW.current + dx,
              totalW - rightW - MIN_PX - HANDLE_W * 2,
            ),
          );
          setLeftW(next);
        } else {
          const next = Math.max(
            MIN_PX,
            Math.min(
              hStartW.current - dx,
              totalW - leftW - MIN_PX - HANDLE_W * 2,
            ),
          );
          setRightW(next);
        }
      }
      if (vDragging.current && rightColRef.current) {
        const dy = vStartY.current - e.clientY;
        const colH = rightColRef.current.offsetHeight;
        const next = Math.max(
          MIN_TRADER_H,
          Math.min(vStartH.current + dy, colH - MIN_WINS_H - HANDLE_H),
        );
        setPaperTraderH(next);
        lastExpandedH.current = next;
      }
    };
    const onUp = () => {
      hDragging.current = null;
      vDragging.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [leftW, rightW]);

  // ── MOBILE ──────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#030303",
          color: "#e0e0e0",
          fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Header />
        <main
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            <div
              style={{
                display: mobileTab === "scan" ? "flex" : "none",
                flexDirection: "column",
                height: "100%",
                overflow: "hidden",
              }}
            >
              <MemeScanner
                onSelectMeme={handleSelectMeme}
                selectedMeme={selectedMeme}
              />
            </div>
            <div
              style={{
                display: mobileTab === "token" ? "flex" : "none",
                flexDirection: "column",
                height: "100%",
                overflow: "hidden",
              }}
            >
              <TokenPanel selectedMeme={selectedMeme} />
            </div>
            <div
              style={{
                display: mobileTab === "wins" ? "flex" : "none",
                flexDirection: "column",
                height: "100%",
                overflow: "hidden",
              }}
            >
              <WinsPanel onSelectMeme={handleSelectMeme} />
            </div>
            <div
              style={{
                display: mobileTab === "sniper" ? "flex" : "none",
                flexDirection: "column",
                height: "100%",
                overflow: "hidden",
              }}
            >
              {canSnipe ? (
                <PaperTrader
                  selectedMeme={selectedMeme}
                  collapsed={traderCollapsed}
                  onCollapseChange={handleCollapseChange}
                />
              ) : (
                <LockedSniper />
              )}
            </div>
          </div>
          <nav
            style={{
              display: "flex",
              background: "#050505",
              borderTop: "1px solid #1a1a1a",
              flexShrink: 0,
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }}
          >
            {MOBILE_TABS.map(({ key, label, icon }) => {
              const active = mobileTab === key;
              const hasNotif = key === "token" && !!selectedMeme;
              const locked = key === "sniper" && !canSnipe;
              return (
                <button
                  key={key}
                  onClick={() => setMobileTab(key)}
                  style={{
                    flex: 1,
                    background: active ? "#0d0d0d" : "transparent",
                    border: "none",
                    borderTop: `2px solid ${active ? "#e8490f" : "transparent"}`,
                    color: active ? "#e8490f" : locked ? "#333" : "#555",
                    padding: "10px 4px 8px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 3,
                    position: "relative",
                    transition: "all 0.15s",
                    ...MONO,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{locked ? "🔒" : icon}</span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: active ? 700 : 400,
                      letterSpacing: "0.1em",
                    }}
                  >
                    {label}
                  </span>
                  {hasNotif && !active && (
                    <span
                      style={{
                        position: "absolute",
                        top: 6,
                        right: "calc(50% - 18px)",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#e8490f",
                        boxShadow: "0 0 6px #e8490f",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </nav>
        </main>
        <style>{`* { -webkit-tap-highlight-color: transparent; } body { overflow: hidden; }`}</style>
      </div>
    );
  }

  // ── DESKTOP ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#030303",
        color: "#e0e0e0",
        fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
        userSelect: hDragging.current || vDragging.current ? "none" : "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Header />
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "row",
          padding: "8px 16px 12px",
          overflow: "hidden",
          height: "calc(100vh - 52px)",
          maxHeight: "calc(100vh - 52px)",
          gap: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <LiveSignalsBar onSelectMeme={setSelectedMeme} />
          <div
            ref={containerRef}
            style={{
              display: "flex",
              flex: 1,
              overflow: "hidden",
              minHeight: 0,
              gap: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width: leftW,
                flexShrink: 0,
                minWidth: MIN_PX,
                overflow: "hidden",
              }}
            >
              <div style={{ flex: 1, overflow: "hidden" }}>
                <MemeScanner
                  onSelectMeme={setSelectedMeme}
                  selectedMeme={selectedMeme}
                />
              </div>
            </div>
            <div
              onMouseDown={onHMouseDown("left")}
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
                  ((e.currentTarget as HTMLElement).style.background =
                    "#141414")
                }
              />
            </div>
            <div style={{ flex: 1, minWidth: MIN_PX, overflow: "hidden" }}>
              <TokenPanel selectedMeme={selectedMeme} />
            </div>
          </div>
        </div>

        <div
          onMouseDown={onHMouseDown("right")}
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
              ((e.currentTarget as HTMLElement).style.background = "#e8490f66")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = "#141414")
            }
          />
        </div>

        <div
          ref={rightColRef}
          style={{
            width: rightW,
            flexShrink: 0,
            minWidth: MIN_PX,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          <div style={{ flex: 1, minHeight: MIN_WINS_H, overflow: "hidden" }}>
            <WinsPanel onSelectMeme={setSelectedMeme} />
          </div>
          <div
            onMouseDown={onVMouseDown}
            style={{
              height: HANDLE_H,
              flexShrink: 0,
              cursor: traderCollapsed ? "default" : "row-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              position: "relative",
              opacity: traderCollapsed ? 0.3 : 1,
              transition: "opacity 0.2s",
            }}
          >
            <div
              style={{
                width: "100%",
                height: 2,
                background: "#141414",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!traderCollapsed)
                  (e.currentTarget as HTMLElement).style.background =
                    "#e8490f66";
              }}
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "#141414")
              }
            />
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                display: "flex",
                gap: 3,
                pointerEvents: "none",
              }}
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 3,
                    height: 3,
                    borderRadius: "50%",
                    background: "#333",
                  }}
                />
              ))}
            </div>
          </div>
          <div
            style={{
              height: paperTraderH,
              flexShrink: 0,
              overflow: "hidden",
              transition: "height 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            {canSnipe ? (
              <PaperTrader
                selectedMeme={selectedMeme}
                collapsed={traderCollapsed}
                onCollapseChange={handleCollapseChange}
              />
            ) : (
              <LockedSniper />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
