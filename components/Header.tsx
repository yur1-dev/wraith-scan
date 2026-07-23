"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSession, signOut } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import WalletModal from "./WalletModal";
import { TierBadge, useWraithTier } from "@/hooks/useWraithTier";
import { MemeTrend } from "@/app/app/page";

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};

function trimAddress(addr: string) {
  return `${addr.slice(0, 4)}..${addr.slice(-4)}`;
}

function formatMcap(n: number): string {
  if (!n) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPrice(n: number): string {
  if (!n) return "—";
  if (n < 0.000001) return `$${n.toExponential(2)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

interface TokenResult {
  address: string;
  name: string;
  symbol: string;
  icon?: string;
  priceUsd: number;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  priceChange24h: number;
  chainId: string;
  pairAddress: string;
}

const TELEGRAM_TIERS = ["SPECTER", "WRAITH"];

function TokenRow({
  token,
  isLast,
  copiedAddr,
  onSelect,
  onCopy,
  onOpenDex,
  showOpenCta,
}: {
  token: TokenResult;
  isLast: boolean;
  copiedAddr: string | null;
  onSelect: (t: TokenResult) => void;
  onCopy: (e: React.MouseEvent, addr: string) => void;
  onOpenDex: (e: React.MouseEvent, t: TokenResult) => void;
  showOpenCta: boolean;
}) {
  return (
    <div style={{ borderBottom: isLast ? "none" : "1px solid #0d0d0d" }}>
      <div
        onClick={() => onSelect(token)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "10px 14px 6px",
          cursor: "pointer",
          transition: "background .1s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "#0d0d0d";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        <div style={{ flexShrink: 0, width: 32, height: 32 }}>
          {token.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={token.icon}
              alt={token.symbol}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                objectFit: "cover",
                border: "1px solid #1a1a1a",
                display: "block",
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "#e8490f14",
                border: "1px solid #e8490f2a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#e8490f",
                fontSize: 12,
                fontWeight: 700,
                ...MONO,
              }}
            >
              {token.symbol[0]}
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: "#d0d0d0",
              fontSize: 12,
              fontWeight: 700,
              ...MONO,
              letterSpacing: ".04em",
            }}
          >
            {token.symbol}
          </div>
          <div
            style={{
              color: "#2e2e2e",
              fontSize: 9,
              ...MONO,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {token.name}
          </div>
        </div>

        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ color: "#888", fontSize: 11, ...MONO }}>
            {formatPrice(token.priceUsd)}
          </div>
          <div
            style={{
              fontSize: 9,
              ...MONO,
              marginTop: 2,
              color: token.priceChange24h >= 0 ? "#00c47a" : "#ff4444",
            }}
          >
            {token.priceChange24h >= 0 ? "+" : ""}
            {token.priceChange24h.toFixed(1)}%
          </div>
        </div>

        <div
          style={{
            background: "#0d0d0d",
            border: "1px solid #161616",
            borderRadius: 4,
            padding: "3px 8px",
            color: "#383838",
            fontSize: 9,
            ...MONO,
            flexShrink: 0,
            minWidth: 56,
            textAlign: "center",
          }}
        >
          {formatMcap(token.marketCap)}
        </div>

        {showOpenCta && (
          <div
            style={{
              background: "#e8490f0e",
              border: "1px solid #e8490f2a",
              borderRadius: 4,
              padding: "3px 8px",
              color: "#e8490f88",
              fontSize: 9,
              ...MONO,
              flexShrink: 0,
              letterSpacing: ".06em",
              whiteSpace: "nowrap",
            }}
          >
            OPEN →
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 14px 8px 57px",
        }}
      >
        <span
          style={{
            color: "#1e1e1e",
            fontSize: 9,
            ...MONO,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {token.address}
        </span>

        <button
          onClick={(e) => onCopy(e, token.address)}
          style={{
            background: "transparent",
            border: "1px solid #181818",
            borderRadius: 3,
            padding: "2px 7px",
            color: copiedAddr === token.address ? "#00c47a" : "#2a2a2a",
            fontSize: 8,
            ...MONO,
            cursor: "pointer",
            letterSpacing: ".06em",
            flexShrink: 0,
            transition: "all .15s",
          }}
          onMouseEnter={(e) => {
            if (copiedAddr !== token.address)
              e.currentTarget.style.color = "#555";
          }}
          onMouseLeave={(e) => {
            if (copiedAddr !== token.address)
              e.currentTarget.style.color = "#2a2a2a";
          }}
        >
          {copiedAddr === token.address ? "COPIED" : "COPY CA"}
        </button>

        <button
          onClick={(e) => onOpenDex(e, token)}
          style={{
            background: "transparent",
            border: "1px solid #181818",
            borderRadius: 3,
            padding: "2px 7px",
            color: "#2a2a2a",
            fontSize: 8,
            ...MONO,
            cursor: "pointer",
            letterSpacing: ".06em",
            flexShrink: 0,
            transition: "all .15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#555";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#2a2a2a";
          }}
        >
          DEX ↗
        </button>
      </div>
    </div>
  );
}

// ── Coin Search ──────────────────────────────────────────────────────────────
function CoinSearch({
  onSelectMeme,
}: {
  onSelectMeme?: (meme: MemeTrend) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TokenResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [trending, setTrending] = useState<TokenResult[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const trendingFetchedRef = useRef(false);

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(trimmed)}`,
      );
      const data = await res.json();
      if (!data.pairs || data.pairs.length === 0) {
        setResults([]);
        setError("No tokens found");
        setLoading(false);
        return;
      }

      const seen = new Map<string, TokenResult>();
      for (const pair of data.pairs) {
        const addr = pair.baseToken?.address;
        if (!addr) continue;
        const liquidity = pair.liquidity?.usd ?? 0;
        const mcap = pair.marketCap ?? pair.fdv ?? 0;
        const priceUsd = parseFloat(pair.priceUsd ?? "0");
        const existing = seen.get(addr);
        if (!existing || liquidity > existing.liquidity) {
          seen.set(addr, {
            address: addr,
            name: pair.baseToken?.name ?? "Unknown",
            symbol: pair.baseToken?.symbol ?? "???",
            icon: pair.info?.imageUrl ?? undefined,
            priceUsd,
            marketCap: mcap,
            liquidity,
            volume24h: pair.volume?.h24 ?? 0,
            priceChange24h: pair.priceChange?.h24 ?? 0,
            chainId: pair.chainId ?? "",
            pairAddress: pair.pairAddress ?? "",
          });
        }
      }

      setResults(
        Array.from(seen.values())
          .sort((a, b) => b.liquidity - a.liquidity)
          .slice(0, 7),
      );
    } catch {
      setError("Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  const fetchTrending = useCallback(async () => {
    if (trendingFetchedRef.current) return;
    trendingFetchedRef.current = true;
    setTrendingLoading(true);
    try {
      const boostRes = await fetch(
        "https://api.dexscreener.com/token-boosts/top/v1",
      );
      const boosts = await boostRes.json();
      const solanaAddrs: string[] = (Array.isArray(boosts) ? boosts : [])
        .filter((b: { chainId?: string }) => b.chainId === "solana")
        .map((b: { tokenAddress: string }) => b.tokenAddress)
        .slice(0, 8);

      if (!solanaAddrs.length) {
        setTrendingLoading(false);
        return;
      }

      const results = await Promise.all(
        solanaAddrs.map(async (addr) => {
          try {
            const r = await fetch(
              `https://api.dexscreener.com/latest/dex/tokens/${addr}`,
            );
            const d = await r.json();
            const pairs = (d?.pairs || [])
              .filter((p: { chainId: string }) => p.chainId === "solana")
              .sort(
                (
                  a: { liquidity?: { usd?: number } },
                  b: { liquidity?: { usd?: number } },
                ) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
              );
            const pair = pairs[0];
            if (!pair) return null;
            const t: TokenResult = {
              address: pair.baseToken?.address ?? addr,
              name: pair.baseToken?.name ?? "Unknown",
              symbol: pair.baseToken?.symbol ?? "???",
              icon: pair.info?.imageUrl ?? undefined,
              priceUsd: parseFloat(pair.priceUsd ?? "0"),
              marketCap: pair.marketCap ?? pair.fdv ?? 0,
              liquidity: pair.liquidity?.usd ?? 0,
              volume24h: pair.volume?.h24 ?? 0,
              priceChange24h: pair.priceChange?.h24 ?? 0,
              chainId: pair.chainId ?? "",
              pairAddress: pair.pairAddress ?? "",
            };
            return t;
          } catch {
            return null;
          }
        }),
      );

      setTrending(results.filter((t): t is TokenResult => t !== null));
    } catch {
      /* silent — falls back to empty state text */
    } finally {
      setTrendingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !query) fetchTrending();
  }, [open, query, fetchTrending]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // ⌘K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSelectToken = (token: TokenResult) => {
    if (!onSelectMeme) return;
    // Build MemeTrend from the search result
    const meme: MemeTrend = {
      keyword: token.symbol,
      score: 0,
      posts: 0,
      source: token.chainId,
      contractAddress: token.address,
      mcap: token.marketCap,
      volume: token.volume24h,
      hasTicker: true,
      isNewCoin: false,
    };
    onSelectMeme(meme);
    setOpen(false);
    setQuery("");
    setResults([]);
  };

  const handleCopyCA = (e: React.MouseEvent, addr: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(addr);
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr(null), 1500);
  };

  const handleOpenDex = (e: React.MouseEvent, token: TokenResult) => {
    e.stopPropagation();
    window.open(
      `https://dexscreener.com/${token.chainId}/${token.pairAddress}`,
      "_blank",
    );
  };

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", maxWidth: 480 }}
    >
      {/* ── Trigger ── */}
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) setTimeout(() => inputRef.current?.focus(), 50);
        }}
        style={{
          width: "100%",
          background: "#0a0a0a",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: open ? "#e8490f44" : "#1e1e1e",
          borderRadius: 6,
          height: 36,
          padding: "0 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          transition: "border-color .15s, box-shadow .15s",
          boxShadow: open ? "0 0 0 1px #e8490f22" : "none",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.borderColor = "#2a2a2a";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.borderColor = "#1e1e1e";
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          style={{ opacity: 0.25, flexShrink: 0 }}
        >
          <circle cx="11" cy="11" r="8" stroke="#fff" strokeWidth="2" />
          <path
            d="M21 21L16.65 16.65"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <span
          style={{
            color: "#282828",
            fontSize: 11,
            ...MONO,
            letterSpacing: ".08em",
            flex: 1,
            textAlign: "left",
          }}
        >
          SEARCH TOKENS...
        </span>
        <kbd
          style={{
            color: "#1e1e1e",
            fontSize: 9,
            ...MONO,
            border: "1px solid #1e1e1e",
            borderRadius: 3,
            padding: "2px 6px",
            letterSpacing: 0,
            lineHeight: 1.4,
            flexShrink: 0,
          }}
        >
          ⌘K
        </kbd>
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "#080808",
            border: "1px solid #1a1a1a",
            borderRadius: 8,
            overflow: "hidden",
            boxShadow: "0 20px 60px #000000f0",
            zIndex: 99999,
          }}
        >
          {/* Input row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 14px",
              borderBottom: "1px solid #111",
              gap: 10,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              style={{ opacity: 0.25, flexShrink: 0 }}
            >
              <circle cx="11" cy="11" r="8" stroke="#fff" strokeWidth="2" />
              <path
                d="M21 21L16.65 16.65"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ticker, name or contract address..."
              autoFocus
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#bbb",
                fontSize: 12,
                ...MONO,
                letterSpacing: ".03em",
              }}
            />
            {loading && (
              <div
                style={{
                  width: 12,
                  height: 12,
                  border: "1.5px solid #222",
                  borderTop: "1.5px solid #e8490f",
                  borderRadius: "50%",
                  animation: "wraith-spin 0.6s linear infinite",
                  flexShrink: 0,
                }}
              />
            )}
            {!loading && query && (
              <button
                onClick={() => {
                  setQuery("");
                  setResults([]);
                  setError(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#2a2a2a",
                  cursor: "pointer",
                  fontSize: 14,
                  padding: 0,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Empty state — only if trending failed/returned nothing */}
          {!query && !trendingLoading && trending.length === 0 && (
            <div
              style={{
                padding: "20px 14px",
                color: "#1e1e1e",
                fontSize: 10,
                ...MONO,
                letterSpacing: ".1em",
                textAlign: "center",
              }}
            >
              SEARCH BY TICKER · NAME · CONTRACT ADDRESS
            </div>
          )}

          {/* Error */}
          {error && !loading && query && (
            <div
              style={{
                padding: "18px 14px",
                color: "#2a2a2a",
                fontSize: 10,
                ...MONO,
                textAlign: "center",
                letterSpacing: ".08em",
              }}
            >
              {error}
            </div>
          )}

          {/* Trending (shown when no query yet) */}
          {!query && !error && (
            <>
              {trendingLoading && !trending.length && (
                <div
                  style={{
                    padding: "20px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      border: "1.5px solid #222",
                      borderTop: "1.5px solid #e8490f",
                      borderRadius: "50%",
                      animation: "wraith-spin 0.6s linear infinite",
                    }}
                  />
                  <span
                    style={{
                      color: "#333",
                      fontSize: 9,
                      ...MONO,
                      letterSpacing: ".1em",
                    }}
                  >
                    LOADING TRENDING
                  </span>
                </div>
              )}
              {trending.length > 0 && (
                <div
                  style={{
                    padding: "9px 14px 5px",
                    color: "#e8490f88",
                    fontSize: 8,
                    ...MONO,
                    letterSpacing: ".14em",
                  }}
                >
                  TRENDING NOW
                </div>
              )}
              {trending.map((token, i) => (
                <TokenRow
                  key={`t-${token.address}`}
                  token={token}
                  isLast={i === trending.length - 1}
                  copiedAddr={copiedAddr}
                  onSelect={handleSelectToken}
                  onCopy={handleCopyCA}
                  onOpenDex={handleOpenDex}
                  showOpenCta={!!onSelectMeme}
                />
              ))}
            </>
          )}

          {/* Results */}
          {results.map((token, i) => (
            <TokenRow
              key={token.address}
              token={token}
              isLast={i === results.length - 1}
              copiedAddr={copiedAddr}
              onSelect={handleSelectToken}
              onCopy={handleCopyCA}
              onOpenDex={handleOpenDex}
              showOpenCta={!!onSelectMeme}
            />
          ))}

          <style>{`@keyframes wraith-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────
interface HeaderProps {
  onSelectMeme?: (meme: MemeTrend) => void;
}

export default function Header({ onSelectMeme }: HeaderProps) {
  const { connected, publicKey, disconnect, connecting } = useWallet();
  const { data: session } = useSession();
  const { tier } = useWraithTier();
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [tgLinking, setTgLinking] = useState(false);
  const [tgLinked, setTgLinked] = useState(false);
  const [tgTooltip, setTgTooltip] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [mounted, setMounted] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const profileBtnRef = useRef<HTMLButtonElement>(null);

  const canUseTelegram = TELEGRAM_TIERS.includes(tier?.key ?? "");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (connected) setModalOpen(false);
  }, [connected]);

  const handleCopy = () => {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const menu = document.getElementById("wraith-user-menu");
      if (menu && menu.contains(e.target as Node)) return;
      if (
        profileBtnRef.current &&
        profileBtnRef.current.contains(e.target as Node)
      )
        return;
      setUserMenuOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  useEffect(() => {
    if (!walletMenuOpen) return;
    const handler = () => setWalletMenuOpen(false);
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [walletMenuOpen]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/user/telegram-status")
      .then((r) => r.json())
      .then((d) => {
        if (d.linked) setTgLinked(true);
      })
      .catch(() => {});
  }, [session]);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch("/api/user/telegram-status");
        const d = await r.json();
        if (d.linked) {
          setTgLinked(true);
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      } catch {
        /* silent */
      }
      if (attempts >= 10) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleConnectTelegram = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canUseTelegram || tgLinked) return;
    setTgLinking(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank");
        startPolling();
      }
    } catch {
      /* silent */
    } finally {
      setTgLinking(false);
    }
  };

  const handleProfileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!userMenuOpen && profileBtnRef.current) {
      const rect = profileBtnRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
    setUserMenuOpen((v) => !v);
  };

  const userMenu =
    mounted && userMenuOpen && session
      ? createPortal(
          <div
            id="wraith-user-menu"
            style={{
              position: "fixed",
              top: menuPos.top,
              right: menuPos.right,
              background: "#060606",
              border: "1px solid #111",
              borderRadius: 5,
              minWidth: 200,
              zIndex: 99999,
              overflow: "hidden",
              boxShadow: "0 8px 32px #000000cc",
              ...MONO,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid #0d0d0d",
              }}
            >
              <div
                style={{ color: "#555", fontSize: 9, ...MONO, marginBottom: 3 }}
              >
                SIGNED IN AS
              </div>
              <div
                style={{
                  color: "#888",
                  fontSize: 10,
                  ...MONO,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 172,
                }}
              >
                {session.user?.email ?? "—"}
              </div>
            </div>

            <div
              style={{ position: "relative" }}
              onMouseEnter={() => !canUseTelegram && setTgTooltip(true)}
              onMouseLeave={() => setTgTooltip(false)}
            >
              <button
                onClick={
                  canUseTelegram && !tgLinked
                    ? handleConnectTelegram
                    : undefined
                }
                disabled={tgLinking}
                style={{
                  width: "100%",
                  background: tgLinked ? "#001a0d" : "transparent",
                  border: "none",
                  borderBottom: "1px solid #0d0d0d",
                  color: tgLinked
                    ? "#00c47a"
                    : canUseTelegram
                      ? "#2b9fd4"
                      : "#2a2a2a",
                  fontSize: 10,
                  ...MONO,
                  padding: "10px 14px",
                  cursor: tgLinked || !canUseTelegram ? "default" : "pointer",
                  textAlign: "left",
                  letterSpacing: ".06em",
                  transition: "background .15s, color .15s",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
                onMouseEnter={(e) => {
                  if (canUseTelegram && !tgLinked) {
                    e.currentTarget.style.background = "#0a1520";
                    e.currentTarget.style.color = "#3ab8f0";
                  }
                }}
                onMouseLeave={(e) => {
                  if (canUseTelegram && !tgLinked) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#2b9fd4";
                  }
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ flexShrink: 0, opacity: canUseTelegram ? 1 : 0.3 }}
                >
                  <path
                    d="M22 2L11 13"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M22 2L15 22L11 13L2 9L22 2Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>
                  {tgLinking
                    ? "OPENING..."
                    : tgLinked
                      ? "TELEGRAM LINKED"
                      : "CONNECT TELEGRAM"}
                </span>
                {tgLinked && (
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#00c47a",
                      boxShadow: "0 0 6px #00c47a88",
                      marginLeft: "auto",
                      flexShrink: 0,
                    }}
                  />
                )}
                {!canUseTelegram && (
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    style={{ marginLeft: "auto", opacity: 0.4 }}
                  >
                    <rect
                      x="3"
                      y="11"
                      width="18"
                      height="11"
                      rx="2"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      d="M7 11V7C7 4.24 9.24 2 12 2C14.76 2 17 4.24 17 7V11"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                )}
              </button>
              {tgTooltip && !canUseTelegram && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    left: 14,
                    background: "#0a0a0a",
                    border: "1px solid #1a1a1a",
                    borderRadius: 4,
                    padding: "6px 10px",
                    fontSize: 9,
                    color: "#e8490f",
                    ...MONO,
                    whiteSpace: "nowrap",
                    zIndex: 300,
                    letterSpacing: ".05em",
                    pointerEvents: "none",
                  }}
                >
                  SPECTER TIER REQUIRED
                  <div
                    style={{
                      position: "absolute",
                      bottom: -4,
                      left: 12,
                      width: 7,
                      height: 7,
                      background: "#0a0a0a",
                      border: "1px solid #1a1a1a",
                      borderTop: "none",
                      borderLeft: "none",
                      transform: "rotate(45deg)",
                    }}
                  />
                </div>
              )}
            </div>

            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: "#ff4444",
                fontSize: 10,
                ...MONO,
                padding: "10px 14px",
                cursor: "pointer",
                textAlign: "left",
                letterSpacing: ".06em",
                transition: "background .15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#1a0000";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              SIGN OUT
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <WalletModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <header
        style={{
          background: "#020202",
          borderBottom: "1px solid #0d0d0d",
          padding: isMobile ? "0 12px" : "0 20px",
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 8 : 16,
          ...MONO,
        }}
      >
        {/* ── LEFT: branding ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 6 : 10,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              position: "relative",
              flexShrink: 0,
            }}
          >
            <Image
              src="/logo.png"
              alt="Wraith logo"
              fill
              sizes="28px"
              style={{
                objectFit: "contain",
                mixBlendMode: "screen",
                filter: "drop-shadow(0 0 5px #e8490f77)",
              }}
              priority
            />
          </div>
          <span
            style={{
              color: "#e0e0e0",
              fontSize: isMobile ? 13 : 16,
              fontWeight: 900,
              letterSpacing: ".22em",
              lineHeight: 1,
              display: isMobile && publicKey ? "none" : "inline",
            }}
          >
            WRAITH
          </span>
        </div>

        {/* ── CENTER: Search — takes all available space ── */}
        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "center",
            minWidth: 0,
          }}
        >
          <CoinSearch onSelectMeme={onSelectMeme} />
        </div>

        {/* ── RIGHT: wallet + user ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 5 : 8,
            flexShrink: 0,
          }}
        >
          {connected && publicKey ? (
            <>
              <TierBadge compact />
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setWalletMenuOpen((v) => !v)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: copied ? "#00c47a" : "#555",
                    fontSize: isMobile ? 10 : 11,
                    ...MONO,
                    padding: "0 4px",
                    height: 30,
                    cursor: "pointer",
                    letterSpacing: ".04em",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    flexShrink: 0,
                    maxWidth: isMobile ? 90 : "none",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    transition: "color .15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!copied) e.currentTarget.style.color = "#888";
                  }}
                  onMouseLeave={(e) => {
                    if (!copied) e.currentTarget.style.color = "#555";
                  }}
                >
                  <div
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "#00c47a",
                      boxShadow: "0 0 5px #00c47a88",
                      flexShrink: 0,
                    }}
                  />
                  {copied ? "COPIED" : trimAddress(publicKey.toString())}
                  <svg
                    width="7"
                    height="7"
                    viewBox="0 0 8 8"
                    style={{
                      transform: walletMenuOpen
                        ? "rotate(180deg)"
                        : "rotate(0deg)",
                      transition: "transform .15s",
                      flexShrink: 0,
                    }}
                  >
                    <path
                      d="M1 2.5L4 5.5L7 2.5"
                      stroke="#444"
                      strokeWidth="1.5"
                      fill="none"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                {walletMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 8px)",
                      right: 0,
                      background: "#060606",
                      border: "1px solid #111",
                      borderRadius: 5,
                      minWidth: 160,
                      zIndex: 99999,
                      overflow: "hidden",
                      boxShadow: "0 8px 32px #000000cc",
                    }}
                  >
                    <button
                      onClick={() => {
                        handleCopy();
                        setWalletMenuOpen(false);
                      }}
                      style={{
                        width: "100%",
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px solid #0d0d0d",
                        color: "#666",
                        fontSize: 10,
                        ...MONO,
                        padding: "10px 14px",
                        cursor: "pointer",
                        textAlign: "left",
                        letterSpacing: ".05em",
                      }}
                    >
                      COPY ADDRESS
                    </button>
                    <button
                      onClick={() => {
                        disconnect();
                        setWalletMenuOpen(false);
                      }}
                      style={{
                        width: "100%",
                        background: "transparent",
                        border: "none",
                        color: "#ff4444",
                        fontSize: 10,
                        ...MONO,
                        padding: "10px 14px",
                        cursor: "pointer",
                        textAlign: "left",
                        letterSpacing: ".05em",
                      }}
                    >
                      DISCONNECT
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <button
              onClick={() => setModalOpen(true)}
              disabled={connecting}
              style={{
                background: connecting ? "#0a0a0a" : "#e8490f",
                border: "none",
                color: connecting ? "#444" : "#fff",
                fontSize: isMobile ? 9 : 11,
                fontWeight: 700,
                ...MONO,
                padding: isMobile ? "0 10px" : "0 18px",
                height: 30,
                borderRadius: 4,
                cursor: connecting ? "not-allowed" : "pointer",
                letterSpacing: isMobile ? ".06em" : ".1em",
                boxShadow: connecting ? "none" : "0 0 14px #e8490f33",
                transition: "all .15s",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                if (!connecting) e.currentTarget.style.background = "#ff5a1f";
              }}
              onMouseLeave={(e) => {
                if (!connecting) e.currentTarget.style.background = "#e8490f";
              }}
            >
              {connecting
                ? isMobile
                  ? "..."
                  : "CONNECTING..."
                : isMobile
                  ? "CONNECT"
                  : "CONNECT WALLET"}
            </button>
          )}

          {session && (
            <div
              style={{
                width: 1,
                height: 20,
                background: "#111",
                margin: "0 2px",
                flexShrink: 0,
              }}
            />
          )}

          {session && (
            <div style={{ flexShrink: 0 }}>
              <button
                ref={profileBtnRef}
                onClick={handleProfileClick}
                style={{
                  background: "transparent",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: "#181818",
                  borderRadius: 4,
                  padding: isMobile ? "0 6px" : "0 8px",
                  height: 30,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: isMobile ? 4 : 7,
                  transition: "border-color .15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#2a2a2a";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#181818";
                }}
              >
                {session.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt="avatar"
                    width={20}
                    height={20}
                    style={{ borderRadius: "50%", display: "block" }}
                  />
                ) : (
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "#e8490f18",
                      border: "1px solid #e8490f33",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#e8490f",
                      fontSize: 8,
                      fontWeight: 700,
                      ...MONO,
                    }}
                  >
                    {(session.user?.name ??
                      session.user?.email ??
                      "?")[0].toUpperCase()}
                  </div>
                )}
                {(!isMobile || !connected) && (
                  <span style={{ color: "#333", fontSize: 10, ...MONO }}>
                    {session.user?.name?.split(" ")[0] ??
                      session.user?.email?.split("@")[0] ??
                      "USER"}
                  </span>
                )}
                {tgLinked && (
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#00c47a",
                      boxShadow: "0 0 6px #00c47a88",
                      flexShrink: 0,
                    }}
                  />
                )}
                <svg
                  width="7"
                  height="7"
                  viewBox="0 0 8 8"
                  style={{
                    transform: userMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform .15s",
                  }}
                >
                  <path
                    d="M1 2.5L4 5.5L7 2.5"
                    stroke="#333"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>
      </header>

      {userMenu}
    </>
  );
}
