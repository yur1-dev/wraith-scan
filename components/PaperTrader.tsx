"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  VersionedTransaction,
  Keypair,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { MemeTrend } from "@/app/app/page";
import { useWraithTier } from "@/hooks/useWraithTier";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
  selectedMeme: MemeTrend | null;
  collapsed: boolean;
  onCollapseChange: (collapsed: boolean) => void;
}

interface Position {
  id: string;
  symbol: string;
  mint: string;
  entryMcap: number;
  entryPrice: number;
  tokenAmount: number;
  amountSol: number;
  slPct: number;
  tpX: number;
  trailPct: number;
  peakMcap: number;
  currentMcap: number;
  currentPnlPct: number;
  trailStopMcap: number;
  status: "watching" | "selling" | "sold" | "failed";
  exitReason?: "TP" | "SL" | "TRAIL" | "MANUAL";
  exitMcap?: number;
  exitPnlPct?: number;
  exitTxSig?: string;
  buyTxSig?: string;
  imageUrl?: string;
  ts: number;
}

interface TradeLog {
  id: string;
  symbol: string;
  mint: string;
  entryMcap: number;
  exitMcap?: number;
  amountSol: number;
  slPct: number;
  tpX: number;
  pnlPct?: number;
  exitReason?: string;
  buyTxSig?: string;
  exitTxSig?: string;
  status: "filled" | "failed" | "open";
  imageUrl?: string;
  ts: number;
}

interface ShareCardData {
  symbol: string;
  mint: string;
  entryMcap: number;
  currentMcap: number;
  exitMcap?: number;
  amountSol: number;
  currentPnlPct: number;
  exitPnlPct?: number;
  tpX: number;
  slPct: number;
  trailPct: number;
  exitReason?: string;
  imageUrl?: string;
  buyTxSig?: string;
  exitTxSig?: string;
  status: "watching" | "sold";
  ts: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const HW_KEY = "wraith_hot_wallet_v1";
const WINS_BOUGHT_KEY = "wraith_bought_keys";
const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};
const SOL_MINT = "So11111111111111111111111111111111111111112";

function getRpcEndpoint(): string {
  if (typeof window === "undefined") return "https://solana-rpc.publicnode.com";
  return `${window.location.origin}/api/rpc`;
}

const POLL_MS = 10000;
const DEFAULT_SL = -20;
const DEFAULT_TP = 2;
const DEFAULT_TRAIL = 15;

const C = {
  bg: "#050505",
  bgCard: "#0d0d0d",
  border: "#1a1a1a",
  orange: "#e8490f",
  green: "#00c47a",
  red: "#ff4444",
  blue: "#00b4d8",
  yellow: "#ffd700",
  purple: "#a855f7",
  primary: "#f0f0f0",
  muted: "#777",
  dim: "#444",
  label: "#555",
  amber: "#ffaa00",
};

// ─────────────────────────────────────────────────────────────────────────────
// WINS PANEL BOUGHT SYNC
// ─────────────────────────────────────────────────────────────────────────────
function markBoughtInWinsPanel(keyword: string) {
  if (typeof window === "undefined") return;
  try {
    const existing: string[] = JSON.parse(
      localStorage.getItem(WINS_BOUGHT_KEY) || "[]",
    );
    const kw = keyword.toLowerCase();
    if (!existing.includes(kw)) {
      existing.push(kw);
      localStorage.setItem(WINS_BOUGHT_KEY, JSON.stringify(existing));
    }
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// MONGODB PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPositions(): Promise<Position[]> {
  try {
    const res = await fetch("/api/positions");
    if (!res.ok) return [];
    const data = await res.json();
    return (data.positions ?? []).filter(
      (p: Position) => p.status === "watching",
    );
  } catch {
    return [];
  }
}

async function persistPositions(positions: Position[]): Promise<void> {
  try {
    await fetch("/api/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions }),
    });
  } catch {}
}

async function fetchTrades(): Promise<TradeLog[]> {
  try {
    const res = await fetch("/api/trades");
    if (!res.ok) return [];
    const data = await res.json();
    return data.trades ?? [];
  } catch {
    return [];
  }
}

async function appendTrade(trade: TradeLog): Promise<void> {
  try {
    await fetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trade }),
    });
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// CRYPTO HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey(
    "raw",
    enc.encode(password) as unknown as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: 200000,
      hash: "SHA-256",
    },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function encryptKeypair(
  secretKey: Uint8Array,
  password: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    secretKey.buffer as ArrayBuffer,
  );
  const packed = new Uint8Array(16 + 12 + ct.byteLength);
  packed.set(salt, 0);
  packed.set(iv, 16);
  packed.set(new Uint8Array(ct), 28);
  return btoa(String.fromCharCode(...packed));
}
async function decryptKeypair(
  encrypted: string,
  password: string,
): Promise<Uint8Array> {
  const packed = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const key = await deriveKey(password, packed.slice(0, 16));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.slice(16, 28).buffer as ArrayBuffer },
    key,
    packed.slice(28).buffer as ArrayBuffer,
  );
  return new Uint8Array(plain);
}
function saveHW(d: string) {
  if (typeof window !== "undefined") localStorage.setItem(HW_KEY, d);
}
function loadHW(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem(HW_KEY) : null;
}
function clearHW() {
  if (typeof window !== "undefined") localStorage.removeItem(HW_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────
// RECOVERY KEY STORAGE
// ─────────────────────────────────────────────────────────────────────────────
const RK_KEY = "wraith_recovery_v2";

async function encryptRecovery(
  phrase: string,
  secret: Uint8Array,
): Promise<string> {
  const salt = secret.slice(0, 16);
  const iv = secret.slice(16, 28);
  const key = await deriveKey(
    Array.from(secret.slice(0, 32))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
    salt,
  );
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    enc.encode(phrase).buffer as ArrayBuffer,
  );
  const packed = new Uint8Array(ct.byteLength);
  packed.set(new Uint8Array(ct));
  return btoa(String.fromCharCode(...packed));
}

async function decryptRecovery(
  encrypted: string,
  secret: Uint8Array,
): Promise<string | null> {
  try {
    const salt = secret.slice(0, 16);
    const iv = secret.slice(16, 28);
    const key = await deriveKey(
      Array.from(secret.slice(0, 32))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
      salt,
    );
    const ct = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
      key,
      ct.buffer as ArrayBuffer,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

async function saveRecovery(phrase: string, secret: Uint8Array) {
  if (typeof window === "undefined") return;
  const enc = await encryptRecovery(phrase, secret);
  localStorage.setItem(RK_KEY, enc);
}
function loadRawRecovery(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem(RK_KEY) : null;
}
function clearRecovery() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(RK_KEY);
    localStorage.removeItem("wraith_recovery_v1");
  }
}

function secretToPhrase(secret: Uint8Array): string {
  const hex = Array.from(secret)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.match(/.{8}/g)!.join("-");
}
function phraseToSecret(phrase: string): Uint8Array {
  const hex = phrase.replace(/-/g, "").trim().toLowerCase();
  if (hex.length !== 128) throw new Error("Invalid backup phrase length");
  const bytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (isNaN(byte)) throw new Error("Invalid hex");
    bytes[i] = byte;
  }
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────────
// POLL CONFIRM
// ─────────────────────────────────────────────────────────────────────────────
async function pollConfirm(
  conn: Connection,
  sig: string,
  timeoutMs = 120000,
  onStatus?: (msg: string) => void,
): Promise<boolean> {
  const start = Date.now();
  let attempts = 0;
  let consecutiveRpcErrors = 0;
  while (Date.now() - start < timeoutMs) {
    attempts++;
    try {
      const { value } = await conn.getSignatureStatuses([sig], {
        searchTransactionHistory: true,
      });
      consecutiveRpcErrors = 0;
      const s = value?.[0];
      if (s?.err) {
        throw new Error(`Tx rejected on-chain: ${JSON.stringify(s.err)}`);
      }
      if (
        s &&
        (s.confirmationStatus === "confirmed" ||
          s.confirmationStatus === "finalized")
      ) {
        return true;
      }
      const elapsed = Math.floor((Date.now() - start) / 1000);
      onStatus?.(`Waiting confirm… ${elapsed}s (attempt ${attempts})`);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("Tx rejected")) throw e;
      consecutiveRpcErrors++;
      if (consecutiveRpcErrors >= 3) {
        onStatus?.(
          `⚠ RPC unresponsive (${consecutiveRpcErrors} errors) — still retrying… ${msg.slice(0, 40)}`,
        );
      }
    }
    await sleep(3000);
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// JUPITER — BUY
// ─────────────────────────────────────────────────────────────────────────────
interface BuyResult {
  sig: string;
  rawTokenAmount: number;
}

async function jupiterBuy(
  conn: Connection,
  keypair: Keypair,
  outputMint: string,
  amountLamports: number,
  feeBps: number,
  onStatus?: (msg: string) => void,
): Promise<BuyResult> {
  onStatus?.("Fetching quote…");
  const quoteRes = await fetch(
    `/api/jupiter?endpoint=quote&inputMint=${SOL_MINT}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=500`,
  );
  if (!quoteRes.ok) throw new Error(`Quote failed: ${quoteRes.status}`);
  const quote = await quoteRes.json();
  if (quote.error) throw new Error(`Quote error: ${quote.error}`);

  const rawTokenAmount = Number(quote.outAmount ?? "0");

  onStatus?.("Building swap transaction…");
  const swapRes = await fetch("/api/jupiter?endpoint=swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 500000,
      feeBps,
    }),
  });
  if (!swapRes.ok) throw new Error(`Swap build failed: ${swapRes.status}`);
  const swapJson = await swapRes.json();
  if (swapJson.error) throw new Error(`Swap error: ${swapJson.error}`);
  const { swapTransaction } = swapJson;

  onStatus?.("Signing & sending transaction…");
  const tx = VersionedTransaction.deserialize(
    Buffer.from(swapTransaction, "base64"),
  );
  tx.sign([keypair]);

  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "processed",
    maxRetries: 5,
  });

  onStatus?.(`Tx sent: ${sig.slice(0, 10)}… confirming`);

  const confirmed = await pollConfirm(conn, sig, 120000, onStatus);
  if (!confirmed) {
    throw new Error(
      `Tx sent (${sig.slice(0, 8)}…) but not confirmed in 120s. Check Solscan: https://solscan.io/tx/${sig}`,
    );
  }
  return { sig, rawTokenAmount };
}

// ─────────────────────────────────────────────────────────────────────────────
// JUPITER — SELL
// ─────────────────────────────────────────────────────────────────────────────
async function jupiterSell(
  conn: Connection,
  keypair: Keypair,
  inputMint: string,
  tokenAmount: number,
  feeBps: number,
  onStatus?: (msg: string) => void,
): Promise<string> {
  onStatus?.("Fetching sell quote…");
  const quoteRes = await fetch(
    `/api/jupiter?endpoint=quote&inputMint=${inputMint}&outputMint=${SOL_MINT}&amount=${Math.floor(tokenAmount)}&slippageBps=700`,
  );
  if (!quoteRes.ok) throw new Error(`Sell quote failed: ${quoteRes.status}`);
  const quote = await quoteRes.json();
  if (quote.error) throw new Error(`Sell quote error: ${quote.error}`);

  onStatus?.("Building sell transaction…");
  const swapRes = await fetch("/api/jupiter?endpoint=swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 500000,
      feeBps,
    }),
  });
  if (!swapRes.ok) throw new Error(`Sell swap build failed: ${swapRes.status}`);
  const swapJson = await swapRes.json();
  if (swapJson.error) throw new Error(`Sell swap error: ${swapJson.error}`);
  const { swapTransaction } = swapJson;

  onStatus?.("Signing & sending sell transaction…");
  const tx = VersionedTransaction.deserialize(
    Buffer.from(swapTransaction, "base64"),
  );
  tx.sign([keypair]);

  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "processed",
    maxRetries: 5,
  });

  onStatus?.(`Sell tx sent: ${sig.slice(0, 10)}… confirming`);

  const confirmed = await pollConfirm(conn, sig, 120000, onStatus);
  if (!confirmed) {
    throw new Error(
      `Sell tx sent (${sig.slice(0, 8)}…) but not confirmed in 120s. Check: https://solscan.io/tx/${sig}`,
    );
  }
  return sig;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN BALANCE
// ─────────────────────────────────────────────────────────────────────────────
async function getRawTokenBalance(
  conn: Connection,
  walletPubkey: PublicKey,
  mint: string,
): Promise<number> {
  try {
    const accounts = await conn.getParsedTokenAccountsByOwner(walletPubkey, {
      mint: new PublicKey(mint),
    });
    if (!accounts.value.length) return 0;
    return (
      Number(accounts.value[0].account.data.parsed.info.tokenAmount.amount) ?? 0
    );
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEXSCREENER
// ─────────────────────────────────────────────────────────────────────────────
interface TokenData {
  price: number;
  mcap: number;
  imageUrl?: string;
  links?: { twitter?: string; telegram?: string; website?: string };
}

async function fetchTokenData(
  ca: string,
  signal?: AbortSignal,
): Promise<TokenData | null> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${ca}`,
      { signal },
    );
    const data = await res.json();
    const pair = data?.pairs?.[0];
    if (!pair) return null;
    return {
      price: parseFloat(pair.priceUsd || "0"),
      mcap: pair.fdv || pair.marketCap || 0,
      imageUrl: pair.info?.imageUrl,
      links: {
        twitter: pair.info?.socials?.find(
          (s: { type: string }) => s.type === "twitter",
        )?.url,
        telegram: pair.info?.socials?.find(
          (s: { type: string }) => s.type === "telegram",
        )?.url,
        website: pair.info?.websites?.[0]?.url,
      },
    };
  } catch {
    return null;
  }
}
async function fetchMcap(ca: string): Promise<number> {
  const d = await fetchTokenData(ca);
  return d?.mcap ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function fmtMcap(n: number) {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtPnl(pct: number) {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}
function fmtAgo(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO
// ─────────────────────────────────────────────────────────────────────────────
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (!_audioCtx || _audioCtx.state === "closed") {
      _audioCtx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      )();
    }
    return _audioCtx;
  } catch {
    return null;
  }
}
function playAlert(type: "sell_tp" | "sell_sl" | "sell_trail") {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === "sell_tp") {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.2);
    } else if (type === "sell_sl") {
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.setValueAtTime(180, ctx.currentTime + 0.15);
    } else {
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.setValueAtTime(520, ctx.currentTime + 0.12);
    }
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN AVATAR
// ─────────────────────────────────────────────────────────────────────────────
function TokenAvatar({
  imageUrl,
  symbol,
  links,
  size = 34,
}: {
  imageUrl?: string;
  symbol: string;
  links?: {
    twitter?: string;
    telegram?: string;
    website?: string;
    dex?: string;
    pump?: string;
  };
  size?: number;
}) {
  const [err, setErr] = useState(false);
  const [hover, setHover] = useState(false);
  const letter = (symbol || "?").charAt(0).toUpperCase();
  const palette = [C.orange, C.purple, C.blue, C.green, C.yellow];
  const bg = palette[letter.charCodeAt(0) % palette.length];
  const hasLinks = links && Object.values(links).some(Boolean);
  return (
    <div
      style={{ position: "relative", flexShrink: 0 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {imageUrl && !err ? (
        <img
          src={imageUrl}
          alt={symbol}
          width={size}
          height={size}
          onError={() => setErr(true)}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            objectFit: "cover",
            border: `1px solid ${hover && hasLinks ? C.orange + "66" : C.border}`,
            cursor: hasLinks ? "pointer" : "default",
            transition: "border-color 0.15s",
          }}
        />
      ) : (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: `${bg}1a`,
            border: `1px solid ${bg}44`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: bg,
            fontSize: size * 0.38,
            fontWeight: 900,
            cursor: hasLinks ? "pointer" : "default",
            ...MONO,
          }}
        >
          {letter}
        </div>
      )}
      {hover && hasLinks && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 5px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#0a0a0a",
            border: `1px solid ${C.border}`,
            borderRadius: 5,
            padding: "5px 6px",
            display: "flex",
            gap: 4,
            zIndex: 200,
            whiteSpace: "nowrap" as const,
            boxShadow: "0 4px 20px #00000099",
          }}
        >
          {links?.twitter && (
            <a
              href={links.twitter}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none" }}
            >
              <span
                style={{
                  fontSize: 8,
                  color: "#1d9bf0",
                  border: "1px solid #1d9bf022",
                  padding: "2px 5px",
                  borderRadius: 2,
                  cursor: "pointer",
                  ...MONO,
                }}
              >
                𝕏
              </span>
            </a>
          )}
          {links?.telegram && (
            <a
              href={links.telegram}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none" }}
            >
              <span
                style={{
                  fontSize: 8,
                  color: C.blue,
                  border: `1px solid ${C.blue}22`,
                  padding: "2px 5px",
                  borderRadius: 2,
                  cursor: "pointer",
                  ...MONO,
                }}
              >
                TG
              </span>
            </a>
          )}
          {links?.website && (
            <a
              href={links.website}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none" }}
            >
              <span
                style={{
                  fontSize: 8,
                  color: C.muted,
                  border: `1px solid ${C.border}`,
                  padding: "2px 5px",
                  borderRadius: 2,
                  cursor: "pointer",
                  ...MONO,
                }}
              >
                WEB
              </span>
            </a>
          )}
          {links?.dex && (
            <a
              href={links.dex}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none" }}
            >
              <span
                style={{
                  fontSize: 8,
                  color: C.blue,
                  border: `1px solid ${C.blue}22`,
                  padding: "2px 5px",
                  borderRadius: 2,
                  cursor: "pointer",
                  ...MONO,
                }}
              >
                DEX
              </span>
            </a>
          )}
          {links?.pump && (
            <a
              href={links.pump}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none" }}
            >
              <span
                style={{
                  fontSize: 8,
                  color: C.purple,
                  border: `1px solid ${C.purple}22`,
                  padding: "2px 5px",
                  borderRadius: 2,
                  cursor: "pointer",
                  ...MONO,
                }}
              >
                PUMP
              </span>
            </a>
          )}
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "4px solid transparent",
              borderRight: "4px solid transparent",
              borderTop: `4px solid ${C.border}`,
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NO-AUTOFILL PASSWORD INPUT
// ─────────────────────────────────────────────────────────────────────────────
function NoFillPasswordInput({
  value,
  onChange,
  onKeyDown,
  placeholder,
  inputId,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  inputId: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        id={inputId}
        name={`wraith_nofill_${inputId}`}
        type="text"
        value={value}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-lpignore="true"
        data-form-type="other"
        data-1p-ignore="true"
        aria-autocomplete="none"
        role="presentation"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={
          {
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            cursor: "text",
            zIndex: 2,
            color: "transparent",
            background: "transparent",
            caretColor: "transparent",
            WebkitTextFillColor: "transparent",
          } as React.CSSProperties
        }
      />
      <div
        style={{
          background: C.bgCard,
          border: `1px solid ${focused ? C.orange + "88" : C.border}`,
          borderRadius: 3,
          padding: "0 8px",
          height: 28,
          display: "flex",
          alignItems: "center",
          gap: 0,
          pointerEvents: "none",
          userSelect: "none",
          boxShadow: focused ? `0 0 0 1px ${C.orange}22` : "none",
          transition: "border-color 0.15s, box-shadow 0.15s",
          overflow: "hidden",
        }}
      >
        {value ? (
          <div
            style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {Array.from({ length: Math.min(value.length, 32) }).map(
                (_, i) => (
                  <div
                    key={i}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: C.primary,
                      flexShrink: 0,
                    }}
                  />
                ),
              )}
            </div>
            {focused && (
              <div
                style={{
                  width: 1.5,
                  height: 13,
                  background: C.orange,
                  flexShrink: 0,
                  animation: "pwcursor 1s step-end infinite",
                }}
              />
            )}
          </div>
        ) : (
          <span style={{ color: C.label, fontSize: 10, ...MONO, opacity: 0.6 }}>
            {placeholder}
          </span>
        )}
      </div>
      <style>{`@keyframes pwcursor { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARE CARD MODAL
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// SHARE CARD MODAL
// Drop your images in:
//   /public/share-bg/profit/profit-1.jpg … profit-5.jpg
//   /public/share-bg/loss/loss-1.jpg  … loss-5.jpg
// ─────────────────────────────────────────────────────────────────────────────

// Paste this entire block in place of the existing ShareModal function in PaperTrader.tsx

const PROFIT_BG_COUNT = 5;
const LOSS_BG_COUNT = 5;

function pickBg(isWin: boolean): string {
  const folder = isWin ? "profit" : "loss";
  const count = isWin ? PROFIT_BG_COUNT : LOSS_BG_COUNT;
  const idx = Math.floor(Math.random() * count) + 1; // 1..5
  return `/share-bg/${folder}/${folder}-${idx}.png`;
}

function ShareModal({
  data,
  onClose,
}: {
  data: ShareCardData;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const [bgErr, setBgErr] = useState(false);

  const pnl =
    data.status === "sold"
      ? (data.exitPnlPct ?? data.currentPnlPct)
      : data.currentPnlPct;
  const exitMcap = data.status === "sold" ? data.exitMcap : data.currentMcap;
  const isWin = pnl >= 0;
  const pnlColor = isWin ? "#00c47a" : "#ff4444";
  const solPnl = data.amountSol * (pnl / 100);

  // Pick a random background image once per modal open
  const [bgUrl] = useState(() => pickBg(isWin));

  const exitReasonColor =
    data.exitReason === "TP"
      ? "#00c47a"
      : data.exitReason === "SL"
        ? "#ff4444"
        : data.exitReason === "TRAIL"
          ? "#ffaa00"
          : "#777";

  const letter = (data.symbol || "?").charAt(0).toUpperCase();
  const palette = [C.orange, C.purple, C.blue, C.green, C.yellow];
  const avatarBg = palette[letter.charCodeAt(0) % palette.length];

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
      });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `wraith-${data.symbol}-${pnl >= 0 ? "win" : "loss"}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch (e) {
      console.error("Share card export failed", e);
    }
    setDownloading(false);
  };

  const handleCopy = async () => {
    if (!cardRef.current) return;
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
      });
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {}
      }, "image/png");
    } catch {}
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.88)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        {/* ── THE CARD ── */}
        <div
          ref={cardRef}
          style={{
            width: 480,
            height: 270,
            background: "transparent",
            border: `1px solid ${isWin ? "#00c47a33" : "#ff444433"}`,
            borderRadius: 12,
            padding: "18px 20px 16px",
            position: "relative",
            overflow: "hidden",
            boxShadow: `0 0 60px ${isWin ? "#00c47a18" : "#ff444418"}, 0 20px 60px #00000099`,
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          {/* ── FULL BACKGROUND IMAGE ── */}
          {!bgErr && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                zIndex: 0,
              }}
            >
              <img
                src={bgUrl}
                alt=""
                onError={() => setBgErr(true)}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "center",
                  display: "block",
                }}
              />
              {/* dark overlay so text stays readable, lighter than before */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(135deg, rgba(6,6,6,0.82) 0%, rgba(6,6,6,0.55) 50%, rgba(6,6,6,0.3) 100%)",
                }}
              />
            </div>
          )}

          {/* glow blob — above bg, below content */}
          <div
            style={{
              position: "absolute",
              top: -40,
              right: -40,
              width: 140,
              height: 140,
              borderRadius: "50%",
              background: isWin ? "#00c47a0d" : "#ff44440d",
              filter: "blur(30px)",
              pointerEvents: "none",
              zIndex: 1,
            }}
          />

          {/* ── CONTENT (z above background) ── */}
          <div
            style={{
              position: "relative",
              zIndex: 2,
              padding: "22px 24px",
              height: "100%",
              boxSizing: "border-box" as const,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              width: "55%",
            }}
          >
            {/* TOP: avatar + symbol */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {data.imageUrl && !imgErr ? (
                <img
                  src={data.imageUrl}
                  alt={data.symbol}
                  onError={() => setImgErr(true)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: `2px solid ${pnlColor}55`,
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: `${avatarBg}22`,
                    border: `2px solid ${avatarBg}55`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: avatarBg,
                    fontSize: 14,
                    fontWeight: 900,
                    flexShrink: 0,
                  }}
                >
                  {letter}
                </div>
              )}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      color: "#fff",
                      fontSize: 15,
                      fontWeight: 900,
                      letterSpacing: "0.02em",
                    }}
                  >
                    ${data.symbol}
                  </span>
                  {data.status === "watching" && (
                    <span
                      style={{
                        fontSize: 7,
                        padding: "2px 6px",
                        borderRadius: 2,
                        color: "#00c47a",
                        border: "1px solid #00c47a55",
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        background: "#00c47a11",
                      }}
                    >
                      LIVE
                    </span>
                  )}
                  {data.exitReason && (
                    <span
                      style={{
                        fontSize: 7,
                        padding: "2px 6px",
                        borderRadius: 2,
                        color: exitReasonColor,
                        border: `1px solid ${exitReasonColor}55`,
                        fontWeight: 700,
                        background: `${exitReasonColor}11`,
                      }}
                    >
                      {data.exitReason}
                    </span>
                  )}
                </div>
                <div style={{ color: "#ffffff55", fontSize: 8, marginTop: 2 }}>
                  {data.amountSol} SOL · {fmtAgo(data.ts)}
                </div>
              </div>
            </div>

            {/* MIDDLE: big PnL */}
            <div>
              <div
                style={{
                  fontSize: 46,
                  fontWeight: 900,
                  color: pnlColor,
                  lineHeight: 1,
                  letterSpacing: "-0.03em",
                  textShadow: `0 0 30px ${pnlColor}77`,
                }}
              >
                {fmtPnl(pnl)}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: `${pnlColor}aa`,
                  marginTop: 5,
                  fontWeight: 600,
                }}
              >
                {isWin ? "+" : ""}
                {solPnl.toFixed(3)} SOL
              </div>
            </div>

            {/* BOTTOM: clean stat rows + branding */}
            <div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                  marginBottom: 12,
                }}
              >
                {[
                  { label: "Entry", value: fmtMcap(data.entryMcap) },
                  {
                    label: data.status === "sold" ? "Exit" : "Current",
                    value: fmtMcap(exitMcap ?? 0),
                    highlight: true,
                  },
                  {
                    label: "Multi",
                    value:
                      exitMcap && data.entryMcap
                        ? `${(exitMcap / data.entryMcap).toFixed(2)}×`
                        : "—",
                  },
                  { label: "SL / TP", value: `${data.slPct}% / ${data.tpX}×` },
                ].map((row) => (
                  <div
                    key={row.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ color: "#ffffff55", fontSize: 9 }}>
                      {row.label}
                    </span>
                    <span
                      style={{
                        color: row.highlight ? pnlColor : "#ffffffcc",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    color: "#e8490f",
                    fontSize: 9,
                    fontWeight: 900,
                    letterSpacing: "0.2em",
                  }}
                >
                  ⚡ WRAITH
                </span>
                <span style={{ color: "#ffffff33", fontSize: 7 }}>
                  paper trader
                </span>
              </div>
            </div>
          </div>
          {/* end z:2 content wrapper */}
        </div>

        {/* action buttons */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{
              background: downloading ? "#0d0d0d" : C.orange,
              border: "none",
              color: "#fff",
              fontSize: 9,
              fontWeight: 700,
              padding: "7px 14px",
              borderRadius: 4,
              cursor: downloading ? "not-allowed" : "pointer",
              letterSpacing: "0.1em",
              ...MONO,
            }}
          >
            {downloading ? "RENDERING…" : "↓ DOWNLOAD PNG"}
          </button>
          <button
            onClick={handleCopy}
            style={{
              background: copied ? "#001a0a" : "#111",
              border: `1px solid ${copied ? C.green + "55" : C.border}`,
              color: copied ? C.green : C.muted,
              fontSize: 9,
              fontWeight: 700,
              padding: "7px 14px",
              borderRadius: 4,
              cursor: "pointer",
              letterSpacing: "0.1em",
              ...MONO,
            }}
          >
            {copied ? "✓ COPIED" : "⧉ COPY IMG"}
          </button>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: `1px solid ${C.border}`,
              color: C.dim,
              fontSize: 9,
              padding: "7px 10px",
              borderRadius: 4,
              cursor: "pointer",
              ...MONO,
            }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOT WALLET SETUP
// ─────────────────────────────────────────────────────────────────────────────
function HotWalletSetup({
  onUnlocked,
}: {
  onUnlocked: (kp: Keypair, pub: string) => void;
}) {
  const [mode, setMode] = useState<
    | "menu"
    | "create"
    | "backup"
    | "unlock"
    | "import"
    | "recover"
    | "reencrypt"
    | "confirmRecover"
  >("menu");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [importKey, setImportKey] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [backupPhrase, setBackupPhrase] = useState("");
  const [pendingKp, setPendingKp] = useState<Keypair | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const hasWallet = !!loadHW();

  const reset = (m: typeof mode) => {
    setMode(m);
    setPw("");
    setPw2("");
    setImportKey("");
    setRecoveryInput("");
    setErr("");
    setBusy(false);
    if (m !== "backup" && m !== "reencrypt" && m !== "confirmRecover") {
      setBackupPhrase("");
      setPendingKp(null);
    }
  };

  const doGenerate = async () => {
    if (pw.length < 6) {
      setErr("Min 6 chars");
      return;
    }
    if (pw !== pw2) {
      setErr("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const kp = Keypair.generate();
      setBackupPhrase(secretToPhrase(kp.secretKey));
      setPendingKp(kp);
      setMode("backup");
    } catch {
      setErr("Failed to generate wallet");
    }
    setBusy(false);
  };

  const doConfirmBackup = async () => {
    if (!pendingKp) return;
    setBusy(true);
    try {
      saveHW(await encryptKeypair(pendingKp.secretKey, pw));
      await saveRecovery(
        secretToPhrase(pendingKp.secretKey),
        pendingKp.secretKey,
      );
      onUnlocked(pendingKp, pendingKp.publicKey.toString());
    } catch {
      setErr("Encryption failed");
    }
    setBusy(false);
  };

  const doUnlock = async () => {
    if (!pw) {
      setErr("Enter password");
      return;
    }
    setBusy(true);
    try {
      const enc = loadHW();
      if (!enc) {
        setErr("No wallet found");
        setBusy(false);
        return;
      }
      const kp = Keypair.fromSecretKey(await decryptKeypair(enc, pw));
      onUnlocked(kp, kp.publicKey.toString());
    } catch {
      setErr("Wrong password");
    }
    setBusy(false);
  };

  const doImport = async () => {
    if (pw.length < 6) {
      setErr("Min 6 chars");
      return;
    }
    if (pw !== pw2) {
      setErr("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const t = importKey.trim();
      const secret = t.startsWith("[")
        ? Uint8Array.from(JSON.parse(t))
        : (await import("bs58")).default.decode(t);
      const kp = Keypair.fromSecretKey(secret);
      saveHW(await encryptKeypair(kp.secretKey, pw));
      await saveRecovery(secretToPhrase(kp.secretKey), kp.secretKey);
      onUnlocked(kp, kp.publicKey.toString());
    } catch {
      setErr("Invalid key format");
    }
    setBusy(false);
  };

  const doRecover = async () => {
    if (!recoveryInput.trim()) {
      setErr("Enter your backup phrase");
      return;
    }
    setBusy(true);
    try {
      const secret = phraseToSecret(recoveryInput.trim());
      const kp = Keypair.fromSecretKey(secret);
      setPendingKp(kp);
      setMode("confirmRecover");
      setErr("");
    } catch {
      setErr("Invalid backup phrase — check for typos");
    }
    setBusy(false);
  };

  const doReencrypt = async () => {
    if (pw.length < 6) {
      setErr("Min 6 chars");
      return;
    }
    if (pw !== pw2) {
      setErr("Passwords don't match");
      return;
    }
    if (!pendingKp) return;
    setBusy(true);
    try {
      saveHW(await encryptKeypair(pendingKp.secretKey, pw));
      await saveRecovery(
        secretToPhrase(pendingKp.secretKey),
        pendingKp.secretKey,
      );
      onUnlocked(pendingKp, pendingKp.publicKey.toString());
    } catch {
      setErr("Failed");
    }
    setBusy(false);
  };

  const Btn = ({
    label,
    onClick,
    primary = false,
    danger = false,
    disabled = false,
  }: {
    label: string;
    onClick: () => void;
    primary?: boolean;
    danger?: boolean;
    disabled?: boolean;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: primary ? C.orange : danger ? "#1a0000" : "transparent",
        border: primary
          ? "none"
          : danger
            ? `1px solid ${C.red}44`
            : `1px solid ${C.border}`,
        color: primary ? "#fff" : danger ? C.red : C.muted,
        fontSize: primary ? 10 : 9,
        fontWeight: primary ? 700 : 400,
        padding: "7px 10px",
        borderRadius: 3,
        cursor: "pointer",
        ...MONO,
        flex: 1,
      }}
    >
      {busy && primary ? "···" : label}
    </button>
  );

  if (mode === "menu")
    return (
      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ color: C.dim, fontSize: 8, ...MONO, lineHeight: 1.6 }}>
          One-click buys · auto-sell on TP/SL/trail · no wallet popups.
          <br />
          <span style={{ color: C.red + "99" }}>
            Only fund with amounts you can afford to lose.
          </span>
        </div>
        {hasWallet ? (
          <Btn
            label="🔓 UNLOCK HOT WALLET"
            onClick={() => reset("unlock")}
            primary
          />
        ) : (
          <>
            <Btn
              label="⚡ GENERATE NEW WALLET"
              onClick={() => reset("create")}
              primary
            />
            <Btn label="IMPORT EXISTING KEY" onClick={() => reset("import")} />
          </>
        )}
        {hasWallet && (
          <button
            onClick={() => reset("recover")}
            style={{
              background: "none",
              border: "none",
              color: C.dim + "88",
              fontSize: 7,
              cursor: "pointer",
              ...MONO,
              textDecoration: "underline",
              textAlign: "left" as const,
              paddingLeft: 0,
            }}
          >
            forgot password? recover with backup phrase
          </button>
        )}
      </div>
    );

  if (mode === "backup")
    return (
      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            color: C.amber,
            fontSize: 9,
            fontWeight: 700,
            ...MONO,
            letterSpacing: "0.1em",
          }}
        >
          ⚠ WRITE DOWN YOUR BACKUP PHRASE
        </div>
        <div style={{ color: C.dim, fontSize: 8, ...MONO, lineHeight: 1.6 }}>
          This is the only way to recover your wallet. Store offline — never
          screenshot or share it.
        </div>
        <div
          style={{
            background: "#0a0600",
            border: `1px solid ${C.amber}33`,
            borderRadius: 5,
            padding: "10px 12px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "4px 12px",
            }}
          >
            {backupPhrase.split("-").map((chunk, i) => (
              <div
                key={i}
                style={{ display: "flex", gap: 5, alignItems: "center" }}
              >
                <span
                  style={{
                    color: C.label,
                    fontSize: 7,
                    ...MONO,
                    width: 10,
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    color: C.amber,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    ...MONO,
                  }}
                >
                  {chunk}
                </span>
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(backupPhrase);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          style={{
            background: "transparent",
            border: `1px solid ${copied ? C.green + "55" : C.border}`,
            color: copied ? C.green : C.dim,
            fontSize: 8,
            padding: "4px 0",
            borderRadius: 3,
            cursor: "pointer",
            ...MONO,
          }}
        >
          {copied ? "✓ COPIED" : "COPY TO CLIPBOARD"}
        </button>
        {err && <div style={{ color: C.red, fontSize: 8, ...MONO }}>{err}</div>}
        <div style={{ display: "flex", gap: 4 }}>
          <Btn
            label="✓ I'VE SAVED IT — CONTINUE"
            onClick={doConfirmBackup}
            primary
            disabled={busy}
          />
          <Btn label="←" onClick={() => reset("create")} />
        </div>
      </div>
    );

  if (mode === "recover")
    return (
      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ color: C.amber, fontSize: 9, fontWeight: 700, ...MONO }}>
          RECOVER WALLET
        </div>
        <div style={{ color: C.dim, fontSize: 8, ...MONO, lineHeight: 1.5 }}>
          Enter your backup phrase (8 groups of 8 hex characters, dashes
          optional)
        </div>
        <textarea
          placeholder="xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx"
          value={recoveryInput}
          onChange={(e) => {
            setRecoveryInput(e.target.value);
            setErr("");
          }}
          autoComplete="off"
          spellCheck={false}
          style={{
            background: C.bgCard,
            border: `1px solid ${C.border}`,
            color: C.primary,
            fontSize: 9,
            padding: "8px",
            borderRadius: 3,
            outline: "none",
            width: "100%",
            boxSizing: "border-box" as const,
            resize: "none" as const,
            height: 60,
            ...MONO,
          }}
        />
        {err && <div style={{ color: C.red, fontSize: 8, ...MONO }}>{err}</div>}
        <div style={{ display: "flex", gap: 4 }}>
          <Btn
            label="VERIFY PHRASE"
            onClick={doRecover}
            primary
            disabled={busy}
          />
          <Btn label="←" onClick={() => reset("menu")} />
        </div>
      </div>
    );

  if (mode === "confirmRecover")
    return (
      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ color: C.green, fontSize: 9, fontWeight: 700, ...MONO }}>
          ✓ PHRASE VALID
        </div>
        <div style={{ color: C.dim, fontSize: 8, ...MONO, lineHeight: 1.6 }}>
          This phrase maps to:
        </div>
        <div
          style={{
            background: C.bgCard,
            border: `1px solid ${C.green}33`,
            borderRadius: 3,
            padding: "7px 9px",
          }}
        >
          <div
            style={{
              color: C.green,
              fontSize: 9,
              fontWeight: 700,
              ...MONO,
              wordBreak: "break-all" as const,
            }}
          >
            {pendingKp?.publicKey.toString()}
          </div>
        </div>
        <div style={{ color: C.amber, fontSize: 8, ...MONO, lineHeight: 1.5 }}>
          ⚠ This will overwrite your currently stored wallet. Make sure this is
          the correct address.
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <Btn
            label="YES — SET NEW PASSWORD"
            onClick={() => setMode("reencrypt")}
            primary
          />
          <Btn label="← CANCEL" onClick={() => reset("menu")} />
        </div>
      </div>
    );

  if (mode === "reencrypt")
    return (
      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ color: C.green, fontSize: 9, fontWeight: 700, ...MONO }}>
          SET NEW PASSWORD
        </div>
        <div style={{ color: C.dim, fontSize: 8, ...MONO }}>
          {pendingKp?.publicKey.toString().slice(0, 20)}…
        </div>
        <NoFillPasswordInput
          inputId="reenc-pw1"
          placeholder="New password (min 6 chars)"
          value={pw}
          onChange={(v) => {
            setPw(v);
            setErr("");
          }}
        />
        <NoFillPasswordInput
          inputId="reenc-pw2"
          placeholder="Confirm new password"
          value={pw2}
          onChange={(v) => {
            setPw2(v);
            setErr("");
          }}
          onKeyDown={(e) => e.key === "Enter" && doReencrypt()}
        />
        {err && <div style={{ color: C.red, fontSize: 8, ...MONO }}>{err}</div>}
        <div style={{ display: "flex", gap: 4 }}>
          <Btn
            label="SET PASSWORD & UNLOCK"
            onClick={doReencrypt}
            primary
            disabled={busy}
          />
          <Btn label="←" onClick={() => reset("recover")} />
        </div>
      </div>
    );

  return (
    <div
      style={{
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "-9999px",
          top: "-9999px",
          width: 0,
          height: 0,
          overflow: "hidden",
        }}
        aria-hidden="true"
      >
        <input type="text" tabIndex={-1} />
        <input type="password" tabIndex={-1} />
      </div>
      {mode === "import" && (
        <textarea
          placeholder="Private key — base58 string or JSON array [1,2,3…]"
          value={importKey}
          onChange={(e) => {
            setImportKey(e.target.value);
            setErr("");
          }}
          autoComplete="off"
          spellCheck={false}
          style={{
            background: C.bgCard,
            border: `1px solid ${C.border}`,
            color: C.primary,
            fontSize: 9,
            padding: "8px",
            borderRadius: 3,
            outline: "none",
            width: "100%",
            boxSizing: "border-box" as const,
            resize: "none" as const,
            height: 52,
            ...MONO,
          }}
        />
      )}
      <NoFillPasswordInput
        inputId={mode === "unlock" ? "hw-unlock" : "hw-create"}
        placeholder={mode === "unlock" ? "Password" : "Password (min 6 chars)"}
        value={pw}
        onChange={(v) => {
          setPw(v);
          setErr("");
        }}
        onKeyDown={(e) => e.key === "Enter" && mode === "unlock" && doUnlock()}
      />
      {mode !== "unlock" && (
        <NoFillPasswordInput
          inputId="hw-confirm"
          placeholder="Confirm password"
          value={pw2}
          onChange={(v) => {
            setPw2(v);
            setErr("");
          }}
          onKeyDown={(e) =>
            e.key === "Enter" && (mode === "create" ? doGenerate() : doImport())
          }
        />
      )}
      {err && <div style={{ color: C.red, fontSize: 8, ...MONO }}>{err}</div>}
      <div style={{ display: "flex", gap: 4 }}>
        <Btn
          label={
            mode === "unlock"
              ? "UNLOCK"
              : mode === "create"
                ? "GENERATE WALLET"
                : "IMPORT & ENCRYPT"
          }
          onClick={
            mode === "unlock"
              ? doUnlock
              : mode === "create"
                ? doGenerate
                : doImport
          }
          primary
          disabled={busy}
        />
        <Btn label="←" onClick={() => reset("menu")} />
      </div>
      {mode === "unlock" && loadRawRecovery() && (
        <button
          onClick={async () => {
            const enc = loadHW();
            if (!enc || !pw) return;
            try {
              const kp = Keypair.fromSecretKey(await decryptKeypair(enc, pw));
              const raw = loadRawRecovery();
              if (!raw) return;
              const phrase = await decryptRecovery(raw, kp.secretKey);
              if (phrase) {
                setBackupPhrase(phrase);
                setMode("backup");
              } else setErr("Unlock first to view backup phrase");
            } catch {
              setErr("Unlock first to view backup phrase");
            }
          }}
          style={{
            background: "none",
            border: "none",
            color: C.dim + "77",
            fontSize: 7,
            cursor: "pointer",
            ...MONO,
            textDecoration: "underline",
            textAlign: "left" as const,
            paddingLeft: 0,
          }}
        >
          view backup phrase
        </button>
      )}
      {mode === "unlock" && (
        <button
          onClick={() => {
            clearHW();
            clearRecovery();
            reset("menu");
          }}
          style={{
            background: "none",
            border: "none",
            color: C.red + "44",
            fontSize: 7,
            cursor: "pointer",
            ...MONO,
            textDecoration: "underline",
            textAlign: "left" as const,
            paddingLeft: 0,
          }}
        >
          delete wallet data
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITION CARD
// ─────────────────────────────────────────────────────────────────────────────
function PositionCard({
  pos,
  onManualSell,
  onShare,
  flash,
}: {
  pos: Position;
  onManualSell: (id: string) => void;
  onShare: (pos: Position) => void;
  flash: boolean;
}) {
  const pnl = pos.currentPnlPct;
  const pnlColor = pnl >= 0 ? C.green : C.red;
  const progressToTP = Math.min(
    (pos.currentMcap / (pos.entryMcap * pos.tpX)) * 100,
    100,
  );
  const trailFromPeak =
    pos.peakMcap > pos.entryMcap
      ? (pos.currentMcap / pos.peakMcap - 1) * 100
      : null;
  return (
    <div
      style={{
        padding: "8px 10px",
        borderBottom: `1px solid ${C.border}`,
        background: flash ? "#1a0500" : "transparent",
        transition: "background 0.4s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 5,
        }}
      >
        <TokenAvatar
          imageUrl={pos.imageUrl}
          symbol={pos.symbol}
          size={28}
          links={{
            dex: `https://dexscreener.com/solana/${pos.mint}`,
            pump: `https://pump.fun/${pos.mint}`,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                color: C.primary,
                fontSize: 11,
                fontWeight: 900,
                ...MONO,
              }}
            >
              ${pos.symbol}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: pnlColor,
                ...MONO,
              }}
            >
              {fmtPnl(pnl)}
            </span>
            {pos.status === "selling" && (
              <span
                style={{
                  fontSize: 7,
                  color: C.amber,
                  border: `1px solid ${C.amber}33`,
                  padding: "1px 4px",
                  borderRadius: 2,
                  ...MONO,
                  animation: "pulse 1s infinite",
                }}
              >
                SELLING…
              </span>
            )}
            {pos.status === "watching" && (
              <span
                style={{
                  fontSize: 7,
                  color: C.green,
                  border: `1px solid ${C.green}22`,
                  padding: "1px 4px",
                  borderRadius: 2,
                  ...MONO,
                }}
              >
                ● LIVE
              </span>
            )}
          </div>
          <div style={{ color: C.muted, fontSize: 7, ...MONO }}>
            {pos.amountSol} SOL · entry {fmtMcap(pos.entryMcap)} → now{" "}
            {fmtMcap(pos.currentMcap)}
          </div>
          {trailFromPeak !== null && pos.peakMcap > pos.entryMcap && (
            <div style={{ color: C.amber, fontSize: 6, ...MONO }}>
              peak {fmtMcap(pos.peakMcap)} · trail {trailFromPeak.toFixed(1)}%
              from peak
            </div>
          )}
        </div>
        {/* action buttons stacked */}
        {pos.status === "watching" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => onShare(pos)}
              style={{
                background: "transparent",
                border: `1px solid ${C.orange}44`,
                color: C.orange,
                fontSize: 7,
                padding: "3px 7px",
                borderRadius: 2,
                cursor: "pointer",
                ...MONO,
              }}
            >
              ↗ SHARE
            </button>
            <button
              onClick={() => onManualSell(pos.id)}
              style={{
                background: "transparent",
                border: `1px solid ${C.red}44`,
                color: C.red,
                fontSize: 7,
                padding: "3px 7px",
                borderRadius: 2,
                cursor: "pointer",
                ...MONO,
              }}
            >
              SELL NOW
            </button>
          </div>
        )}
      </div>
      <div style={{ marginBottom: 5 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 2,
          }}
        >
          <span style={{ fontSize: 6, color: C.label, ...MONO }}>
            TO {pos.tpX}× TP
          </span>
          <span
            style={{
              fontSize: 6,
              color: progressToTP >= 100 ? C.green : C.muted,
              ...MONO,
            }}
          >
            {progressToTP.toFixed(0)}%
          </span>
        </div>
        <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
          <div
            style={{
              height: "100%",
              width: `${progressToTP}%`,
              background: pnl > 0 ? C.green : C.red,
              borderRadius: 2,
              transition: "width 0.5s",
            }}
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {[
          {
            label: `SL ${pos.slPct}%`,
            value: fmtMcap(pos.entryMcap * (1 + pos.slPct / 100)),
            color: C.red,
          },
          {
            label: `TRAIL -${pos.trailPct}%`,
            value: fmtMcap(pos.trailStopMcap),
            color: C.amber,
          },
          {
            label: `TP ${pos.tpX}×`,
            value: fmtMcap(pos.entryMcap * pos.tpX),
            color: C.green,
          },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              flex: 1,
              background: C.bgCard,
              border: `1px solid ${C.border}`,
              borderRadius: 3,
              padding: "3px 5px",
              textAlign: "center" as const,
            }}
          >
            <div
              style={{
                color: C.label,
                fontSize: 5,
                ...MONO,
                letterSpacing: "0.08em",
                marginBottom: 1,
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                color: item.color,
                fontSize: 8,
                fontWeight: 700,
                ...MONO,
              }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function PaperTrader({
  selectedMeme,
  collapsed,
  onCollapseChange,
}: Props) {
  const { connection } = useConnection();
  const { tier } = useWraithTier();

  const connRef = useRef<Connection | null>(null);
  const getConn = useCallback((): Connection => {
    if (!connRef.current) {
      connRef.current = new Connection(getRpcEndpoint(), {
        commitment: "confirmed",
        confirmTransactionInitialTimeout: 120000,
      });
    }
    return connRef.current;
  }, []);

  useEffect(() => {
    if (connection) connRef.current = connection;
  }, [connection]);

  const [hotKeypair, setHotKeypair] = useState<Keypair | null>(null);
  const [hotPub, setHotPub] = useState<string | null>(null);
  const [hotBal, setHotBal] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"trade" | "positions" | "log" | "config">(
    "trade",
  );

  const [amountSol, setAmountSol] = useState("0.1");
  const [slPct, setSlPct] = useState(DEFAULT_SL);
  const [tpX, setTpX] = useState(DEFAULT_TP);
  const [trailPct, setTrailPct] = useState(DEFAULT_TRAIL);
  const [customSl, setCustomSl] = useState("");
  const [customTp, setCustomTp] = useState("");
  const [customTrail, setCustomTrail] = useState("");

  const [buying, setBuying] = useState(false);
  const [status, setStatus] = useState<{
    msg: string;
    type: "ok" | "err" | "pending";
  } | null>(null);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);

  const [positions, setPositions] = useState<Position[]>([]);
  const positionsRef = useRef<Position[]>([]);
  const [log, setLog] = useState<TradeLog[]>([]);
  const [flashPos, setFlashPos] = useState<string | null>(null);
  const [borderFlash, setBorderFlash] = useState(false);

  const [dbLoaded, setDbLoaded] = useState(false);

  // ── SHARE STATE
  const [shareData, setShareData] = useState<ShareCardData | null>(null);

  const handleShare = useCallback((pos: Position) => {
    setShareData({
      symbol: pos.symbol,
      mint: pos.mint,
      entryMcap: pos.entryMcap,
      currentMcap: pos.currentMcap,
      exitMcap: pos.exitMcap,
      amountSol: pos.amountSol,
      currentPnlPct: pos.currentPnlPct,
      exitPnlPct: pos.exitPnlPct,
      tpX: pos.tpX,
      slPct: pos.slPct,
      trailPct: pos.trailPct,
      exitReason: pos.exitReason,
      imageUrl: pos.imageUrl,
      buyTxSig: pos.buyTxSig,
      exitTxSig: pos.exitTxSig,
      status: pos.status === "sold" ? "sold" : "watching",
      ts: pos.ts,
    });
  }, []);

  const handleShareFromLog = useCallback((t: TradeLog) => {
    setShareData({
      symbol: t.symbol,
      mint: t.mint,
      entryMcap: t.entryMcap,
      currentMcap: t.exitMcap ?? t.entryMcap,
      exitMcap: t.exitMcap,
      amountSol: t.amountSol,
      currentPnlPct: t.pnlPct ?? 0,
      exitPnlPct: t.pnlPct,
      tpX: t.tpX,
      slPct: t.slPct,
      trailPct: DEFAULT_TRAIL,
      exitReason: t.exitReason as ShareCardData["exitReason"],
      imageUrl: t.imageUrl,
      buyTxSig: t.buyTxSig,
      exitTxSig: t.exitTxSig,
      status: "sold",
      ts: t.ts,
    });
  }, []);

  const fetchAbortRef = useRef<AbortController | null>(null);
  const balTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const monitorTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sellingRef = useRef<Set<string>>(new Set());
  const hotKeypairRef = useRef<Keypair | null>(null);
  const trailPctRef = useRef(trailPct);
  const tierRef = useRef(tier);
  const borderFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const mountedRef = useRef(true);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPositionsSync = useCallback(
    (updater: Position[] | ((prev: Position[]) => Position[])) => {
      setPositions((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        positionsRef.current = next;
        if (persistTimer.current) clearTimeout(persistTimer.current);
        persistTimer.current = setTimeout(() => {
          persistPositions(next.filter((p) => p.status === "watching"));
        }, 1000);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, []);

  useEffect(() => {
    hotKeypairRef.current = hotKeypair;
  }, [hotKeypair]);
  useEffect(() => {
    trailPctRef.current = trailPct;
  }, [trailPct]);
  useEffect(() => {
    tierRef.current = tier;
  }, [tier]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchPositions(), fetchTrades()]).then(
      ([savedPositions, savedTrades]) => {
        if (cancelled) return;
        positionsRef.current = savedPositions;
        setPositions(savedPositions);
        setLog(savedTrades);
        setDbLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hotPub || !hotKeypair) return;
    const fetchBal = async () => {
      if (!mountedRef.current) return;
      try {
        const bal =
          (await getConn().getBalance(hotKeypair.publicKey)) / LAMPORTS_PER_SOL;
        if (mountedRef.current) setHotBal(bal);
      } catch {}
    };
    fetchBal();
    balTimer.current = setInterval(fetchBal, 15000);
    return () => {
      if (balTimer.current) clearInterval(balTimer.current);
    };
  }, [hotPub, hotKeypair, getConn]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ca = (selectedMeme as any)?.contractAddress;
    if (!ca) {
      setTokenData(null);
      return;
    }
    if (fetchAbortRef.current) fetchAbortRef.current.abort();
    const ctrl = new AbortController();
    fetchAbortRef.current = ctrl;
    setTokenData(null);
    fetchTokenData(ca, ctrl.signal).then((d) => {
      if (!ctrl.signal.aborted && mountedRef.current) setTokenData(d);
    });
    return () => ctrl.abort();
  }, [selectedMeme]);

  const triggerSell = useCallback(
    async (posId: string, reason: "TP" | "SL" | "TRAIL" | "MANUAL") => {
      const kp = hotKeypairRef.current;
      if (!kp || sellingRef.current.has(posId)) return;
      sellingRef.current.add(posId);

      const pos = positionsRef.current.find((p) => p.id === posId);
      if (!pos || pos.status !== "watching") {
        sellingRef.current.delete(posId);
        return;
      }

      setPositionsSync((prev) =>
        prev.map((p) =>
          p.id === posId ? { ...p, status: "selling" as const } : p,
        ),
      );

      if (borderFlashTimerRef.current)
        clearTimeout(borderFlashTimerRef.current);
      if (mountedRef.current) setBorderFlash(true);
      borderFlashTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setBorderFlash(false);
      }, 1000);
      if (mountedRef.current) setFlashPos(posId);
      setTimeout(() => {
        if (mountedRef.current) setFlashPos(null);
      }, 2500);

      playAlert(
        reason === "TP"
          ? "sell_tp"
          : reason === "SL"
            ? "sell_sl"
            : "sell_trail",
      );

      try {
        const conn = getConn();
        const rawBal = await getRawTokenBalance(conn, kp.publicKey, pos.mint);
        if (rawBal <= 0) throw new Error("No token balance to sell");

        const feeBps = tierRef.current?.feeBps ?? 0;

        const sig = await jupiterSell(
          conn,
          kp,
          pos.mint,
          rawBal,
          feeBps,
          (msg) => {
            if (mountedRef.current) setStatus({ msg, type: "pending" });
          },
        );

        const exitMcap = await fetchMcap(pos.mint);
        const exitPnl =
          exitMcap > 0
            ? (exitMcap / pos.entryMcap - 1) * 100
            : pos.currentPnlPct;

        if (mountedRef.current) {
          setPositionsSync((prev) =>
            prev.map((p) =>
              p.id === posId
                ? {
                    ...p,
                    status: "sold" as const,
                    exitReason: reason,
                    exitMcap,
                    exitPnlPct: exitPnl,
                    exitTxSig: sig,
                  }
                : p,
            ),
          );
        }

        const logEntry: TradeLog = {
          id: posId,
          symbol: pos.symbol,
          mint: pos.mint,
          entryMcap: pos.entryMcap,
          exitMcap,
          amountSol: pos.amountSol,
          slPct: pos.slPct,
          tpX: pos.tpX,
          pnlPct: exitPnl,
          exitReason: reason,
          buyTxSig: pos.buyTxSig,
          exitTxSig: sig,
          status: "filled",
          imageUrl: pos.imageUrl,
          ts: pos.ts,
        };

        if (mountedRef.current) setLog((prev) => [logEntry, ...prev]);
        appendTrade(logEntry);

        if (mountedRef.current) {
          setStatus({
            msg: `✓ ${reason} — SOLD $${pos.symbol} ${fmtPnl(exitPnl)}`,
            type: "ok",
          });
          setTimeout(() => {
            if (mountedRef.current) setStatus(null);
          }, 7000);
        }

        setTimeout(async () => {
          if (!mountedRef.current || !hotKeypairRef.current) return;
          try {
            const bal =
              (await getConn().getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;
            if (mountedRef.current) setHotBal(bal);
          } catch {}
        }, 4000);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        if (mountedRef.current) {
          setPositionsSync((prev) =>
            prev.map((p) =>
              p.id === posId ? { ...p, status: "watching" as const } : p,
            ),
          );
          setStatus({ msg: `✕ Sell failed: ${msg.slice(0, 60)}`, type: "err" });
          setTimeout(() => {
            if (mountedRef.current) setStatus(null);
          }, 10000);
        }
      }
      sellingRef.current.delete(posId);
    },
    [setPositionsSync, getConn],
  );

  useEffect(() => {
    const monitor = async () => {
      const watching = positionsRef.current.filter(
        (p) => p.status === "watching",
      );
      if (!watching.length) return;
      await Promise.all(
        watching.map(async (pos) => {
          if (sellingRef.current.has(pos.id)) return;
          try {
            const mcap = await fetchMcap(pos.mint);
            if (!mcap || mcap <= 0) return;
            const pnlPct = (mcap / pos.entryMcap - 1) * 100;
            const newPeak = Math.max(pos.peakMcap, mcap);
            const trailFrac = pos.trailPct / 100;
            const trailStop = newPeak * (1 - trailFrac);
            const slMcap = pos.entryMcap * (1 + pos.slPct / 100);
            const tpMcap = pos.entryMcap * pos.tpX;
            const slValid = pos.slPct < 0;

            const updated = {
              ...pos,
              currentMcap: mcap,
              currentPnlPct: pnlPct,
              peakMcap: newPeak,
              trailStopMcap: trailStop,
            };
            if (mountedRef.current)
              setPositionsSync((prev) =>
                prev.map((p) => (p.id === pos.id ? updated : p)),
              );
            if (mcap >= tpMcap) triggerSell(pos.id, "TP");
            else if (slValid && mcap <= slMcap) triggerSell(pos.id, "SL");
            else if (newPeak > pos.entryMcap && mcap <= trailStop)
              triggerSell(pos.id, "TRAIL");
          } catch {}
        }),
      );
    };
    monitorTimer.current = setInterval(monitor, POLL_MS);
    monitor();
    return () => {
      if (monitorTimer.current) clearInterval(monitorTimer.current);
    };
  }, [triggerSell, setPositionsSync]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ca = (selectedMeme as any)?.contractAddress || null;
  const sym = selectedMeme ? (selectedMeme.keyword || "").toUpperCase() : null;
  const mcap = tokenData?.mcap || selectedMeme?.mcap || 0;
  const isAvoid =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !!(selectedMeme as any)?.safetyLabel?.toLowerCase()?.includes("avoid") ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !!(selectedMeme as any)?.avoid ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !!(selectedMeme as any)?.honeypot;

  const slMcap = mcap > 0 ? mcap * (1 + slPct / 100) : 0;
  const tpMcap = mcap > 0 ? mcap * tpX : 0;
  const slIsValid = slPct < 0;
  const canBuy =
    !!hotKeypair &&
    !!ca &&
    !!sym &&
    !isAvoid &&
    parseFloat(amountSol) > 0 &&
    !buying &&
    slIsValid &&
    (hotBal ?? 0) >= parseFloat(amountSol);

  const handleBuy = useCallback(async () => {
    if (!canBuy || !hotKeypair) return;
    if (!slIsValid) {
      setStatus({ msg: "Stop loss must be negative (e.g. -20%)", type: "err" });
      return;
    }
    setBuying(true);
    setStatus({ msg: "Starting buy…", type: "pending" });
    const amt = parseFloat(amountSol);
    const feeBps = tier?.feeBps ?? 0;
    try {
      const conn = getConn();
      const { sig, rawTokenAmount } = await jupiterBuy(
        conn,
        hotKeypair,
        ca,
        Math.floor(amt * 1e9),
        feeBps,
        (msg) => {
          if (mountedRef.current) setStatus({ msg, type: "pending" });
        },
      );

      if (mountedRef.current)
        setStatus({ msg: "Confirmed! Building position…", type: "pending" });

      const entryMcap = tokenData?.mcap || mcap;
      const trailFrac = trailPct / 100;
      const pos: Position = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        symbol: sym!,
        mint: ca,
        entryMcap,
        entryPrice: tokenData?.price || 0,
        tokenAmount: rawTokenAmount,
        amountSol: amt,
        slPct,
        tpX,
        trailPct,
        peakMcap: entryMcap,
        currentMcap: entryMcap,
        currentPnlPct: 0,
        trailStopMcap: entryMcap * (1 - trailFrac),
        status: "watching",
        buyTxSig: sig,
        imageUrl: tokenData?.imageUrl,
        ts: Date.now(),
      };
      setPositionsSync((prev) => [pos, ...prev]);
      markBoughtInWinsPanel((sym || "").toLowerCase());

      const displayAmt =
        rawTokenAmount > 1e6
          ? `${(rawTokenAmount / 1e6).toFixed(1)}M`
          : rawTokenAmount > 1e3
            ? `${(rawTokenAmount / 1e3).toFixed(1)}K`
            : rawTokenAmount.toFixed(0);

      if (mountedRef.current) {
        setStatus({
          msg: `✓ Bought ~${displayAmt} $${sym} · auto-sell armed`,
          type: "ok",
        });
        setTab("positions");
        setTimeout(() => {
          if (mountedRef.current) setStatus(null);
        }, 6000);
      }

      setTimeout(async () => {
        if (!mountedRef.current || !hotKeypairRef.current) return;
        try {
          const bal =
            (await getConn().getBalance(hotKeypair.publicKey)) /
            LAMPORTS_PER_SOL;
          if (mountedRef.current) setHotBal(bal);
        } catch {}
      }, 4000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      if (mountedRef.current) {
        setStatus({ msg: `✕ ${msg.slice(0, 80)}`, type: "err" });
        setTimeout(() => {
          if (mountedRef.current) setStatus(null);
        }, 12000);
      }
    }
    if (mountedRef.current) setBuying(false);
  }, [
    canBuy,
    hotKeypair,
    ca,
    sym,
    amountSol,
    slPct,
    slIsValid,
    tpX,
    trailPct,
    mcap,
    tokenData,
    tier,
    setPositionsSync,
    getConn,
  ]);

  const handleUnlocked = useCallback((kp: Keypair, pub: string) => {
    setHotKeypair(kp);
    setHotPub(pub);
  }, []);

  const watchingPositions = positions.filter(
    (p) => p.status === "watching" || p.status === "selling",
  );
  const filledLogs = log.filter((t) => t.status === "filled");
  const wins = filledLogs.filter((t) => (t.pnlPct ?? 0) > 0).length;

  const SL_PRESETS = [-10, -20, -30, -50];
  const TP_PRESETS = [1.5, 2, 3, 5, 10];
  const TRAIL_PRESETS = [5, 10, 15, 20, 25];

  const feeBadgeLabel =
    tier?.feeBps === 0
      ? "0% FEE"
      : tier?.feeBps != null
        ? `${(tier.feeBps / 100).toFixed(2)}% FEE`
        : null;

  return (
    <div
      style={{
        background: C.bg,
        border: `1px solid ${borderFlash ? C.orange + "88" : C.border}`,
        borderRadius: 8,
        overflow: "hidden",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 0.3s",
      }}
    >
      <style>{`
        .sb:hover:not(:disabled){filter:brightness(1.12);}
        .ssl:hover{background:#1a0000!important;border-color:#ff444444!important;color:#ff4444!important;}
        .stp:hover{background:#001a00!important;border-color:#00c47a44!important;color:#00c47a!important;}
        .str:hover{background:#1a0d00!important;border-color:#ffaa0044!important;color:#ffaa00!important;}
        .samt:hover{background:#111!important;}
        input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;}
        input[type=number]{-moz-appearance:textfield;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        .cfg-inp{background:#0d0d0d;border:1px solid #1a1a1a;color:#f0f0f0;font-size:12px;padding:6px 9px;border-radius:3px;outline:none;width:84px;text-align:right;}
        .cfg-inp:focus{border-color:#e8490f55;}
      `}</style>

      {/* HEADER */}
      <div
        onClick={() => onCollapseChange(!collapsed)}
        style={{
          background: "#030303",
          borderBottom: collapsed ? "none" : `1px solid ${C.border}`,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          userSelect: "none" as const,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              color: C.orange,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.18em",
              ...MONO,
            }}
          >
            ⚡ SNIPER
          </span>
          <span
            style={{
              fontSize: 7,
              padding: "1px 5px",
              borderRadius: 2,
              ...MONO,
              color: hotKeypair ? C.green : C.muted,
              border: `1px solid ${hotKeypair ? C.green + "33" : C.border}`,
            }}
          >
            {hotKeypair ? "HOT WALLET" : "LOCKED"}
          </span>
          {hotBal !== null && (
            <span
              style={{
                fontSize: 7,
                color: hotBal < 0.05 ? C.amber : C.green,
                border: `1px solid ${hotBal < 0.05 ? C.amber + "33" : C.green + "22"}`,
                padding: "1px 5px",
                borderRadius: 2,
                ...MONO,
              }}
            >
              {hotBal.toFixed(3)} SOL
            </span>
          )}
          {feeBadgeLabel && (
            <span
              style={{
                fontSize: 7,
                color: tier?.feeBps === 0 ? C.green : C.amber,
                border: `1px solid ${tier?.feeBps === 0 ? C.green + "33" : C.amber + "33"}`,
                padding: "1px 5px",
                borderRadius: 2,
                ...MONO,
              }}
            >
              {feeBadgeLabel}
            </span>
          )}
          {watchingPositions.length > 0 && (
            <span
              style={{
                fontSize: 7,
                color: C.blue,
                border: `1px solid ${C.blue}33`,
                padding: "1px 5px",
                borderRadius: 2,
                ...MONO,
                animation: "pulse 2s infinite",
              }}
            >
              {watchingPositions.length} LIVE
            </span>
          )}
          {!dbLoaded && (
            <span style={{ fontSize: 7, color: C.dim, ...MONO }}>loading…</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            style={{
              fontSize: 9,
              color: C.dim,
              ...MONO,
              transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
              display: "inline-block",
            }}
          >
            ▾
          </span>
          {!collapsed &&
            hotKeypair &&
            (["trade", "positions", "log", "config"] as const).map((t) => (
              <button
                key={t}
                onClick={(e) => {
                  e.stopPropagation();
                  setTab(t);
                }}
                style={{
                  background: tab === t ? "#111" : "transparent",
                  border: `1px solid ${tab === t ? C.border : "transparent"}`,
                  color: tab === t ? C.primary : C.dim,
                  fontSize: t === "config" ? 13 : 9,
                  fontWeight: tab === t ? 700 : 400,
                  letterSpacing: "0.08em",
                  padding: t === "config" ? "3px 8px" : "2px 6px",
                  borderRadius: 2,
                  cursor: "pointer",
                  ...MONO,
                }}
              >
                {t === "positions"
                  ? `POS${watchingPositions.length ? `(${watchingPositions.length})` : ""}`
                  : t === "log" && filledLogs.length
                    ? `LOG(${filledLogs.length})`
                    : t === "config"
                      ? "⚙"
                      : t.toUpperCase()}
              </button>
            ))}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {!collapsed && !hotKeypair && (
          <HotWalletSetup onUnlocked={handleUnlocked} />
        )}

        {/* ── TRADE TAB */}
        {!collapsed && hotKeypair && tab === "trade" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {/* Wallet bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: C.bgCard,
                border: `1px solid ${C.border}`,
                borderRadius: 3,
                padding: "5px 8px",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: C.label,
                    fontSize: 6,
                    ...MONO,
                    letterSpacing: "0.1em",
                    marginBottom: 1,
                  }}
                >
                  HOT WALLET
                </div>
                <div
                  style={{
                    color: C.dim,
                    fontSize: 8,
                    ...MONO,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap" as const,
                  }}
                >
                  {hotPub?.slice(0, 22)}…
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (hotPub) {
                    navigator.clipboard.writeText(hotPub);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }
                }}
                style={{
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  color: copied ? C.green : C.dim,
                  fontSize: 7,
                  padding: "2px 6px",
                  borderRadius: 2,
                  cursor: "pointer",
                  ...MONO,
                }}
              >
                {copied ? "✓" : "COPY"}
              </button>
              {hotBal !== null && hotBal < 0.05 && (
                <span
                  style={{
                    fontSize: 7,
                    color: C.amber,
                    border: `1px solid ${C.amber}33`,
                    padding: "2px 5px",
                    borderRadius: 2,
                    ...MONO,
                  }}
                >
                  LOW SOL
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setHotKeypair(null);
                  setHotPub(null);
                  setHotBal(null);
                }}
                style={{
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  color: C.dim,
                  fontSize: 7,
                  padding: "2px 6px",
                  borderRadius: 2,
                  cursor: "pointer",
                  ...MONO,
                }}
              >
                LOCK
              </button>
            </div>

            {isAvoid && ca && (
              <div
                style={{
                  background: "#1a0000",
                  border: `1px solid ${C.red}44`,
                  borderRadius: 3,
                  padding: "5px 8px",
                  color: C.red,
                  fontSize: 8,
                  ...MONO,
                }}
              >
                🚫 BLOCKED — Honeypot / AVOID flagged by scanner.
              </div>
            )}

            {/* Token info */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TokenAvatar
                imageUrl={tokenData?.imageUrl}
                symbol={sym || "?"}
                size={34}
                links={
                  ca
                    ? {
                        twitter: tokenData?.links?.twitter,
                        telegram: tokenData?.links?.telegram,
                        website: tokenData?.links?.website,
                        dex: `https://dexscreener.com/solana/${ca}`,
                        pump: `https://pump.fun/${ca}`,
                      }
                    : undefined
                }
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                {sym ? (
                  <>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          color: C.primary,
                          fontSize: 13,
                          fontWeight: 900,
                          ...MONO,
                        }}
                      >
                        ${sym}
                      </span>
                      <span
                        style={{
                          color: C.orange,
                          fontSize: 10,
                          fontWeight: 700,
                          ...MONO,
                        }}
                      >
                        {fmtMcap(mcap)}
                      </span>
                    </div>
                    {ca && (
                      <div
                        style={{
                          color: C.dim,
                          fontSize: 7,
                          ...MONO,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap" as const,
                        }}
                      >
                        {ca.slice(0, 22)}…
                      </div>
                    )}
                  </>
                ) : (
                  <span style={{ color: C.dim, fontSize: 9, ...MONO }}>
                    ← select token from scanner
                  </span>
                )}
              </div>
            </div>

            {/* Amount */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div
                style={{
                  color: C.label,
                  fontSize: 7,
                  letterSpacing: "0.12em",
                  ...MONO,
                  flexShrink: 0,
                  width: 22,
                }}
              >
                SOL
              </div>
              <input
                type="number"
                value={amountSol}
                onChange={(e) => setAmountSol(e.target.value)}
                min="0.01"
                step="0.05"
                style={{
                  flex: 1,
                  background: C.bgCard,
                  border: `1px solid ${C.border}`,
                  color: C.primary,
                  fontSize: 13,
                  fontWeight: 700,
                  padding: "5px 8px",
                  borderRadius: 3,
                  outline: "none",
                  ...MONO,
                  textAlign: "right" as const,
                }}
              />
              {["0.05", "0.1", "0.25", "0.5"].map((v) => (
                <button
                  key={v}
                  className="samt"
                  onClick={() => setAmountSol(v)}
                  style={{
                    background: amountSol === v ? "#111" : "transparent",
                    border: `1px solid ${amountSol === v ? C.orange + "55" : C.border}`,
                    color: amountSol === v ? C.orange : C.dim,
                    fontSize: 8,
                    padding: "5px 5px",
                    borderRadius: 2,
                    cursor: "pointer",
                    ...MONO,
                    flexShrink: 0,
                    minWidth: 28,
                  }}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* SL / TP */}
            <div style={{ display: "flex", gap: 5 }}>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    color: C.label,
                    fontSize: 7,
                    letterSpacing: "0.12em",
                    ...MONO,
                    marginBottom: 3,
                  }}
                >
                  STOP LOSS
                  {![-10, -20, -30, -50].includes(slPct) && (
                    <span
                      style={{ color: C.red, marginLeft: 5, fontWeight: 700 }}
                    >
                      {slPct}%
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  {[-10, -20, -30, -50].map((v) => (
                    <button
                      key={v}
                      className="ssl"
                      onClick={() => setSlPct(v)}
                      style={{
                        flex: 1,
                        background: slPct === v ? "#1a0000" : "transparent",
                        border: `1px solid ${slPct === v ? C.red + "55" : C.border}`,
                        color: slPct === v ? C.red : C.dim,
                        fontSize: 8,
                        fontWeight: slPct === v ? 700 : 400,
                        padding: "4px 0",
                        borderRadius: 2,
                        cursor: "pointer",
                        ...MONO,
                      }}
                    >
                      {v}%
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    color: C.label,
                    fontSize: 7,
                    letterSpacing: "0.12em",
                    ...MONO,
                    marginBottom: 3,
                  }}
                >
                  TAKE PROFIT
                  {![1.5, 2, 5].includes(tpX) && (
                    <span
                      style={{ color: C.green, marginLeft: 5, fontWeight: 700 }}
                    >
                      {tpX}×
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  {[1.5, 2, 5].map((v) => (
                    <button
                      key={v}
                      className="stp"
                      onClick={() => setTpX(v)}
                      style={{
                        flex: 1,
                        background: tpX === v ? "#001a00" : "transparent",
                        border: `1px solid ${tpX === v ? C.green + "55" : C.border}`,
                        color: tpX === v ? C.green : C.dim,
                        fontSize: 9,
                        fontWeight: tpX === v ? 700 : 400,
                        padding: "4px 0",
                        borderRadius: 2,
                        cursor: "pointer",
                        ...MONO,
                      }}
                    >
                      {v}×
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Trail pill */}
            <div
              style={{
                background: "#0d0a00",
                border: `1px solid ${C.amber}22`,
                borderRadius: 3,
                padding: "4px 8px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
              onClick={() => setTab("config")}
            >
              <span
                style={{
                  fontSize: 7,
                  color: C.amber,
                  fontWeight: 700,
                  ...MONO,
                }}
              >
                ⚡ TRAIL -{trailPct}%
              </span>
              <span style={{ fontSize: 7, color: C.dim, ...MONO }}>
                Locks gains · sells {trailPct}% below peak
              </span>
              <span
                style={{
                  fontSize: 6,
                  color: C.dim,
                  ...MONO,
                  marginLeft: "auto",
                }}
              >
                tap ⚙ to edit →
              </span>
            </div>

            {/* Entry / SL / TP display */}
            {mcap > 0 && (
              <div style={{ display: "flex", gap: 3 }}>
                {[
                  { label: "ENTRY", value: fmtMcap(mcap), color: C.muted },
                  {
                    label: `SL ${slPct}%`,
                    value: fmtMcap(slMcap),
                    color: C.red,
                  },
                  {
                    label: `TP ${tpX}×`,
                    value: fmtMcap(tpMcap),
                    color: C.green,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      flex: 1,
                      background: C.bgCard,
                      border: `1px solid ${C.border}`,
                      borderRadius: 3,
                      padding: "4px 6px",
                      textAlign: "center" as const,
                    }}
                  >
                    <div
                      style={{
                        color: C.label,
                        fontSize: 6,
                        ...MONO,
                        letterSpacing: "0.1em",
                        marginBottom: 1,
                      }}
                    >
                      {item.label}
                    </div>
                    <div
                      style={{
                        color: item.color,
                        fontSize: 10,
                        fontWeight: 700,
                        ...MONO,
                      }}
                    >
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {status && (
              <div
                style={{
                  background:
                    status.type === "ok"
                      ? "#001a0a"
                      : status.type === "err"
                        ? "#1a0000"
                        : "#0d0d00",
                  border: `1px solid ${status.type === "ok" ? C.green + "33" : status.type === "err" ? C.red + "33" : C.amber + "33"}`,
                  borderRadius: 3,
                  padding: "5px 8px",
                  color:
                    status.type === "ok"
                      ? C.green
                      : status.type === "err"
                        ? C.red
                        : C.amber,
                  fontSize: 8,
                  ...MONO,
                }}
              >
                {status.msg}
              </div>
            )}

            <button
              className="sb"
              onClick={handleBuy}
              disabled={!canBuy}
              style={{
                background: isAvoid
                  ? "#1a0000"
                  : !ca
                    ? "#0d0d0d"
                    : buying
                      ? "#0d2200"
                      : (hotBal ?? 0) < parseFloat(amountSol || "0")
                        ? "#111"
                        : C.orange,
                border: `1px solid ${isAvoid ? C.red + "44" : !ca ? C.border : buying ? C.green + "44" : "transparent"}`,
                color: isAvoid
                  ? C.red
                  : !ca
                    ? C.dim
                    : buying
                      ? C.green
                      : (hotBal ?? 0) < parseFloat(amountSol || "0")
                        ? C.amber
                        : "#fff",
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: "0.14em",
                padding: "9px 10px",
                borderRadius: 4,
                cursor: canBuy ? "pointer" : "not-allowed",
                width: "100%",
                ...MONO,
                transition: "all 0.15s",
                boxShadow:
                  canBuy && !buying ? `0 0 16px ${C.orange}33` : "none",
              }}
            >
              {isAvoid
                ? "🚫 HONEYPOT — BUY BLOCKED"
                : !ca
                  ? "SELECT A TOKEN"
                  : (hotBal ?? 0) < parseFloat(amountSol || "0")
                    ? `LOW FUNDS — ${hotBal?.toFixed(3)} SOL`
                    : buying
                      ? "SNIPING…"
                      : `⚡ BUY ${sym || ""} — ${amountSol} SOL`}
            </button>
          </div>
        )}

        {/* ── CONFIG TAB */}
        {!collapsed && hotKeypair && tab === "config" && (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {[
              {
                label: "STOP LOSS (SL)",
                sublabel: "Auto-sells when mcap drops this % from entry",
                presets: SL_PRESETS,
                val: slPct,
                setter: setSlPct,
                customVal: customSl,
                setCustom: setCustomSl,
                color: C.red,
                cls: "ssl",
                sign: "%",
                isNeg: true,
                min: -90,
                max: -1,
              },
              {
                label: "TAKE PROFIT (TP)",
                sublabel: "Auto-sells when mcap reaches this multiplier",
                presets: TP_PRESETS,
                val: tpX,
                setter: setTpX,
                customVal: customTp,
                setCustom: setCustomTp,
                color: C.green,
                cls: "stp",
                sign: "×",
                isNeg: false,
                min: 1.1,
                max: 100,
              },
              {
                label: "TRAILING STOP",
                sublabel:
                  "Sells if price falls this % below its peak — locks gains. Applies to new positions only.",
                presets: TRAIL_PRESETS,
                val: trailPct,
                setter: setTrailPct,
                customVal: customTrail,
                setCustom: setCustomTrail,
                color: C.amber,
                cls: "str",
                sign: "%",
                isNeg: false,
                min: 1,
                max: 50,
              },
            ].map((cfg) => (
              <div
                key={cfg.label}
                style={{ display: "flex", flexDirection: "column", gap: 6 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      color: C.muted,
                      fontSize: 10,
                      letterSpacing: "0.12em",
                      fontWeight: 600,
                      ...MONO,
                    }}
                  >
                    {cfg.label}
                  </span>
                  <span
                    style={{
                      color: cfg.color,
                      fontSize: 13,
                      fontWeight: 900,
                      ...MONO,
                    }}
                  >
                    {cfg.isNeg ? `${cfg.val}%` : `${cfg.val}${cfg.sign}`}
                  </span>
                </div>
                <div style={{ color: C.dim, fontSize: 9, ...MONO }}>
                  {cfg.sublabel}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {cfg.presets.map((v) => (
                    <button
                      key={v}
                      className={cfg.cls}
                      onClick={() => {
                        cfg.setter(v as never);
                        cfg.setCustom("");
                      }}
                      style={{
                        flex: 1,
                        background:
                          cfg.val === v
                            ? cfg.isNeg
                              ? "#1a0000"
                              : cfg.sign === "×"
                                ? "#001a00"
                                : "#1a0d00"
                            : "transparent",
                        border: `1px solid ${cfg.val === v ? cfg.color + "66" : C.border}`,
                        color: cfg.val === v ? cfg.color : C.muted,
                        fontSize: 11,
                        fontWeight: cfg.val === v ? 800 : 500,
                        padding: "7px 0",
                        borderRadius: 3,
                        cursor: "pointer",
                        ...MONO,
                      }}
                    >
                      {cfg.isNeg ? `${v}%` : `${v}${cfg.sign}`}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      color: C.label,
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      ...MONO,
                      flexShrink: 0,
                    }}
                  >
                    CUSTOM
                  </span>
                  <input
                    type="number"
                    placeholder={
                      cfg.isNeg
                        ? "e.g. -40"
                        : cfg.sign === "×"
                          ? "e.g. 4"
                          : "e.g. 12"
                    }
                    value={cfg.customVal}
                    className="cfg-inp"
                    style={{ ...MONO }}
                    min={cfg.min}
                    max={cfg.max}
                    step={cfg.sign === "×" ? 0.5 : 1}
                    onChange={(e) => cfg.setCustom(e.target.value)}
                  />
                  <button
                    onClick={() => {
                      const n = parseFloat(cfg.customVal);
                      if (isNaN(n)) return;
                      cfg.setter(
                        Math.min(Math.max(n, cfg.min), cfg.max) as never,
                      );
                    }}
                    style={{
                      background: C.bgCard,
                      border: `1px solid ${C.border}`,
                      color: C.primary,
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "6px 12px",
                      borderRadius: 3,
                      cursor: "pointer",
                      ...MONO,
                    }}
                  >
                    SET
                  </button>
                  <span
                    style={{
                      color: cfg.color,
                      fontSize: 11,
                      fontWeight: 800,
                      ...MONO,
                    }}
                  >
                    → {cfg.isNeg ? `${cfg.val}%` : `${cfg.val}${cfg.sign}`}
                  </span>
                </div>
              </div>
            ))}

            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
              <div
                style={{
                  color: C.muted,
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  fontWeight: 600,
                  ...MONO,
                  marginBottom: 7,
                }}
              >
                AMOUNT PRESETS
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {["0.05", "0.1", "0.25", "0.5", "1"].map((v) => (
                  <button
                    key={v}
                    className="samt"
                    onClick={() => setAmountSol(v)}
                    style={{
                      flex: 1,
                      background: amountSol === v ? "#111" : "transparent",
                      border: `1px solid ${amountSol === v ? C.orange + "66" : C.border}`,
                      color: amountSol === v ? C.orange : C.muted,
                      fontSize: 11,
                      fontWeight: amountSol === v ? 800 : 500,
                      padding: "7px 0",
                      borderRadius: 3,
                      cursor: "pointer",
                      ...MONO,
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                background: C.bgCard,
                border: `1px solid ${C.border}`,
                borderRadius: 5,
                padding: "10px 12px",
              }}
            >
              <div
                style={{
                  color: C.label,
                  fontSize: 9,
                  letterSpacing: "0.14em",
                  fontWeight: 600,
                  ...MONO,
                  marginBottom: 8,
                }}
              >
                ACTIVE CONFIG SUMMARY
              </div>
              {[
                {
                  label: "Buy Amount",
                  val: `${amountSol} SOL`,
                  color: C.primary,
                },
                {
                  label: "Stop Loss",
                  val: `${slPct}% — sell if down ${Math.abs(slPct)}%`,
                  color: C.red,
                },
                {
                  label: "Take Profit",
                  val: `${tpX}× — sell at ${tpX * 100}% of entry`,
                  color: C.green,
                },
                {
                  label: "Trailing Stop",
                  val: `-${trailPct}% from peak — new positions only`,
                  color: C.amber,
                },
                {
                  label: "Platform Fee",
                  val:
                    tier?.feeBps === 0
                      ? "0% (WRAITH tier)"
                      : tier?.feeBps != null
                        ? `${(tier.feeBps / 100).toFixed(2)}% per trade`
                        : "—",
                  color: tier?.feeBps === 0 ? C.green : C.amber,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: 5,
                    alignItems: "baseline",
                  }}
                >
                  <span
                    style={{
                      color: C.label,
                      fontSize: 9,
                      ...MONO,
                      width: 90,
                      flexShrink: 0,
                    }}
                  >
                    {item.label}
                  </span>
                  <span
                    style={{
                      color: item.color,
                      fontSize: 10,
                      fontWeight: 700,
                      ...MONO,
                    }}
                  >
                    {item.val}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── POSITIONS TAB */}
        {!collapsed && hotKeypair && tab === "positions" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {watchingPositions.length === 0 ? (
              <div
                style={{
                  padding: "16px",
                  textAlign: "center" as const,
                  color: C.dim,
                  fontSize: 9,
                  ...MONO,
                  lineHeight: 1.8,
                }}
              >
                NO OPEN POSITIONS
                <br />
                <span style={{ fontSize: 7, color: C.label }}>
                  Buy a token → it appears here with live auto-sell monitoring
                </span>
              </div>
            ) : (
              watchingPositions.map((pos) => (
                <PositionCard
                  key={pos.id}
                  pos={pos}
                  flash={flashPos === pos.id}
                  onManualSell={(id) => triggerSell(id, "MANUAL")}
                  onShare={handleShare}
                />
              ))
            )}
            {watchingPositions.length > 0 && (
              <div
                style={{
                  padding: "5px 10px",
                  borderTop: `1px solid ${C.border}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: C.green,
                    display: "inline-block",
                    animation: "pulse 1.5s infinite",
                  }}
                />
                <span style={{ fontSize: 7, color: C.dim, ...MONO }}>
                  AUTO-SELL ARMED · polls every 10s · SL + TP + Trail
                </span>
              </div>
            )}
            {status && (
              <div
                style={{
                  margin: "6px 10px",
                  background:
                    status.type === "ok"
                      ? "#001a0a"
                      : status.type === "err"
                        ? "#1a0000"
                        : "#0d0d00",
                  border: `1px solid ${status.type === "ok" ? C.green + "33" : status.type === "err" ? C.red + "33" : C.amber + "33"}`,
                  borderRadius: 3,
                  padding: "5px 8px",
                  color:
                    status.type === "ok"
                      ? C.green
                      : status.type === "err"
                        ? C.red
                        : C.amber,
                  fontSize: 8,
                  ...MONO,
                }}
              >
                {status.msg}
              </div>
            )}
          </div>
        )}

        {/* ── LOG TAB */}
        {!collapsed && hotKeypair && tab === "log" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filledLogs.length > 0 && (
              <div
                style={{
                  padding: "6px 10px",
                  borderBottom: `1px solid ${C.border}`,
                  display: "flex",
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 7, color: C.muted, ...MONO }}>
                  TOTAL {filledLogs.length}
                </span>
                <span style={{ fontSize: 7, color: C.green, ...MONO }}>
                  WIN {wins}
                </span>
                <span style={{ fontSize: 7, color: C.red, ...MONO }}>
                  LOSS {filledLogs.length - wins}
                </span>
                <span style={{ fontSize: 7, color: C.amber, ...MONO }}>
                  RATE{" "}
                  {filledLogs.length
                    ? ((wins / filledLogs.length) * 100).toFixed(0)
                    : 0}
                  %
                </span>
              </div>
            )}
            {filledLogs.length === 0 ? (
              <div
                style={{
                  padding: "14px",
                  textAlign: "center" as const,
                  color: C.dim,
                  fontSize: 9,
                  ...MONO,
                }}
              >
                NO TRADES YET
              </div>
            ) : (
              filledLogs.map((t) => {
                const pnl = t.pnlPct ?? 0;
                return (
                  <div
                    key={t.id}
                    style={{
                      padding: "7px 10px",
                      borderBottom: `1px solid ${C.bgCard}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                    }}
                  >
                    <TokenAvatar
                      imageUrl={t.imageUrl}
                      symbol={t.symbol}
                      size={26}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          marginBottom: 1,
                        }}
                      >
                        <span
                          style={{
                            color: C.primary,
                            fontSize: 10,
                            fontWeight: 700,
                            ...MONO,
                          }}
                        >
                          ${t.symbol}
                        </span>
                        <span
                          style={{
                            fontSize: 8,
                            fontWeight: 700,
                            color: pnl >= 0 ? C.green : C.red,
                            ...MONO,
                          }}
                        >
                          {fmtPnl(pnl)}
                        </span>
                        {t.exitReason && (
                          <span
                            style={{
                              fontSize: 6,
                              padding: "1px 4px",
                              borderRadius: 2,
                              ...MONO,
                              color:
                                t.exitReason === "TP"
                                  ? C.green
                                  : t.exitReason === "SL"
                                    ? C.red
                                    : C.amber,
                              border: `1px solid ${t.exitReason === "TP" ? C.green + "33" : t.exitReason === "SL" ? C.red + "33" : C.amber + "33"}`,
                            }}
                          >
                            {t.exitReason}
                          </span>
                        )}
                      </div>
                      <div style={{ color: C.muted, fontSize: 7, ...MONO }}>
                        {t.amountSol} SOL · {fmtMcap(t.entryMcap)} →{" "}
                        {fmtMcap(t.exitMcap ?? 0)}
                      </div>
                    </div>
                    <div
                      style={{
                        textAlign: "right" as const,
                        flexShrink: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 2,
                      }}
                    >
                      <div style={{ color: C.dim, fontSize: 7, ...MONO }}>
                        {fmtAgo(t.ts)}
                      </div>
                      {t.exitTxSig && (
                        <a
                          href={`https://solscan.io/tx/${t.exitTxSig}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: 7,
                            color: C.blue,
                            ...MONO,
                            textDecoration: "none",
                          }}
                        >
                          {t.exitTxSig.slice(0, 8)}↗
                        </a>
                      )}
                      {/* share button in log */}
                      <button
                        onClick={() => handleShareFromLog(t)}
                        style={{
                          background: "transparent",
                          border: `1px solid ${C.orange}33`,
                          color: C.orange,
                          fontSize: 6,
                          padding: "2px 5px",
                          borderRadius: 2,
                          cursor: "pointer",
                          ...MONO,
                        }}
                      >
                        ↗ SHARE
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* SHARE TEST — remove after */}
      {/* <button
        onClick={() =>
          setShareData({
            symbol: "PEPE",
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            entryMcap: 500000,
            currentMcap: 1250000,
            exitMcap: undefined,
            amountSol: 0.1,
            currentPnlPct: 150,
            exitPnlPct: undefined,
            tpX: 3,
            slPct: -20,
            trailPct: 15,
            exitReason: undefined,
            imageUrl: undefined,
            buyTxSig: undefined,
            exitTxSig: undefined,
            status: "watching",
            ts: Date.now(),
          })
        }
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 9999,
          background: "orange",
          padding: "10px 16px",
          borderRadius: 6,
          cursor: "pointer",
          fontWeight: 700,
        }}
      >
        TEST SHARE
      </button> */}

      {/* ── SHARE MODAL */}
      {shareData && (
        <ShareModal data={shareData} onClose={() => setShareData(null)} />
      )}
    </div>
  );
}
