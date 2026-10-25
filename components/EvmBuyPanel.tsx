"use client";
// Full trade dock for EVM tokens (mirrors the Solana dock): Buy / Sell, amount in your display currency,
// presets, position. Cash = stablecoins in your Wraith EVM wallet (lib/cashTokens.ts). Routing by LI.FI:
// same chain = swap, other chain = bridge + swap, in one signed transaction.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { CASH_TOKENS } from "@/lib/cashTokens";
import { useSignAndSendTransaction, useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { createPublicClient, formatUnits, http, parseAbi, parseUnits } from "viem";
import { LoaderCircle, Wallet } from "lucide-react";
import ChainLogo from "@/components/ChainLogo";
import { FINE_PRINT, NO_CASH_NOTE, PositionBlock } from "@/components/DockParts";
const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };
import { VIEM_CHAINS, rpcFor } from "@/lib/cashTokens";
import { friendlyError, execEvmRoute, lifiQuote, NATIVE_ADDR, SOLANA_LIFI_ID, waitForRoute, type LifiQuote } from "@/lib/lifi";
import { useCashSources } from "@/lib/useCashSources";
import { chainOf } from "@/lib/chains";
import { formatCurrency, isDisplayCurrency, type DisplayCurrency } from "@/lib/currencies";

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);

const PRESETS_USD = [5, 10, 25, 50];
const SELL_PRESETS = [25, 50, 100];

type Phase = "idle" | "quoting" | "approving" | "sending" | "bridging" | "done" | "error";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function EvmBuyPanel({ chainKey, tokenAddress, symbol, priceUsd }: { chainKey: string; tokenAddress: string; symbol: string; priceUsd: number }) {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { wallets: solWallets } = useSolanaWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const target = chainOf(chainKey);
  const tokenAddr = tokenAddress as `0x${string}`;
  const cash = useCashSources(chainKey);
  const { evmAddress: evm, solAddress, sources, loaded: cashLoaded } = cash;

  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [cur, setCur] = useState<DisplayCurrency>("USD");
  const [rate, setRate] = useState<number | null>(1);
  const [amountCash, setAmountCash] = useState("10");
  const [sellPct, setSellPct] = useState(100);
  const [srcId, setSrcId] = useState("");
  const [bal, setBal] = useState<{ raw: bigint; dec: number } | null>(null);
  const [quote, setQuote] = useState<LifiQuote | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [tx, setTx] = useState("");
  const qSeq = useRef(0);

  // display currency (shared with the Solana dock)
  useEffect(() => {
    try { const v = localStorage.getItem("wraith_display_currency_v1"); if (isDisplayCurrency(v)) setCur(v); } catch { /* ignore */ }
    const on = (e: Event) => { const d = (e as CustomEvent<DisplayCurrency>).detail; if (isDisplayCurrency(d)) setCur(d); };
    window.addEventListener("wraith:currency-sync", on);
    return () => window.removeEventListener("wraith:currency-sync", on);
  }, []);
  useEffect(() => {
    let live = true;
    if (cur === "USD") { setRate(1); return; }
    setRate(null);
    fetch(`/api/fx?currency=${cur}`, { cache: "no-store" }).then((r) => r.json()).then((p: { rate?: unknown }) => { if (live && typeof p.rate === "number" && p.rate > 0) setRate(p.rate); }).catch(() => {});
    return () => { live = false; };
  }, [cur]);

  useEffect(() => { setSrcId((c) => (c && sources.some((h) => h.id === c) ? c : sources[0]?.id ?? "")); }, [sources]);
  const loadCash = cash.reload;

  const loadToken = useCallback(async () => {
    if (!evm || !target) return;
    const chain = VIEM_CHAINS[chainKey]; const rpc = chain ? rpcFor(chain) : null;
    if (!chain || !rpc) return;
    try {
      const client = createPublicClient({ chain, transport: http(rpc, { retryCount: 0, timeout: 6000 }) });
      const [raw, dec] = await Promise.all([
        client.readContract({ address: tokenAddr, abi: ERC20, functionName: "balanceOf", args: [evm] }),
        client.readContract({ address: tokenAddr, abi: ERC20, functionName: "decimals" }),
      ]);
      setBal({ raw, dec: Number(dec) });
    } catch { /* leave as is */ }
  }, [evm, chainKey, tokenAddr, target]);
  useEffect(() => { void loadCash(); void loadToken(); }, [loadCash, loadToken]);

  const totalCash = cash.total;
  const src = sources.find((s) => s.id === srcId) ?? null;
  // where sells land: this chain's cash token (USDC / USDG)
  const sellDest = CASH_TOKENS.find((c) => c.chain === chainKey && !c.native) ?? CASH_TOKENS.find((c) => c.chain === chainKey) ?? null;
  const qty = bal ? Number(formatUnits(bal.raw, bal.dec)) : 0;
  const amountUsd = rate && rate > 0 ? Number(amountCash) / rate : NaN;

  // build the quote request for the current mode
  const req = useMemo(() => {
    if (!evm) return null;
    const toId = VIEM_CHAINS[chainKey].id;
    if (mode === "buy") {
      if (!src || !(amountUsd > 0) || amountUsd > src.balance + 1e-9) return null;
      const sol = src.kind === "solana";
      if (sol && !solAddress) return null;
      return { fromKey: src.chain, fromId: sol ? SOLANA_LIFI_ID : VIEM_CHAINS[src.chain].id, toId, fromToken: src.address, native: src.native, sol, fromRaw: parseUnits(amountUsd.toFixed(Math.min(src.decimals, 8)), src.decimals), toToken: tokenAddress, fromAddr: sol ? (solAddress as string) : evm, toAddr: evm as string };
    }
    if (!bal || bal.raw === BigInt(0) || !sellDest) return null;
    const raw = (bal.raw * BigInt(sellPct)) / BigInt(100);
    if (raw <= BigInt(0)) return null;
    return { fromKey: chainKey, fromId: toId, toId, fromToken: tokenAddress, native: false, sol: false, fromRaw: raw, toToken: sellDest.native ? NATIVE_ADDR : sellDest.address, fromAddr: evm as string, toAddr: evm as string };
  }, [evm, solAddress, mode, src, amountUsd, bal, sellPct, sellDest, chainKey, tokenAddress]);

  useEffect(() => {
    setQuote(null);
    if (!req) { setPhase((p) => (p === "quoting" ? "idle" : p)); return; }
    const seq = ++qSeq.current;
    const t = setTimeout(async () => {
      setPhase("quoting"); setMsg("");
      try {
        const q = await lifiQuote({ fromChain: req.fromId, toChain: req.toId, fromToken: req.fromToken, toToken: req.toToken, fromAmount: req.fromRaw.toString(), fromAddress: req.fromAddr, toAddress: req.toAddr });
        if (seq !== qSeq.current) return;
        setQuote(q); setPhase("idle");
      } catch (e) { if (seq === qSeq.current) { setPhase("error"); setMsg(e instanceof Error ? e.message : "Quote failed. Try again."); } }
    }, 500);
    return () => clearTimeout(t);
  }, [req]);

  const run = async () => {
    if (!quote || !req || !evm) return;
    try {
      setMsg(""); setTx("");
      let hash: string;
      if (req.sol) {
        const sw = solWallets.find((w) => w.address === req.fromAddr);
        if (!sw) { setPhase("error"); setMsg("Solana wallet not ready yet. Try again in a moment."); return; }
        setPhase("sending");
        const vt = VersionedTransaction.deserialize(Buffer.from(quote.transactionRequest.data, "base64"));
        const result = await signAndSendTransaction({ transaction: vt.serialize(), wallet: sw, chain: "solana:mainnet" });
        hash = bs58.encode(result.signature);
      } else {
        const wallet = wallets.find((w) => w.address.toLowerCase() === evm.toLowerCase()) ?? wallets.find((w) => w.walletClientType === "privy");
        if (!wallet) { setPhase("error"); setMsg("Wallet not ready yet. Try again in a moment."); return; }
        hash = await execEvmRoute({ wallet, account: evm, chain: VIEM_CHAINS[req.fromKey], quote, fromToken: req.fromToken, native: req.native, fromRaw: req.fromRaw, onPhase: (p) => setPhase(p) });
      }
      setTx(hash);
      if (req.fromId !== req.toId) { setPhase("bridging"); await waitForRoute(hash, req.fromId, req.toId); }
      setPhase("done"); setQuote(null); void loadCash(); void loadToken();
      window.dispatchEvent(new Event("wraith:trade-recorded"));
    } catch (e) {
      setPhase("error");
      setMsg(friendlyError(e, req.sol ? "SOL" : chainOf(req.fromKey)?.native, req.sol ? "Solana" : VIEM_CHAINS[req.fromKey]?.name));
    }
  };

  if (!target) return null;
  const busy = phase === "approving" || phase === "sending" || phase === "bridging";
  const out = quote ? Number(formatUnits(BigInt(quote.estimate.toAmountMin), quote.action.toToken.decimals)) : null;
  const feeUsd = quote ? [...(quote.estimate.gasCosts ?? []), ...(quote.estimate.feeCosts ?? [])].reduce((s, c) => s + Number(c.amountUSD ?? 0), 0) : 0;
  const fx = (usd: number) => formatCurrency(usd * (rate ?? 1), cur);
  const needCash = mode === "buy" && cashLoaded && sources.length === 0;
  const money = (rate ?? 1);
  const explorer = tx ? `${req?.sol ? "https://solscan.io" : chainOf(req?.fromKey ?? chainKey)?.explorer}/tx/${tx}` : "";
  const buyTone = mode === "buy";

  let blocked = "";
  if (!authenticated) blocked = "";
  else if (!evm) blocked = "Setting up your EVM wallet…";
  else if (mode === "buy" && !needCash && !(amountUsd > 0)) blocked = `Enter a ${cur} amount greater than zero.`;
  else if (mode === "buy" && src && amountUsd > src.balance + 1e-9) blocked = `Only ${fx(src.balance)} ${src.symbol} on ${src.chainName}.`;
  else if (mode === "sell" && qty <= 0) blocked = `No ${symbol} in this wallet yet.`;

  return (
    <>
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {(["buy", "sell"] as const).map((tab) => (
          <button key={tab} type="button" onClick={() => { setMode(tab); setMsg(""); setPhase("idle"); }} style={{ flex: 1, border: `1px solid ${mode === tab ? (tab === "buy" ? "#267454" : "#89463e") : "var(--border)"}`, background: mode === tab ? (tab === "buy" ? "#14241d" : "#261917") : "var(--surface)", color: mode === tab ? (tab === "buy" ? "#55cf91" : "#e58d80") : "var(--text-muted)", borderRadius: 9, padding: "11px 8px", textTransform: "capitalize", fontWeight: 750, cursor: "pointer" }}>{tab}</button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", marginBottom: 12, border: "1px solid var(--border)", borderRadius: 10, color: "var(--text-muted)", fontSize: 11 }}>
        <Wallet size={14} color="var(--orange)" />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{evm ? short(evm) : "No EVM wallet"}</span>
        <span style={{ color: evm ? "#37d58a" : "#ffba55" }}>{evm ? "READY" : "SETUP"}</span>
      </div>

      {mode === "buy" ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", margin: "0 1px 10px", color: "var(--text-muted)", fontSize: 11 }}>
            <span>Cash value available</span>
            <strong style={{ color: "var(--text)" }}>{!cashLoaded && evm ? "Loading..." : fx(totalCash)}</strong>
          </div>
          {src && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 10, padding: "0 10px", height: 38, marginBottom: 10, background: "var(--surface)" }}>
              <ChainLogo chain={src.chain} size={16} />
              <select value={srcId} onChange={(e) => setSrcId(e.target.value)} disabled={busy} style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, color: "var(--text)", fontSize: 12, outline: 0, height: "100%", ...MONO }}>
                {sources.map((s) => <option key={s.id} value={s.id} style={{ background: "#14141a" }}>Pay from {s.chainName} · {s.symbol} · {fx(s.balance)}</option>)}
              </select>
            </div>
          )}
          <label style={{ display: "block", color: "var(--text-muted)", fontSize: 10, marginBottom: 6 }}>AMOUNT IN {cur}</label>
          <input aria-label={`Buy amount in ${cur}`} inputMode="decimal" value={amountCash} disabled={busy} onChange={(e) => { setAmountCash(e.target.value.replace(/[^0-9.]/g, "")); setMsg(""); }} style={{ width: "100%", height: 54, padding: "0 14px", color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, outlineColor: "var(--orange)", fontSize: 20, fontWeight: 700, ...MONO }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 8 }}>
            {PRESETS_USD.map((u) => {
              const v = u * money; const on = Math.abs(Number(amountCash) - v) < 0.005;
              return <button type="button" key={u} disabled={rate === null || busy} onClick={() => setAmountCash(v.toFixed(2))} style={{ padding: "8px 2px", border: `1px solid ${on ? "var(--orange)" : "var(--border)"}`, borderRadius: 8, color: on ? "var(--orange-hot)" : "var(--text-muted)", background: "var(--surface)", cursor: "pointer", fontSize: 11 }}>{rate !== null ? formatCurrency(v, cur) : "—"}</button>;
            })}
          </div>
        </>
      ) : (
        <>
          <div style={{ color: "var(--text-muted)", fontSize: 10, marginBottom: 6 }}>TOKEN BALANCE</div>
          <div style={{ padding: "15px 14px", marginBottom: 8, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", fontSize: 18, fontWeight: 700 }}>
            {bal ? qty.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "Loading..."}<span style={{ marginLeft: 7, color: "var(--text-muted)", fontSize: 11 }}>{symbol}</span>
            {bal && priceUsd > 0 && <small style={{ display: "block", marginTop: 8, color: "var(--text-muted)", fontSize: 12, fontWeight: 500 }}>{fx(qty * priceUsd)}</small>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {SELL_PRESETS.map((p) => <button type="button" key={p} onClick={() => setSellPct(p)} style={{ padding: "9px 4px", border: `1px solid ${sellPct === p ? "#a9564c" : "var(--border)"}`, borderRadius: 8, color: sellPct === p ? "#e58d80" : "var(--text-muted)", background: "var(--surface)", cursor: "pointer", fontSize: 11 }}>{p === 100 ? "Max" : `${p}%`}</button>)}
          </div>
        </>
      )}

      <div style={{ minHeight: 18, marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>
        {phase === "quoting" ? <span><LoaderCircle size={11} className="animate-spin" style={{ display: "inline", marginRight: 5 }} />Finding best route…</span>
          : out !== null ? <span>{mode === "buy" ? <>You get ≈ <b style={{ color: "var(--text)" }}>{out.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}</b></> : <>You get ≈ <b style={{ color: "var(--text)" }}>{fx(out)}</b> cash</>}{feeUsd > 0 && <> · fees ≈ {fx(feeUsd)}</>}{req && req.fromId !== req.toId && <> · cross-chain{quote?.estimate.executionDuration ? ` ~${Math.max(1, Math.round(quote.estimate.executionDuration / 60))}m` : ""}</>}</span>
          : null}
      </div>

      <button type="button" disabled={busy || (authenticated && !needCash && (!quote || !!blocked))}
        onClick={() => { if (!authenticated) login(); else if (needCash) window.dispatchEvent(new Event("wraith:open-deposit")); else void run(); }}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", minHeight: 48, marginTop: 8, border: 0, borderRadius: 10, color: "#fff", background: buyTone ? "#d96d3c" : "#a95047", fontSize: 14, fontWeight: 800, cursor: busy ? "wait" : "pointer", opacity: busy || (authenticated && !needCash && (!quote || !!blocked)) ? 0.68 : 1 }}>
        {busy ? <LoaderCircle size={16} className="animate-spin" /> : null}
        {!authenticated ? "Log in to trade" : needCash ? "Deposit cash to buy" : phase === "approving" ? "Approving…" : phase === "sending" ? "Confirm in wallet…" : phase === "bridging" ? "Bridging…" : `${buyTone ? "Buy" : "Sell"} ${symbol}`}
      </button>
      {(msg || blocked || needCash) && <p role="status" style={{ margin: "8px 2px 0", color: msg ? "#ff7a6b" : "var(--text-muted)", fontSize: 10, lineHeight: 1.5 }}>{msg || (needCash ? NO_CASH_NOTE : blocked)}</p>}
      {phase === "done" && <p style={{ margin: "8px 2px 0", color: "#3ddc84", fontSize: 11 }}>{mode === "buy" ? "Bought" : "Sold"} {symbol}. {explorer && <a href={explorer} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>View tx</a>}</p>}
      <p style={{ margin: "10px 2px 0", color: "var(--text-dim)", fontSize: 10, lineHeight: 1.55 }}>{FINE_PRINT}</p>
    </div>

    <PositionBlock
      symbol={symbol}
      amountText={qty > 0 ? qty.toLocaleString(undefined, { maximumFractionDigits: 4 }) : null}
      valueText={qty > 0 && priceUsd > 0 ? fx(qty * priceUsd) : null}
      onRefresh={() => { void loadToken(); void loadCash(); }}
    />
    </>
  );
}
