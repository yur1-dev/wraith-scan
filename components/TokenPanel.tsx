"use client";

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { MemeTrend } from "@/app/page";

const DEXSCREENER_SEARCH = "https://api.dexscreener.com/latest/dex/search?q=";
const DEXSCREENER_PAIRS = "https://api.dexscreener.com/latest/dex/tokens/";
const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens";
const JUPITER_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP = "https://quote-api.jup.ag/v6/swap";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS = 1_000_000_000;

interface DexPair {
  baseToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  volume: { h24: number; h6: number; h1: number };
  liquidity: { usd: number };
  priceChange: { h24: number; h6: number; h1: number };
  fdv?: number;
  pairCreatedAt?: number;
  pairAddress: string;
  url: string;
  chainId: string;
}

interface RugResult {
  score: number;
  risks: { name: string; level: string }[];
}

interface Props {
  selectedMeme: MemeTrend | null;
}

const SOL_AMOUNTS = [0.05, 0.1, 0.5, 1];

export default function TokenPanel({ selectedMeme }: Props) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [tab, setTab] = useState<"find" | "buy" | "create">("find");
  const [tokens, setTokens] = useState<DexPair[]>([]);
  const [selected, setSelected] = useState<DexPair | null>(null);
  const [rugResult, setRugResult] = useState<RugResult | null>(null);
  const [loadingDex, setLoadingDex] = useState(false);
  const [loadingRug, setLoadingRug] = useState(false);
  const [loadingBuy, setLoadingBuy] = useState(false);
  const [solAmount, setSolAmount] = useState(0.1);
  const [buyStatus, setBuyStatus] = useState<{
    ok: boolean;
    msg: string;
    sig?: string;
  } | null>(null);
  const [dexError, setDexError] = useState("");

  useEffect(() => {
    if (!selectedMeme) return;
    setTokens([]);
    setSelected(null);
    setRugResult(null);
    setBuyStatus(null);
    setDexError("");
    setTab("find");
    searchTokens(selectedMeme.keyword);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMeme?.keyword]);

  const searchTokens = useCallback(async (keyword: string) => {
    setLoadingDex(true);
    setDexError("");
    try {
      // Try search first
      const res = await axios.get(
        `${DEXSCREENER_SEARCH}${encodeURIComponent(keyword)}`,
        { timeout: 12000 },
      );
      let pairs: DexPair[] = (res.data?.pairs || [])
        .filter((p: DexPair) => p.chainId === "solana")
        .sort((a: DexPair, b: DexPair) => {
          // Sort: newest first if < 24h, otherwise by volume
          const aNew =
            a.pairCreatedAt && Date.now() - a.pairCreatedAt < 86400000;
          const bNew =
            b.pairCreatedAt && Date.now() - b.pairCreatedAt < 86400000;
          if (aNew && !bNew) return -1;
          if (!aNew && bNew) return 1;
          return (b.volume?.h24 || 0) - (a.volume?.h24 || 0);
        })
        .slice(0, 12);

      // If no results, try the keyword as a contract address (for pump.fun coins)
      if (pairs.length === 0) {
        try {
          const res2 = await axios.get(`${DEXSCREENER_PAIRS}${keyword}`, {
            timeout: 10000,
          });
          const p2: DexPair[] = (res2.data?.pairs || []).filter(
            (p: DexPair) => p.chainId === "solana",
          );
          pairs = p2.slice(0, 6);
        } catch {
          /* continue */
        }
      }

      setTokens(pairs);
      if (pairs.length > 0) {
        setSelected(pairs[0]);
        checkRug(pairs[0].baseToken.address);
      } else {
        setDexError(
          "No Solana pairs found yet — this meme might be pre-coin. Use CREATE to launch it.",
        );
      }
    } catch {
      setDexError("DexScreener lookup failed — check your connection.");
    } finally {
      setLoadingDex(false);
    }
  }, []);

  const checkRug = useCallback(async (address: string) => {
    setLoadingRug(true);
    setRugResult(null);
    try {
      const res = await axios.get(`${RUGCHECK_API}/${address}/report/summary`, {
        timeout: 10000,
      });
      setRugResult({
        score: res.data?.score || 0,
        risks: res.data?.risks || [],
      });
    } catch {
      setRugResult({
        score: -1,
        risks: [{ name: "RugCheck unavailable", level: "warn" }],
      });
    } finally {
      setLoadingRug(false);
    }
  }, []);

  const executeBuy = useCallback(async () => {
    if (!publicKey || !signTransaction || !selected) return;
    setBuyStatus(null);
    setLoadingBuy(true);
    try {
      const lamports = Math.round(solAmount * LAMPORTS);
      const quoteRes = await axios.get(JUPITER_QUOTE, {
        params: {
          inputMint: SOL_MINT,
          outputMint: selected.baseToken.address,
          amount: lamports,
          slippageBps: 500,
        },
        timeout: 15000,
      });
      const quote = quoteRes.data;
      if (!quote || quote.error)
        throw new Error(quote?.error || "No route found on Jupiter");

      const swapRes = await axios.post(
        JUPITER_SWAP,
        {
          quoteResponse: quote,
          userPublicKey: publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: "auto",
        },
        { timeout: 15000 },
      );

      const { swapTransaction } = swapRes.data;
      if (!swapTransaction) throw new Error("No swap transaction returned");

      const tx = VersionedTransaction.deserialize(
        Buffer.from(swapTransaction, "base64"),
      );
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });
      const { value } = await connection.confirmTransaction(sig, "confirmed");
      if (value.err)
        throw new Error(`Transaction failed: ${JSON.stringify(value.err)}`);

      setBuyStatus({ ok: true, msg: `Bought — TX confirmed`, sig });
    } catch (err: unknown) {
      setBuyStatus({
        ok: false,
        msg: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoadingBuy(false);
    }
  }, [publicKey, signTransaction, selected, solAmount, connection]);

  const rugColor = (s: number) =>
    s < 0 ? "#555" : s < 300 ? "#00c47a" : s < 700 ? "#e8490f" : "#ff3030";
  const rugLabel = (s: number) =>
    s < 0 ? "UNKNOWN" : s < 300 ? "SAFE" : s < 700 ? "MODERATE" : "DANGER";

  const pairAge = (ts?: number) => {
    if (!ts) return null;
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 60) return `${m}m old`;
    if (m < 1440) return `${Math.floor(m / 60)}h old`;
    return `${Math.floor(m / 1440)}d old`;
  };

  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  };

  const MONO = { fontFamily: "monospace" as const };

  const tabBtn = (t: "find" | "buy" | "create") => ({
    padding: "8px 16px",
    fontSize: 11,
    fontWeight: 700,
    ...MONO,
    letterSpacing: "0.12em",
    background: tab === t ? "#e8490f" : "transparent",
    color: tab === t ? "#fff" : "#555",
    border: "none",
    cursor: "pointer",
  });

  const pumpFunUrl = selectedMeme
    ? `https://pump.fun/create?name=${encodeURIComponent(
        selectedMeme.keyword.charAt(0).toUpperCase() +
          selectedMeme.keyword.slice(1),
      )}&symbol=${encodeURIComponent(selectedMeme.keyword.toUpperCase().slice(0, 8))}`
    : "https://pump.fun/create";

  return (
    <div
      style={{
        background: "#0d0d0d",
        border: "1px solid #1a1a1a",
        borderRadius: 8,
        overflow: "hidden",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          borderBottom: "1px solid #1a1a1a",
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div>
          <div
            style={{
              color: "#e8490f",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.15em",
              ...MONO,
            }}
          >
            TOKEN PANEL
          </div>
          <div style={{ color: "#444", fontSize: 10, marginTop: 2, ...MONO }}>
            {selectedMeme
              ? `Searching $${selectedMeme.keyword.toUpperCase()} on Solana`
              : "Select a signal from scanner"}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            background: "#111",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <button style={tabBtn("find")} onClick={() => setTab("find")}>
            FIND
          </button>
          <button style={tabBtn("buy")} onClick={() => setTab("buy")}>
            BUY
          </button>
          <button style={tabBtn("create")} onClick={() => setTab("create")}>
            CREATE
          </button>
        </div>
      </div>

      {/* FIND TAB */}
      {tab === "find" && (
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {!selectedMeme && (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "#222",
                ...MONO,
              }}
            >
              <div style={{ fontSize: 11, letterSpacing: "0.12em" }}>
                SELECT A SIGNAL FROM SCANNER
              </div>
            </div>
          )}

          {loadingDex && (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#e8490f",
                ...MONO,
                fontSize: 11,
                letterSpacing: "0.1em",
              }}
            >
              SEARCHING DEXSCREENER...
            </div>
          )}

          {dexError && !loadingDex && (
            <div
              style={{
                padding: 18,
                color: "#666",
                ...MONO,
                fontSize: 11,
                lineHeight: "1.6",
              }}
            >
              {dexError}
              {dexError.includes("pre-coin") && (
                <button
                  onClick={() => setTab("create")}
                  style={{
                    display: "block",
                    marginTop: 12,
                    background: "#e8490f",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    padding: "8px 16px",
                    ...MONO,
                    fontSize: 11,
                    cursor: "pointer",
                    letterSpacing: "0.1em",
                  }}
                >
                  LAUNCH THIS MEME ON PUMP.FUN
                </button>
              )}
            </div>
          )}

          {tokens.length > 0 && (
            <div style={{ flex: 1, overflowY: "auto" }}>
              {tokens.map((t, i) => {
                const age = pairAge(t.pairCreatedAt);
                const isNew =
                  t.pairCreatedAt && Date.now() - t.pairCreatedAt < 86400000;
                return (
                  <button
                    key={t.pairAddress}
                    onClick={() => {
                      setSelected(t);
                      checkRug(t.baseToken.address);
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "11px 18px",
                      borderBottom: "1px solid #0d0d0d",
                      background:
                        selected?.pairAddress === t.pairAddress
                          ? "#130700"
                          : "transparent",
                      borderLeft: `2px solid ${selected?.pairAddress === t.pairAddress ? "#e8490f" : "transparent"}`,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                    onMouseEnter={(e) => {
                      if (selected?.pairAddress !== t.pairAddress)
                        (e.currentTarget as HTMLElement).style.background =
                          "#101010";
                    }}
                    onMouseLeave={(e) => {
                      if (selected?.pairAddress !== t.pairAddress)
                        (e.currentTarget as HTMLElement).style.background =
                          "transparent";
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 2,
                        }}
                      >
                        <span style={{ color: "#333", fontSize: 10, ...MONO }}>
                          {i + 1}
                        </span>
                        <span
                          style={{
                            color: "#fff",
                            fontSize: 13,
                            fontWeight: 700,
                            ...MONO,
                          }}
                        >
                          {t.baseToken.symbol}
                        </span>
                        {isNew && (
                          <span
                            style={{
                              fontSize: 8,
                              color: "#a855f7",
                              border: "1px solid #a855f744",
                              padding: "1px 5px",
                              borderRadius: 3,
                              ...MONO,
                            }}
                          >
                            NEW
                          </span>
                        )}
                        <span style={{ color: "#444", fontSize: 10, ...MONO }}>
                          {t.baseToken.name.slice(0, 24)}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <span
                          style={{ color: "#2a2a2a", fontSize: 9, ...MONO }}
                        >
                          {t.baseToken.address.slice(0, 8)}...
                          {t.baseToken.address.slice(-6)}
                        </span>
                        {age && (
                          <span
                            style={{
                              color: "#444",
                              fontSize: 9,
                              ...MONO,
                              borderLeft: "1px solid #1a1a1a",
                              paddingLeft: 8,
                            }}
                          >
                            {age}
                          </span>
                        )}
                        {t.fdv && t.fdv < 10_000_000 && (
                          <span
                            style={{
                              color: "#444",
                              fontSize: 9,
                              ...MONO,
                              borderLeft: "1px solid #1a1a1a",
                              paddingLeft: 8,
                            }}
                          >
                            mcap {fmt(t.fdv)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#fff", fontSize: 12, ...MONO }}>
                        ${parseFloat(t.priceUsd || "0").toFixed(9)}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          justifyContent: "flex-end",
                          marginTop: 2,
                        }}
                      >
                        <span style={{ color: "#444", fontSize: 9, ...MONO }}>
                          Vol {fmt(t.volume?.h24 || 0)}
                        </span>
                        <span
                          style={{
                            fontSize: 9,
                            ...MONO,
                            fontWeight: 700,
                            color:
                              (t.priceChange?.h24 || 0) >= 0
                                ? "#00c47a"
                                : "#ff3030",
                          }}
                        >
                          {(t.priceChange?.h24 || 0) >= 0 ? "+" : ""}
                          {(t.priceChange?.h24 || 0).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selected && (
            <div
              style={{
                borderTop: "1px solid #1a1a1a",
                padding: "14px 18px",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  color: "#333",
                  fontSize: 10,
                  ...MONO,
                  marginBottom: 6,
                }}
              >
                SELECTED TOKEN
              </div>
              <div
                style={{
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  ...MONO,
                }}
              >
                {selected.baseToken.name}
              </div>
              <div
                style={{
                  color: "#2a2a2a",
                  fontSize: 10,
                  ...MONO,
                  marginTop: 2,
                  marginBottom: 12,
                }}
              >
                {selected.baseToken.address}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                {[
                  { label: "24H VOL", value: fmt(selected.volume?.h24 || 0) },
                  {
                    label: "LIQUIDITY",
                    value: fmt(selected.liquidity?.usd || 0),
                  },
                  {
                    label: "24H CHG",
                    value: `${(selected.priceChange?.h24 || 0) >= 0 ? "+" : ""}${(selected.priceChange?.h24 || 0).toFixed(1)}%`,
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    style={{
                      background: "#111",
                      borderRadius: 4,
                      padding: "9px 12px",
                    }}
                  >
                    <div
                      style={{
                        color: "#333",
                        fontSize: 9,
                        ...MONO,
                        marginBottom: 3,
                      }}
                    >
                      {s.label}
                    </div>
                    <div
                      style={{
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 700,
                        ...MONO,
                      }}
                    >
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>

              {loadingRug && (
                <div
                  style={{
                    color: "#444",
                    fontSize: 10,
                    ...MONO,
                    marginBottom: 8,
                  }}
                >
                  Running rug check...
                </div>
              )}
              {rugResult && !loadingRug && (
                <div
                  style={{
                    background: "#111",
                    borderRadius: 4,
                    padding: "10px 14px",
                    border: `1px solid ${rugColor(rugResult.score)}33`,
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ color: "#444", fontSize: 10, ...MONO }}>
                      RUG CHECK
                    </span>
                    <span
                      style={{
                        color: rugColor(rugResult.score),
                        fontSize: 11,
                        fontWeight: 700,
                        ...MONO,
                      }}
                    >
                      {rugLabel(rugResult.score)}{" "}
                      {rugResult.score >= 0 ? `(${rugResult.score})` : ""}
                    </span>
                  </div>
                  {rugResult.risks.slice(0, 3).map((r, i) => (
                    <div
                      key={i}
                      style={{
                        color: r.level === "danger" ? "#ff4444" : "#555",
                        fontSize: 10,
                        ...MONO,
                      }}
                    >
                      — {r.name}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setTab("buy")}
                  style={{
                    flex: 1,
                    background: "#e8490f",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    padding: 10,
                    fontSize: 11,
                    fontWeight: 700,
                    ...MONO,
                    letterSpacing: "0.1em",
                    cursor: "pointer",
                  }}
                >
                  BUY
                </button>
                <a
                  href={selected.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1,
                    background: "#111",
                    color: "#555",
                    border: "none",
                    borderRadius: 4,
                    padding: 10,
                    fontSize: 11,
                    ...MONO,
                    letterSpacing: "0.1em",
                    cursor: "pointer",
                    textAlign: "center",
                    textDecoration: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  DEXSCREENER
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BUY TAB */}
      {tab === "buy" && (
        <div style={{ flex: 1, overflow: "auto", padding: 18 }}>
          {!selected ? (
            <div
              style={{
                textAlign: "center",
                color: "#333",
                ...MONO,
                fontSize: 11,
                marginTop: 60,
              }}
            >
              Go to FIND tab and select a token first
            </div>
          ) : !publicKey ? (
            <div
              style={{
                textAlign: "center",
                color: "#e8490f",
                ...MONO,
                fontSize: 11,
                marginTop: 60,
                letterSpacing: "0.1em",
              }}
            >
              CONNECT WALLET TO BUY
            </div>
          ) : (
            <>
              <div
                style={{
                  background: "#111",
                  borderRadius: 6,
                  padding: 14,
                  marginBottom: 18,
                  border: "1px solid #1a1a1a",
                }}
              >
                <div
                  style={{
                    color: "#444",
                    fontSize: 10,
                    ...MONO,
                    marginBottom: 4,
                  }}
                >
                  BUYING
                </div>
                <div
                  style={{
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 700,
                    ...MONO,
                  }}
                >
                  {selected.baseToken.name}{" "}
                  <span style={{ color: "#e8490f" }}>
                    (${selected.baseToken.symbol})
                  </span>
                </div>
                <div
                  style={{ color: "#444", fontSize: 10, ...MONO, marginTop: 4 }}
                >
                  {selected.baseToken.address.slice(0, 16)}...
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    color: "#444",
                    fontSize: 10,
                    ...MONO,
                    marginBottom: 8,
                  }}
                >
                  AMOUNT (SOL)
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    gap: 6,
                    marginBottom: 8,
                  }}
                >
                  {SOL_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setSolAmount(amt)}
                      style={{
                        padding: "10px 0",
                        background: solAmount === amt ? "#e8490f" : "#111",
                        color: solAmount === amt ? "#fff" : "#444",
                        border: `1px solid ${solAmount === amt ? "#e8490f" : "#1a1a1a"}`,
                        borderRadius: 4,
                        fontSize: 12,
                        ...MONO,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {amt}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={solAmount}
                  onChange={(e) =>
                    setSolAmount(parseFloat(e.target.value) || 0.1)
                  }
                  step="0.01"
                  min="0.01"
                  style={{
                    width: "100%",
                    background: "#111",
                    border: "1px solid #1a1a1a",
                    borderRadius: 4,
                    padding: "10px 14px",
                    color: "#fff",
                    ...MONO,
                    fontSize: 13,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div
                style={{
                  color: "#333",
                  fontSize: 10,
                  ...MONO,
                  marginBottom: 18,
                }}
              >
                Via Jupiter Aggregator — 5% slippage — auto priority fee
              </div>

              <button
                onClick={executeBuy}
                disabled={loadingBuy}
                style={{
                  width: "100%",
                  padding: 14,
                  background: loadingBuy ? "#1a1a1a" : "#e8490f",
                  color: loadingBuy ? "#555" : "#fff",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  ...MONO,
                  letterSpacing: "0.12em",
                  cursor: loadingBuy ? "not-allowed" : "pointer",
                }}
              >
                {loadingBuy ? "PROCESSING..." : `BUY ${solAmount} SOL`}
              </button>

              {buyStatus && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "12px 14px",
                    background: buyStatus.ok ? "#001a0a" : "#1a0000",
                    border: `1px solid ${buyStatus.ok ? "#00c47a44" : "#ff303044"}`,
                    borderRadius: 6,
                    color: buyStatus.ok ? "#00c47a" : "#ff4444",
                    fontSize: 11,
                    ...MONO,
                    wordBreak: "break-all",
                  }}
                >
                  {buyStatus.msg}
                  {buyStatus.ok && buyStatus.sig && (
                    <a
                      href={`https://solscan.io/tx/${buyStatus.sig}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "#e8490f",
                        marginLeft: 10,
                        textDecoration: "none",
                      }}
                    >
                      VIEW ON SOLSCAN
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* CREATE TAB */}
      {tab === "create" && (
        <div style={{ flex: 1, overflow: "auto", padding: 18 }}>
          <div
            style={{
              color: "#e8490f",
              fontSize: 11,
              fontWeight: 700,
              ...MONO,
              letterSpacing: "0.12em",
              marginBottom: 8,
            }}
          >
            LAUNCH ON PUMP.FUN
          </div>
          <div
            style={{
              color: "#444",
              fontSize: 11,
              ...MONO,
              lineHeight: "1.8",
              marginBottom: 16,
            }}
          >
            This meme has no coin yet. Be the first to launch it on Pump.fun. If
            the meme goes viral after you launch, you hold the initial supply.
          </div>

          {selectedMeme && (
            <div
              style={{
                background: "#111",
                borderRadius: 6,
                padding: 14,
                marginBottom: 16,
                border: "1px solid #1a1a1a",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      color: "#333",
                      fontSize: 10,
                      ...MONO,
                      marginBottom: 4,
                    }}
                  >
                    SUGGESTED NAME
                  </div>
                  <div
                    style={{
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 700,
                      ...MONO,
                    }}
                  >
                    {selectedMeme.keyword.charAt(0).toUpperCase() +
                      selectedMeme.keyword.slice(1)}
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      color: "#333",
                      fontSize: 10,
                      ...MONO,
                      marginBottom: 4,
                    }}
                  >
                    SUGGESTED TICKER
                  </div>
                  <div
                    style={{
                      color: "#e8490f",
                      fontSize: 14,
                      fontWeight: 700,
                      ...MONO,
                    }}
                  >
                    ${selectedMeme.keyword.toUpperCase().slice(0, 8)}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div
            style={{
              background: "#0a0a0a",
              borderRadius: 6,
              padding: "12px 14px",
              marginBottom: 18,
              border: "1px solid #111",
            }}
          >
            {[
              "Instant launch — live in seconds",
              "Auto bonding curve — liquidity built in",
              "Auto-lists on Raydium at $69K mcap",
              "~0.02 SOL to deploy",
            ].map((item) => (
              <div
                key={item}
                style={{
                  color: "#555",
                  fontSize: 11,
                  ...MONO,
                  padding: "3px 0",
                }}
              >
                — {item}
              </div>
            ))}
          </div>

          <a
            href={pumpFunUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              width: "100%",
              padding: 14,
              background: "#e8490f",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 700,
              ...MONO,
              letterSpacing: "0.12em",
              cursor: "pointer",
              textAlign: "center",
              textDecoration: "none",
              boxSizing: "border-box",
            }}
          >
            OPEN PUMP.FUN TO LAUNCH
          </a>
        </div>
      )}
    </div>
  );
}
