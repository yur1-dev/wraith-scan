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
import { MemeTrend } from "@/app/page";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
  selectedMeme: MemeTrend | null;
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

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const LOG_KEY = "wraith_sniper_log_v2";
const POS_KEY = "wraith_positions_v2";
const HW_KEY = "wraith_hot_wallet_v1";
const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};
const SOL_MINT = "So11111111111111111111111111111111111111112";
const RPC = "https://solana-rpc.publicnode.com";
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
// POLL CONFIRM
// ─────────────────────────────────────────────────────────────────────────────
async function pollConfirm(
  conn: Connection,
  sig: string,
  timeoutMs = 60000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const s = value?.[0];
    if (
      s &&
      !s.err &&
      (s.confirmationStatus === "confirmed" ||
        s.confirmationStatus === "finalized")
    )
      return;
    if (s?.err) throw new Error(`Tx failed on-chain: ${JSON.stringify(s.err)}`);
    await sleep(2000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JUPITER — BUY
// ─────────────────────────────────────────────────────────────────────────────
async function jupiterBuy(
  keypair: Keypair,
  outputMint: string,
  amountLamports: number,
): Promise<string> {
  const conn = new Connection(RPC, "confirmed");
  const quoteRes = await fetch(
    `/api/jupiter?endpoint=quote&inputMint=${SOL_MINT}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=300`,
  );
  if (!quoteRes.ok) throw new Error(`Quote failed: ${quoteRes.status}`);
  const quote = await quoteRes.json();
  if (quote.error) throw new Error(`Quote: ${quote.error}`);
  const swapRes = await fetch("/api/jupiter?endpoint=swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 100000,
    }),
  });
  if (!swapRes.ok) throw new Error(`Swap build failed: ${swapRes.status}`);
  const { swapTransaction } = await swapRes.json();
  const tx = VersionedTransaction.deserialize(
    Buffer.from(swapTransaction, "base64"),
  );
  tx.sign([keypair]);
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });
  await pollConfirm(conn, sig);
  return sig;
}

// ─────────────────────────────────────────────────────────────────────────────
// JUPITER — SELL
// ─────────────────────────────────────────────────────────────────────────────
async function jupiterSell(
  keypair: Keypair,
  inputMint: string,
  tokenAmount: number,
): Promise<string> {
  const conn = new Connection(RPC, "confirmed");
  const quoteRes = await fetch(
    `/api/jupiter?endpoint=quote&inputMint=${inputMint}&outputMint=${SOL_MINT}&amount=${Math.floor(tokenAmount)}&slippageBps=500`,
  );
  if (!quoteRes.ok) throw new Error(`Sell quote failed: ${quoteRes.status}`);
  const quote = await quoteRes.json();
  if (quote.error) throw new Error(`Sell quote: ${quote.error}`);
  const swapRes = await fetch("/api/jupiter?endpoint=swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 200000,
    }),
  });
  if (!swapRes.ok) throw new Error(`Sell swap build failed: ${swapRes.status}`);
  const { swapTransaction } = await swapRes.json();
  const tx = VersionedTransaction.deserialize(
    Buffer.from(swapTransaction, "base64"),
  );
  tx.sign([keypair]);
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });
  await pollConfirm(conn, sig);
  return sig;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN BALANCE
// ─────────────────────────────────────────────────────────────────────────────
async function getTokenBalance(
  walletPubkey: PublicKey,
  mint: string,
): Promise<number> {
  const conn = new Connection(RPC, "confirmed");
  try {
    const accounts = await conn.getParsedTokenAccountsByOwner(walletPubkey, {
      mint: new PublicKey(mint),
    });
    if (!accounts.value.length) return 0;
    return accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount ?? 0;
  } catch {
    return 0;
  }
}
async function getRawTokenBalance(
  walletPubkey: PublicKey,
  mint: string,
): Promise<number> {
  const conn = new Connection(RPC, "confirmed");
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

async function fetchTokenData(ca: string): Promise<TokenData | null> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${ca}`,
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
// PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────
function loadPositions(): Position[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) || "[]");
  } catch {
    return [];
  }
}
function savePositions(p: Position[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {}
}
function loadLog(): TradeLog[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveLog(l: TradeLog[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(0, 200)));
  } catch {}
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
  return `${Math.floor(m / 60)}h ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOUND
// ─────────────────────────────────────────────────────────────────────────────
function playAlert(type: "sell_tp" | "sell_sl" | "sell_trail") {
  try {
    const ctx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    )();
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
  } catch {
    /* ignore */
  }
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
// RECOVERY KEY STORAGE
// ─────────────────────────────────────────────────────────────────────────────
const RK_KEY = "wraith_recovery_v1";

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
function saveRecovery(phrase: string) {
  if (typeof window !== "undefined") localStorage.setItem(RK_KEY, phrase);
}
function loadRecovery(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem(RK_KEY) : null;
}
function clearRecovery() {
  if (typeof window !== "undefined") localStorage.removeItem(RK_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────
// NO-AUTOFILL PASSWORD INPUT
// A custom component that completely blocks browser credential/password managers
// from attaching to the field — works on Chrome, Edge, Brave, Firefox.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// DROP-IN REPLACEMENT for NoFillPasswordInput in PaperTrader.tsx
// Real CSS circle dots — no font rendering issues
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
      {/* Invisible real input — captures all keystrokes */}
      <input
        id={inputId}
        name={`wraith_nofill_${inputId}_${Math.random().toString(36).slice(2)}`}
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
            // Kill blue selection highlight bleeding through
            color: "transparent",
            background: "transparent",
            caretColor: "transparent",
            WebkitTextFillColor: "transparent",
          } as React.CSSProperties
        }
      />

      {/* Visual display layer */}
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
            {/* Real CSS circle dots — not font characters */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {Array.from({ length: value.length }).map((_, i) => (
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
              ))}
            </div>
            {/* Blinking cursor */}
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
// HOT WALLET SETUP
// ─────────────────────────────────────────────────────────────────────────────
function HotWalletSetup({
  onUnlocked,
}: {
  onUnlocked: (kp: Keypair, pub: string) => void;
}) {
  const [mode, setMode] = useState<
    "menu" | "create" | "backup" | "unlock" | "import" | "recover" | "reencrypt"
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
  };

  // Step 1 of create: generate keypair, show backup phrase
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
      const phrase = secretToPhrase(kp.secretKey);
      setBackupPhrase(phrase);
      setPendingKp(kp);
      setMode("backup");
    } catch {
      setErr("Failed to generate wallet");
    }
    setBusy(false);
  };

  // Step 2 of create: user confirmed they saved phrase → encrypt and save
  const doConfirmBackup = async () => {
    if (!pendingKp) return;
    setBusy(true);
    try {
      const phrase = secretToPhrase(pendingKp.secretKey);
      saveHW(await encryptKeypair(pendingKp.secretKey, pw));
      saveRecovery(phrase);
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
      saveRecovery(secretToPhrase(kp.secretKey));
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
      setMode("reencrypt");
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
      saveRecovery(secretToPhrase(pendingKp.secretKey));
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

  // ── MENU
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

  // ── BACKUP PHRASE DISPLAY (after wallet creation)
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
          This is the only way to recover your wallet if you forget your
          password. Store it offline — never screenshot or share it.
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

  // ── RECOVER WITH BACKUP PHRASE
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

  // ── RE-ENCRYPT after recovery
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
          ✓ PHRASE VALID — SET NEW PASSWORD
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

  // ── CREATE / IMPORT / UNLOCK forms
  return (
    <div
      style={{
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      {/* Hidden decoy inputs — confuses Chrome/Edge credential heuristics */}
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

      {/* Export backup phrase if available */}
      {mode === "unlock" && loadRecovery() && (
        <button
          onClick={() => {
            const phrase = loadRecovery();
            if (phrase) {
              setBackupPhrase(phrase);
              setMode("backup");
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
  flash,
}: {
  pos: Position;
  onManualSell: (id: string) => void;
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
        {pos.status === "watching" && (
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
              flexShrink: 0,
            }}
          >
            SELL NOW
          </button>
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
export default function PaperTrader({ selectedMeme }: Props) {
  useConnection();

  const [hotKeypair, setHotKeypair] = useState<Keypair | null>(null);
  const [hotPub, setHotPub] = useState<string | null>(null);
  const [hotBal, setHotBal] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
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
  const [log, setLog] = useState<TradeLog[]>([]);
  const [flashPos, setFlashPos] = useState<string | null>(null);
  const [borderFlash, setBorderFlash] = useState(false);

  const fetchRef = useRef<string | null>(null);
  const balTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const monitorTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sellingRef = useRef<Set<string>>(new Set());
  const hotKeypairRef = useRef<Keypair | null>(null);
  const trailPctRef = useRef(trailPct);

  useEffect(() => {
    hotKeypairRef.current = hotKeypair;
  }, [hotKeypair]);
  useEffect(() => {
    trailPctRef.current = trailPct;
  }, [trailPct]);
  useEffect(() => {
    setLog(loadLog());
    setPositions(loadPositions().filter((p) => p.status === "watching"));
  }, []);

  useEffect(() => {
    if (!hotPub || !hotKeypair) return;
    const fetchBal = async () => {
      try {
        const conn = new Connection(RPC, "confirmed");
        setHotBal(
          (await conn.getBalance(hotKeypair.publicKey)) / LAMPORTS_PER_SOL,
        );
      } catch {
        /**/
      }
    };
    fetchBal();
    balTimer.current = setInterval(fetchBal, 15000);
    return () => {
      if (balTimer.current) clearInterval(balTimer.current);
    };
  }, [hotPub, hotKeypair]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ca = (selectedMeme as any)?.contractAddress || selectedMeme?.keyword;
    if (!ca || ca === fetchRef.current) return;
    fetchRef.current = ca;
    setTokenData(null);
    fetchTokenData(ca).then((d) => {
      if (fetchRef.current === ca) setTokenData(d);
    });
  }, [selectedMeme]);

  const triggerSell = useCallback(
    async (posId: string, reason: "TP" | "SL" | "TRAIL" | "MANUAL") => {
      const kp = hotKeypairRef.current;
      if (!kp || sellingRef.current.has(posId)) return;
      sellingRef.current.add(posId);
      setPositions((prev) =>
        prev.map((p) =>
          p.id === posId ? { ...p, status: "selling" as const } : p,
        ),
      );
      setBorderFlash(true);
      setTimeout(() => setBorderFlash(false), 1000);
      setFlashPos(posId);
      setTimeout(() => setFlashPos(null), 2500);
      playAlert(
        reason === "TP"
          ? "sell_tp"
          : reason === "SL"
            ? "sell_sl"
            : "sell_trail",
      );
      const pos = loadPositions().find((p) => p.id === posId);
      if (!pos) {
        sellingRef.current.delete(posId);
        return;
      }
      try {
        const rawBal = await getRawTokenBalance(kp.publicKey, pos.mint);
        if (rawBal <= 0) throw new Error("No token balance to sell");
        const sig = await jupiterSell(kp, pos.mint, rawBal);
        const exitMcap = await fetchMcap(pos.mint);
        const exitPnl =
          exitMcap > 0
            ? (exitMcap / pos.entryMcap - 1) * 100
            : pos.currentPnlPct;
        setPositions((prev) => {
          const u = prev.map((p) =>
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
          );
          savePositions(u);
          return u;
        });
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
        const updated = [logEntry, ...loadLog()];
        saveLog(updated);
        setLog(updated);
        setStatus({
          msg: `✓ ${reason} — SOLD $${pos.symbol} ${fmtPnl(exitPnl)}`,
          type: "ok",
        });
        setTimeout(() => setStatus(null), 7000);
        setTimeout(async () => {
          try {
            const conn = new Connection(RPC, "confirmed");
            setHotBal((await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL);
          } catch {
            /**/
          }
        }, 4000);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setPositions((prev) => {
          const u = prev.map((p) =>
            p.id === posId ? { ...p, status: "watching" as const } : p,
          );
          savePositions(u);
          return u;
        });
        setStatus({ msg: `✕ Sell failed: ${msg.slice(0, 44)}`, type: "err" });
        setTimeout(() => setStatus(null), 8000);
      }
      sellingRef.current.delete(posId);
    },
    [],
  );

  useEffect(() => {
    const monitor = async () => {
      const watching = loadPositions().filter((p) => p.status === "watching");
      if (!watching.length) return;
      for (const pos of watching) {
        if (sellingRef.current.has(pos.id)) continue;
        try {
          const mcap = await fetchMcap(pos.mint);
          if (!mcap || mcap <= 0) continue;
          const pnlPct = (mcap / pos.entryMcap - 1) * 100;
          const newPeak = Math.max(pos.peakMcap, mcap);
          const trailFrac = (pos.trailPct ?? trailPctRef.current) / 100;
          const trailStop = newPeak * (1 - trailFrac);
          const slMcap = pos.entryMcap * (1 + pos.slPct / 100);
          const tpMcap = pos.entryMcap * pos.tpX;
          const updated = {
            ...pos,
            currentMcap: mcap,
            currentPnlPct: pnlPct,
            peakMcap: newPeak,
            trailStopMcap: trailStop,
          };
          setPositions((prev) => {
            const u = prev.map((p) => (p.id === pos.id ? updated : p));
            savePositions(u);
            return u;
          });
          if (mcap >= tpMcap) triggerSell(pos.id, "TP");
          else if (mcap <= slMcap) triggerSell(pos.id, "SL");
          else if (newPeak > pos.entryMcap && mcap <= trailStop)
            triggerSell(pos.id, "TRAIL");
        } catch {
          /**/
        }
        await sleep(400);
      }
    };
    monitorTimer.current = setInterval(monitor, POLL_MS);
    monitor();
    return () => {
      if (monitorTimer.current) clearInterval(monitorTimer.current);
    };
  }, [triggerSell]);

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
  const canBuy =
    !!hotKeypair &&
    !!ca &&
    !!sym &&
    !isAvoid &&
    parseFloat(amountSol) > 0 &&
    !buying &&
    (hotBal ?? 0) >= parseFloat(amountSol);

  const handleBuy = useCallback(async () => {
    if (!canBuy || !hotKeypair) return;
    setBuying(true);
    setStatus({ msg: "Building swap…", type: "pending" });
    const amt = parseFloat(amountSol);
    try {
      const sig = await jupiterBuy(hotKeypair, ca, Math.floor(amt * 1e9));
      setStatus({ msg: "Confirmed! Reading token balance…", type: "pending" });
      await sleep(3000);
      const rawBal = await getRawTokenBalance(hotKeypair.publicKey, ca);
      const uiBal = await getTokenBalance(hotKeypair.publicKey, ca);
      const entryMcap = tokenData?.mcap || mcap;
      const trailFrac = trailPct / 100;
      const pos: Position = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        symbol: sym!,
        mint: ca,
        entryMcap,
        entryPrice: tokenData?.price || 0,
        tokenAmount: rawBal,
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
      setPositions((prev) => {
        const u = [pos, ...prev];
        savePositions(u);
        return u;
      });
      setStatus({
        msg: `✓ Bought ${uiBal > 0 ? uiBal.toFixed(0) : "?"} $${sym} · auto-sell armed`,
        type: "ok",
      });
      setTab("positions");
      setTimeout(() => setStatus(null), 6000);
      setTimeout(async () => {
        try {
          const conn = new Connection(RPC, "confirmed");
          setHotBal(
            (await conn.getBalance(hotKeypair.publicKey)) / LAMPORTS_PER_SOL,
          );
        } catch {
          /**/
        }
      }, 4000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setStatus({ msg: `✕ ${msg.slice(0, 50)}`, type: "err" });
      setTimeout(() => setStatus(null), 8000);
    }
    setBuying(false);
  }, [
    canBuy,
    hotKeypair,
    ca,
    sym,
    amountSol,
    slPct,
    tpX,
    trailPct,
    mcap,
    tokenData,
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
        onClick={() => setCollapsed((p) => !p)}
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
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
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

      {/* Scrollable content area */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* WALLET SETUP */}
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

            {/* Token */}
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

            {/* SL / TP presets */}
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
                  "Sells if price falls this % below its peak — locks gains",
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
                  val: `-${trailPct}% from peak — locks gains`,
                  color: C.amber,
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
                    <div style={{ textAlign: "right" as const, flexShrink: 0 }}>
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
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
