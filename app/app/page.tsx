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
const MOBILE_NAV_H = 58;

type MobileTab = "scan" | "wins" | "sniper";

const MOBILE_TABS: { key: MobileTab; label: string; icon: string }[] = [
  { key: "scan", label: "SCAN", icon: "⚡" },
  { key: "wins", label: "WINS", icon: "🏆" },
  { key: "sniper", label: "SNIPER", icon: "🎯" },
];

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };

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

// ─────────────────────────────────────────────────────────────────
// BOTTOM SHEET — slides up over content when a token is selected
// Supports drag-to-dismiss and snap points (full / half / close)
// ─────────────────────────────────────────────────────────────────
function TokenBottomSheet({
  meme,
  onClose,
  canSnipe,
}: {
  meme: MemeTrend | null;
  onClose: () => void;
  canSnipe: boolean;
}) {
  const dragStartY = useRef(0);
  const dragStartTopPct = useRef(15);
  const isDragging = useRef(false);
  const [topPct, setTopPct] = useState(100); // start off-screen
  const [transitioning, setTransitioning] = useState(false);
  const [activeTab, setActiveTab] = useState<"chart" | "trade">("chart");

  // Slide in when meme is set
  useEffect(() => {
    if (meme) {
      setActiveTab("chart");
      // Next frame: slide up to full
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTransitioning(true);
          setTopPct(15);
        });
      });
    }
  }, [meme]);

  const snapTo = (pct: number) => {
    setTransitioning(true);
    setTopPct(pct);
  };

  const handleClose = useCallback(() => {
    setTransitioning(true);
    setTopPct(100);
    setTimeout(onClose, 320);
  }, [onClose]);

  // ── Touch drag ──
  const onTouchStart = (e: React.TouchEvent) => {
    isDragging.current = true;
    setTransitioning(false);
    dragStartY.current = e.touches[0].clientY;
    dragStartTopPct.current = topPct;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    const vh = window.innerHeight;
    const deltaPct = (dy / vh) * 100;
    const next = Math.max(8, Math.min(95, dragStartTopPct.current + deltaPct));
    setTopPct(next);
  };

  const onTouchEnd = () => {
    isDragging.current = false;
    setTransitioning(true);
    if (topPct > 72) {
      handleClose();
    } else if (topPct > 40) {
      snapTo(52); // half screen
    } else {
      snapTo(15); // full screen
    }
  };

  if (!meme) return null;

  const backdropOpacity = Math.max(
    0,
    Math.min(0.65, ((100 - topPct) / 85) * 0.65),
  );

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: "fixed",
          inset: 0,
          background: `rgba(0,0,0,${backdropOpacity})`,
          zIndex: 200,
          transition: transitioning ? "background 0.28s ease" : "none",
          pointerEvents: topPct < 98 ? "auto" : "none",
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          top: `${topPct}%`,
          zIndex: 201,
          background: "#090909",
          borderTop: "1px solid #222",
          borderRadius: "14px 14px 0 0",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 -4px 40px #000000aa",
          transition: transitioning
            ? "top 0.28s cubic-bezier(0.32,0.72,0,1)"
            : "none",
        }}
      >
        {/* ── Drag zone: handle + token header + tabs ── */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            flexShrink: 0,
            paddingTop: 10,
            background: "#0d0d0d",
            borderBottom: "1px solid #141414",
            userSelect: "none",
            touchAction: "none",
          }}
        >
          {/* Pill */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: 10,
            }}
          >
            <div
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                background: "#2a2a2a",
              }}
            />
          </div>

          {/* Token identity row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 14px 12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Avatar */}
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "#1a1a1a",
                  border: "1px solid #e8490f22",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#e8490f",
                  flexShrink: 0,
                  ...MONO,
                }}
              >
                {meme.keyword?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 900,
                    color: "#f0f0f0",
                    letterSpacing: ".04em",
                    lineHeight: 1,
                    ...MONO,
                  }}
                >
                  ${meme.keyword?.toUpperCase()}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: "#555",
                    letterSpacing: ".1em",
                    marginTop: 3,
                    ...MONO,
                  }}
                >
                  {meme.source ?? "—"}
                  {meme.mcap ? ` · $${(meme.mcap / 1000).toFixed(0)}K` : ""}
                </div>
              </div>
            </div>

            {/* Snap buttons + close */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* Half/Full toggle */}
              <button
                onClick={() => (topPct > 30 ? snapTo(15) : snapTo(52))}
                style={{
                  background: "#111",
                  border: "1px solid #1e1e1e",
                  color: "#555",
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                title={topPct > 30 ? "Expand" : "Collapse"}
              >
                {topPct > 30 ? "↑" : "↓"}
              </button>
              {/* Close */}
              <button
                onClick={handleClose}
                style={{
                  background: "#111",
                  border: "1px solid #1e1e1e",
                  color: "#555",
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Chart / Trade tabs */}
          <div
            style={{
              display: "flex",
              gap: 0,
              borderTop: "1px solid #141414",
            }}
          >
            {(["chart", "trade"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  flex: 1,
                  background: activeTab === t ? "#0d0d0d" : "transparent",
                  border: "none",
                  borderBottom: `2px solid ${activeTab === t ? "#e8490f" : "transparent"}`,
                  color: activeTab === t ? "#e8490f" : "#444",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: ".14em",
                  padding: "11px 0",
                  cursor: "pointer",
                  transition: "all .15s",
                  ...MONO,
                }}
              >
                {t === "chart" ? "📈  CHART" : "⚡  TRADE"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Sheet content ── */}
        <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
          <div
            style={{
              height: "100%",
              overflow: "hidden",
              display: activeTab === "chart" ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            <TokenPanel selectedMeme={meme} />
          </div>

          <div
            style={{
              height: "100%",
              overflow: "hidden",
              display: activeTab === "trade" ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            {canSnipe ? (
              <PaperTrader
                selectedMeme={meme}
                collapsed={false}
                onCollapseChange={() => {}}
              />
            ) : (
              <LockedSniper />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────
export default function Home() {
  const { canUse: can } = useWraithTier();
  const canSnipe = can("sniper");

  const [selectedMeme, setSelectedMeme] = useState<MemeTrend | null>(null);
  const [sheetMeme, setSheetMeme] = useState<MemeTrend | null>(null);
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

  // Mobile: open bottom sheet on token select
  const handleSelectMeme = useCallback(
    (meme: MemeTrend) => {
      setSelectedMeme(meme);
      if (isMobile) {
        setSheetMeme(meme);
      }
    },
    [isMobile],
  );

  const handleCloseSheet = useCallback(() => {
    setSheetMeme(null);
  }, []);

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

  // ── MOBILE ──────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#030303",
          color: "#e0e0e0",
          fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <style>{`
          *, *::before, *::after { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
          html, body { overflow: hidden; height: 100%; width: 100%; margin: 0; padding: 0; }
        `}</style>

        {/* Header */}
        <div style={{ flexShrink: 0 }}>
          <Header />
        </div>

        {/* Tab panels — each fills available height exactly */}
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            position: "relative",
            minHeight: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: mobileTab === "scan" ? "flex" : "none",
              flexDirection: "column",
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
              position: "absolute",
              inset: 0,
              display: mobileTab === "wins" ? "flex" : "none",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <WinsPanel onSelectMeme={handleSelectMeme} />
          </div>

          <div
            style={{
              position: "absolute",
              inset: 0,
              display: mobileTab === "sniper" ? "flex" : "none",
              flexDirection: "column",
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

        {/* Bottom nav — never leaves screen */}
        <nav
          style={{
            flexShrink: 0,
            display: "flex",
            background: "#050505",
            borderTop: "1px solid #1a1a1a",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            minHeight: MOBILE_NAV_H,
            zIndex: 100,
          }}
        >
          {MOBILE_TABS.map(({ key, label, icon }) => {
            const active = mobileTab === key;
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
                  color: active ? "#e8490f" : locked ? "#2a2a2a" : "#484848",
                  padding: "10px 4px 8px",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  transition: "all 0.15s",
                  minWidth: 0,
                  fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
                }}
              >
                <span style={{ fontSize: 18, lineHeight: 1 }}>
                  {locked ? "🔒" : icon}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: active ? 700 : 400,
                    letterSpacing: "0.1em",
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Bottom sheet — portal over everything */}
        <TokenBottomSheet
          meme={sheetMeme}
          onClose={handleCloseSheet}
          canSnipe={canSnipe}
        />
      </div>
    );
  }

  // ── DESKTOP ─────────────────────────────────────────────────────
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
