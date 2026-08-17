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
  liquidity?: number;
  volume?: number;
  platforms?: string[];
  contractAddress?: string;
  celebMention?: string;
  aiContext?: string;
}

const MIN_PX = 220;
const MIN_RIGHT_PX = 260;
const HANDLE_W = 6;
const MIN_TRADER_W = 300;
const COLLAPSED_W = 40;
const MIN_WINS_W = 260;
const DEFAULT_TRADER_W = 340;

// vertical split (PaperTrader collapse) — height-based
const MIN_TRADER_H = 180;
const COLLAPSED_H = 40;
const MIN_WINS_H = 140;
const DEFAULT_TRADER_H = 260;
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
  onSelectToken,
}: {
  meme: MemeTrend | null;
  onClose: () => void;
  canSnipe: boolean;
  onSelectToken?: (mint: string, symbol: string, imageUrl?: string) => void;
}) {
  const dragStartY = useRef(0);
  const dragStartTopPct = useRef(15);
  const isDragging = useRef(false);
  const [topPct, setTopPct] = useState(100); // start off-screen
  const [transitioning, setTransitioning] = useState(false);
  const [activeTab, setActiveTab] = useState<"chart" | "trade">("chart");

  useEffect(() => {
    if (meme) {
      setActiveTab("chart");
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
      snapTo(52);
    } else {
      snapTo(15);
    }
  };

  if (!meme) return null;

  const backdropOpacity = Math.max(
    0,
    Math.min(0.65, ((100 - topPct) / 85) * 0.65),
  );

  return (
    <>
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

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 14px 12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                  borderTop: "none",
                  borderLeft: "none",
                  borderRight: "none",
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
                onSelectToken={onSelectToken}
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
  const [scannerCollapsed, setScannerCollapsed] = useState(false);

  // ── Floating SNIPER widget — always present, draggable + minimizable ──
  const [sniperMinimized, setSniperMinimized] = useState(true);
  const [sniperPos, setSniperPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const sniperDragging = useRef(false);
  const sniperDragOff = useRef({ x: 0, y: 0 });
  const sniperMoved = useRef(false);
  const sniperDragStart = useRef({ x: 0, y: 0 });

  const [mobileTab, setMobileTab] = useState<MobileTab>("scan");
  const [isMobile, setIsMobile] = useState(false);

  const [posBarNode, setPosBarNode] = useState<HTMLDivElement | null>(null);
  const posBarRef = useCallback((node: HTMLDivElement | null) => {
    setPosBarNode(node);
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);
  const hDragging = useRef<null | "left" | "right">(null);
  const hStartX = useRef(0);
  const hStartW = useRef(0);
  const cDragging = useRef(false);
  const cStartX = useRef(0);
  const cStartY = useRef(0);
  const cStartW = useRef(0);
  const cStartH = useRef(0);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    setSniperPos({
      x: Math.max(0, (window.innerWidth - 340) / 2),
      y: window.innerHeight - 80,
    });
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
      if (isMobile) {
        setSheetMeme(meme);
      }
    },
    [isMobile],
  );

  const handleCloseSheet = useCallback(() => {
    setSheetMeme(null);
  }, []);

  // Re-select a token from a held paper-trader position (e.g. click avatar/symbol
  // on a position card to bring it back up on chart + trade form).
  const handleSelectToken = useCallback(
    (mint: string, symbol: string, imageUrl?: string) => {
      const meme: MemeTrend = {
        keyword: symbol,
        score: 0,
        posts: 0,
        source: "paper-position",
        contractAddress: mint,
      };
      setSelectedMeme(meme);
      if (isMobile) {
        setSheetMeme(meme);
        setMobileTab("sniper");
      }
    },
    [isMobile],
  );

  const onHMouseDown = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      hDragging.current = side;
      hStartX.current = e.clientX;
      hStartW.current = side === "left" ? leftW : rightW;
      document.body.style.cursor = "col-resize";
    },
    [leftW, rightW],
  );

  const onSniperDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sniperDragging.current = true;
    sniperMoved.current = false;
    sniperDragStart.current = { x: e.clientX, y: e.clientY };
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    sniperDragOff.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  const onCMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (traderCollapsed) return;
      e.preventDefault();
      e.stopPropagation();
      cDragging.current = true;
      cStartX.current = e.clientX;
      cStartY.current = e.clientY;
      cStartW.current = rightW;
      cStartH.current = paperTraderH;
      document.body.style.cursor = "nwse-resize";
    },
    [rightW, paperTraderH, traderCollapsed],
  );

  useEffect(() => {
    let rafId: number | null = null;
    let pendingEvent: MouseEvent | null = null;

    const applyMove = () => {
      rafId = null;
      const e = pendingEvent;
      if (!e) return;

      if (hDragging.current && containerRef.current) {
        const dx = e.clientX - hStartX.current;
        const totalW = containerRef.current.offsetWidth;
        if (hDragging.current === "left") {
          const next = Math.max(
            MIN_PX,
            Math.min(
              hStartW.current - dx,
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

      if (sniperDragging.current) {
        const dx = e.clientX - sniperDragStart.current.x;
        const dy = e.clientY - sniperDragStart.current.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) sniperMoved.current = true;
        const x = e.clientX - sniperDragOff.current.x;
        const y = e.clientY - sniperDragOff.current.y;
        setSniperPos({
          x: Math.max(0, Math.min(x, window.innerWidth - 340)),
          y: Math.max(0, Math.min(y, window.innerHeight - 40)),
        });
      }

      if (cDragging.current && containerRef.current && rightColRef.current) {
        const dx = cStartX.current - e.clientX;
        const dy = cStartY.current - e.clientY;
        const totalW = containerRef.current.offsetWidth;
        const colH = rightColRef.current.offsetHeight;

        const nextW = Math.max(
          MIN_WINS_W,
          Math.min(
            cStartW.current + dx,
            totalW - leftW - MIN_PX - HANDLE_W * 2,
          ),
        );
        const nextH = Math.max(
          MIN_TRADER_H,
          Math.min(cStartH.current + dy, colH - MIN_WINS_H - 6),
        );
        setRightW(nextW);
        setPaperTraderH(nextH);
        lastExpandedH.current = nextH;
      }
    };

    const onMove = (e: MouseEvent) => {
      pendingEvent = e;
      if (rafId === null) {
        rafId = requestAnimationFrame(applyMove);
      }
    };

    const onUp = () => {
      hDragging.current = null;
      cDragging.current = false;
      sniperDragging.current = false;

      document.body.style.cursor = "";
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [leftW, rightW, sniperMinimized]);

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

        <div style={{ flexShrink: 0 }}>
          <Header onSelectMeme={handleSelectMeme} />
        </div>

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
                onSelectToken={handleSelectToken}
              />
            ) : (
              <LockedSniper />
            )}
          </div>
        </div>

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
                  borderBottom: "none",
                  borderLeft: "none",
                  borderRight: "none",
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

        <TokenBottomSheet
          meme={sheetMeme}
          onClose={handleCloseSheet}
          canSnipe={canSnipe}
          onSelectToken={handleSelectToken}
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
        userSelect: hDragging.current ? "none" : "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        html, body { margin: 0; padding: 0; box-sizing: border-box; }
        *, *::before, *::after { box-sizing: border-box; }
      `}</style>
      <Header onSelectMeme={handleSelectMeme} />

      {/* ── TICKER STRIP ── */}
      <LiveSignalsBar onSelectMeme={handleSelectMeme} />

      <main
        style={{
          height: "calc(100vh - 92px)",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          overflow: "hidden",
          minHeight: 0,
          gap: 0,
        }}
      >
        {/* ── TOP ROW: chart | scanner | sniper ── */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "row",
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          {/* LEFT — chart / token panel (leftmost, biggest area) */}
          <div style={{ flex: 1, minWidth: MIN_PX, overflow: "hidden" }}>
            <TokenPanel selectedMeme={selectedMeme} />
          </div>

          {!scannerCollapsed && (
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
          )}

          {/* MIDDLE — Scanner (collapsible, narrower "order book" slot) */}
          <div
            style={{
              width: scannerCollapsed ? COLLAPSED_W : leftW,
              flexShrink: 0,
              minWidth: scannerCollapsed ? COLLAPSED_W : MIN_PX,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              transition: "width 0.18s ease",
              borderLeft: "1px solid #141414",
              borderRight: "1px solid #141414",
            }}
          >
            {scannerCollapsed ? (
              <button
                onClick={() => setScannerCollapsed(false)}
                title="Expand scanner"
                style={{
                  flex: 1,
                  background: "#050505",
                  border: "none",
                  color: "#555",
                  cursor: "pointer",
                  writingMode: "vertical-rl" as const,
                  fontSize: 10,
                  letterSpacing: "0.2em",
                  fontFamily: "inherit",
                  fontWeight: 700,
                }}
              >
                ◂ SCANNER
              </button>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    padding: "4px 8px 0",
                    flexShrink: 0,
                  }}
                >
                  <button
                    onClick={() => setScannerCollapsed(true)}
                    title="Collapse scanner"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#444",
                      cursor: "pointer",
                      fontSize: 11,
                      padding: "2px 6px",
                    }}
                  >
                    ▸
                  </button>
                </div>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <MemeScanner
                    onSelectMeme={handleSelectMeme}
                    selectedMeme={selectedMeme}
                  />
                </div>
              </>
            )}
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
                ((e.currentTarget as HTMLElement).style.background =
                  "#e8490f66")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "#141414")
              }
            />
          </div>

          {/* RIGHT — Win Tracker, always docked */}
          <div
            ref={rightColRef}
            style={{
              width: rightW,
              flexShrink: 0,
              minWidth: MIN_RIGHT_PX,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                height: "100%",
                overflowY: "auto",
                overflowX: "hidden",
                scrollBehavior: "smooth",
                overscrollBehavior: "contain",
              }}
            >
              <WinsPanel onSelectMeme={handleSelectMeme} />
            </div>
          </div>
        </div>
      </main>

      {/* ── BOTTOM BAR — Positions / History, full width, always visible ── */}
      <div
        ref={posBarRef}
        style={{
          flexShrink: 0,
          height: 260,
          borderTop: "1px solid #141414",
          background: "#030303",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      />
      {/* ── Floating SNIPER panel — handle is fixed at bottom, content overlays above it ── */}
      {sniperPos && (
        <>
          {/* Always mounted when sniperPos exists — unmounting on minimize
              was killing PaperTrader's createPortal into bottomBarNode,
              which is why the bottom POSITIONS/HISTORY bar went completely
              blank on close instead of just hiding the floating card. */}
          <div
            style={{
              position: "fixed",
              left: sniperPos.x,
              bottom: 64,
              width: 340,
              height: "min(520px, 70vh)",
              zIndex: 300,
              background: "#050505",
              borderTop: `1px solid ${canSnipe ? "#e8490f55" : "#2a2a2a"}`,
              borderLeft: `1px solid ${canSnipe ? "#e8490f55" : "#2a2a2a"}`,
              borderRight: `1px solid ${canSnipe ? "#e8490f55" : "#2a2a2a"}`,
              borderBottom: "none",
              borderRadius: "10px 10px 0 0",
              boxShadow: "0 -4px 40px #000000cc",
              display: sniperMinimized ? "none" : "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {canSnipe ? (
              <PaperTrader
                selectedMeme={selectedMeme}
                collapsed={traderCollapsed}
                onCollapseChange={handleCollapseChange}
                bottomBarNode={posBarNode}
                onSelectToken={handleSelectToken}
              />
            ) : (
              <LockedSniper />
            )}
          </div>

          <div
            onMouseDown={onSniperDragStart}
            onClick={() => {
              if (sniperMoved.current) return;
              setSniperMinimized((m) => !m);
            }}
            style={{
              position: "fixed",
              left: sniperPos.x,
              bottom: 20,
              width: 340,
              height: 44,
              zIndex: 300,
              background: "#0a0a0a",
              borderBottom: `1px solid ${canSnipe ? "#e8490f55" : "#2a2a2a"}`,
              borderLeft: `1px solid ${canSnipe ? "#e8490f55" : "#2a2a2a"}`,
              borderRight: `1px solid ${canSnipe ? "#e8490f55" : "#2a2a2a"}`,
              borderTop: sniperMinimized
                ? `1px solid ${canSnipe ? "#e8490f55" : "#2a2a2a"}`
                : "1px solid #1a1a1a",
              borderRadius: sniperMinimized ? 10 : "0 0 10px 10px",
              boxShadow: "0 8px 40px #000000cc",
              cursor: "grab",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 16px",
              userSelect: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: canSnipe ? "#00c47a" : "#444",
                  boxShadow: canSnipe ? "0 0 8px #00c47a" : "none",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  color: canSnipe ? "#e8490f" : "#666",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.16em",
                  fontFamily: "'JetBrains Mono', 'Fira Mono', monospace",
                }}
              >
                SNIPER
              </span>
            </div>
            <span style={{ color: "#777", fontSize: 12 }}>
              {sniperMinimized ? "▴" : "▾"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
