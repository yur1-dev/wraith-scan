// app/api/telegram/bot/route.ts

import { NextRequest, NextResponse } from "next/server";

const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function send(chatId: number, text: string) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

function msgStart(name: string) {
  return `👻 <b>WRAITH SIGNALS BOT</b>

Welcome, ${name}.

This bot delivers <b>real-time HOT and ULTRA signals</b> the moment the WRAITH scanner spots them on Solana — contract address, AI score, mcap at detection, and direct swap links included.

<b>━━━ SETUP ━━━</b>

<b>01</b> — Sign in at <a href="https://wraith-scan.vercel.app">wraith-scan.vercel.app</a>
<b>02</b> — Connect your Solana wallet (holding WRAITH)
<b>03</b> — Enable Telegram alerts in the Scanner settings
<b>04</b> — Alerts fire to this chat automatically

Minimum tier: <b>SPECTER · 100,000 WRAITH</b>

<b>━━━ COMMANDS ━━━</b>

/help — alert types explained
/tier — tier requirements &amp; features
/status — check alert setup
/signals — preview what alerts look like

🔗 <a href="https://wraith-scan.vercel.app">Open WRAITH App →</a>
🔗 <a href="https://pump.fun">Buy WRAITH on Pump.fun →</a>

<i>Not financial advice · WRAITH © 2026 · Solana</i>`;
}

function msgHelp() {
  return `👻 <b>WRAITH SIGNALS — HELP</b>

<b>COMMANDS</b>
/start — setup &amp; onboarding
/help — this message
/tier — tier requirements
/status — check alert status
/signals — preview alert format

<b>━━━ ALERT TYPES ━━━</b>

🟢 <b>HOT SIGNAL</b>
AI score ≥ 70. Strong cross-platform traction. Fires before the pump.

🟡 <b>WATCH SIGNAL</b>
Moderate conviction. Worth monitoring.

🔥 <b>ULTRA SIGNAL</b>
Highest tier. Multi-platform + on-chain confirmed.

⭐ <b>CELEB SIGNAL</b>
Celebrity mention detected alongside on-chain activity.

✅ <b>WIN ALERT</b>
Fires when a tracked token hits 2× from spotted price.

Enable alerts at <a href="https://wraith-scan.vercel.app">wraith-scan.vercel.app</a>
Requires SPECTER tier (100,000 WRAITH minimum).`;
}

function msgTier() {
  return `👻 <b>WRAITH TIER REQUIREMENTS</b>

◌ <b>GHOST</b> — Free, no tokens
  Scanner view only · 1.5% fee

◈ <b>SHADE</b> — 10,000 WRAITH
  Sniper / Auto-buy · Hot Wallet
  1.0% fee

◆ <b>SPECTER</b> — 100,000 WRAITH
  Everything in SHADE
  AI Score · <b>Live Signals ✓</b>
  Auto TP / SL / Trailing stop
  <b>Telegram Alerts ✓</b>
  0.5% fee

⬡ <b>WRAITH</b> — 1,000,000 WRAITH
  Everything unlocked
  <b>0% fee — trade completely free</b>

Tier is auto-detected when you connect your wallet.

🔗 <a href="https://pump.fun">Buy WRAITH on Pump.fun ↗</a>
🔗 <a href="https://wraith-scan.vercel.app">Open App →</a>`;
}

function msgStatus() {
  return `👻 <b>ALERT STATUS</b>

The bot is <b>online</b> and ready to push signals.

<b>To receive alerts:</b>
· Signed in to wraith-scan.vercel.app
· Solana wallet connected (holding WRAITH)
· At least 100,000 WRAITH (SPECTER tier)
· Telegram alerts enabled in Scanner settings

<b>If alerts stopped:</b>
· Re-enable in Scanner settings panel
· Check WRAITH balance hasn't dropped below 100K
· Make sure you're still signed in

🔗 <a href="https://wraith-scan.vercel.app">Open WRAITH App →</a>`;
}

function msgSignals() {
  return `👻 <b>EXAMPLE ALERTS</b>

<b>── Entry signal ──</b>

🟢 <b>HOT SIGNAL — PEPELON — $PEPELON</b>

💰 <b>MCAP:</b> $18.4K
📈 <b>AI Score:</b> 84/100
🔥 <b>Signal Tier:</b> ULTRA
📡 <b>Sources:</b> PUMPFUN · TWITTER · TELEGRAM

🔗 <a href="#">DexScreener</a> • <a href="#">Pump</a> • <a href="#">Swap</a> • <a href="#">BullX</a>

<code>7xK2mNvRqL...f9Rp</code>

<b>── Win alert ──</b>

✅ <b>WRAITH WIN — $DOGEAI</b>
📊 4.70x from spotted price
Spotted:  $9.1K at 02:14 PM
Now:      $42.8K
AI Score: ████████░░ 76/100

🔗 <a href="https://wraith-scan.vercel.app">Enable alerts in the app →</a>`;
}

function msgUnknown(cmd: string) {
  return `Unknown command: <code>${cmd}</code>

/start · /help · /tier · /status · /signals`;
}

export async function POST(req: NextRequest) {
  let update: {
    message?: {
      chat: { id: number; type: string };
      from?: { first_name?: string };
      text?: string;
    };
  };

  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const msg = update.message;
  if (!msg?.text) return NextResponse.json({ ok: true });

  const chatType = msg.chat.type;
  const chatId = msg.chat.id;
  const name = msg.from?.first_name ?? "trader";
  const cmd = msg.text.trim().split(" ")[0].split("@")[0].toLowerCase();

  // Groups only receive pushed signals — ignore all commands
  if (chatType !== "private") {
    return NextResponse.json({ ok: true });
  }

  if (!cmd.startsWith("/")) return NextResponse.json({ ok: true });

  switch (cmd) {
    case "/start":
      await send(chatId, msgStart(name));
      break;
    case "/help":
      await send(chatId, msgHelp());
      break;
    case "/tier":
      await send(chatId, msgTier());
      break;
    case "/status":
      await send(chatId, msgStatus());
      break;
    case "/signals":
      await send(chatId, msgSignals());
      break;
    default:
      await send(chatId, msgUnknown(cmd));
      break;
  }

  return NextResponse.json({ ok: true });
}
