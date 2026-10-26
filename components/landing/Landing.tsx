"use client";

import "@/app/site.css";
import "./landing.css";
import Link from "next/link";
import { Bricolage_Grotesque } from "next/font/google";
import ChainLogo from "@/components/ChainLogo";
import { TIERS, TIER_ORDER, type TierKey } from "@/lib/tiers";
import TierGlyph from "@/components/TierGlyph";
import { useEffect, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { CallsTable, ChartReal, HeroStage, PaperExample, TelegramPhone, Ticker, WinsReal, type LandingData } from "./Mocks";
import { CursorGlow, Magnetic, Reveal, TiltFrame } from "./Motion";
import { BOT, CHAINS, FAQ, HERO, PORTAL, SHOWCASE, SOON, TELEGRAM_STEPS } from "./content";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "700", "800"], display: "swap", variable: "--lp-display" });

const TIER_COLOR: Record<TierKey, string> = { GHOST: "#8d8d99", SHADE: "#38bdf8", SPECTER: "#c084fc", WRAITH: "#ff7b3d" };
const NEED: Record<TierKey, string> = { GHOST: "No OMEN needed", SHADE: "Hold 10,000 OMEN", SPECTER: "Hold 100,000 OMEN", WRAITH: "Hold 1,000,000 OMEN" };
const SHOW = [
  ["scanner_view", "Scanner"], ["sniper", "Sniper and auto-buy"], ["auto_sell", "Auto TP / SL / trail"],
  ["ai_score", "AI score"], ["telegram_alerts", "Telegram alerts"], ["live_signals_view", "Live signals"],
] as const;
const SOON_IDS = new Set<string>();
const NAV = [["features", "Features"], ["telegram", "Telegram"], ["omen", "Tiers"], ["soon", "Roadmap"], ["faq", "FAQ"]] as const;
const ROT = ["any chain.", "Solana.", "Base.", "Ethereum.", "BNB Chain.", "Monad.", "Arc.", "Robinhood."] as const;
const ROT_KEY = [null, "solana", "base", "ethereum", "bsc", "monad", "arc", "robinhood"] as const;
const MOCK_TITLE = { scanner: "wraith / calls", chart: "wraith / token", paper: "wraith / paper", wins: "wraith / wins" };

/** Rotates through the networks Wraith really supports. */
function ChainWord() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((n) => (n + 1) % ROT.length), 2300);
    return () => clearInterval(id);
  }, [reduce]);
  const k = ROT_KEY[i];
  return (
    <span className="lp-rot">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={i} className="lp-rot-w" initial={{ y: "70%", opacity: 0, filter: "blur(10px)" }} animate={{ y: "0%", opacity: 1, filter: "blur(0px)" }} exit={{ y: "-70%", opacity: 0, filter: "blur(10px)" }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
          {k && <ChainLogo chain={k} size={44} className="lp-rot-logo" />}{ROT[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Floating glass nav: stays on screen, tracks the section you are in, shows scroll progress. */
function Nav() {
  const [active, setActive] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [prog, setProg] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 24);
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setProg(h > 0 ? Math.min(1, y / h) : 0);
      let cur = "";
      for (const [id] of NAV) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.38) cur = id;
      }
      setActive((p) => (p === cur ? p : cur));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);
  return (
    <header className={`lp-nav${scrolled ? " sc" : ""}`}>
      <span className="lp-prog" style={{ transform: `scaleX(${prog})` }} aria-hidden="true" />
      <div className="lp-nav-pill">
        <Link href="/" className="lp-brand" onClick={() => setOpen(false)}><img src="/logo.svg" alt="" />WRAITH</Link>
        <LayoutGroup id="lp-nav">
          <nav className="lp-nav-links" aria-label="Sections">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} className={active === id ? "on" : ""}>
                {active === id && <motion.span layoutId="lp-pill" className="lp-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <span>{label}</span>
              </a>
            ))}
          </nav>
        </LayoutGroup>
        <Link className="lp-nav-cta" href="/login">Sign in</Link>
        <button type="button" className="lp-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}><i /><i /><i /></button>
      </div>
      {open && (
        <div className="lp-sheet" onClick={() => setOpen(false)}>
          {NAV.map(([id, label]) => (<a key={id} href={`#${id}`}>{label}</a>))}
          <Link href="/login" className="go">Sign in</Link>
        </div>
      )}
    </header>
  );
}

function useLanding() {
  const [data, setData] = useState<LandingData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const r = await fetch("/api/landing", { cache: "no-store" });
        if (r.ok && alive) setData((await r.json()) as LandingData);
      } catch { /* keep last data */ }
      if (alive) setLoading(false);
    };
    void run();
    const id = setInterval(run, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return { data, loading };
}

export default function Landing() {
  const { data, loading } = useLanding();
  const mocks = { scanner: <CallsTable data={data} />, chart: <ChartReal data={data} />, paper: <PaperExample data={data} />, wins: <WinsReal data={data} /> };
  return (
    <div className={`ws lp ${display.variable}`}>
      <CursorGlow />
      <div className="ws-mist" />
      <div className="lp-grid" aria-hidden="true" />

      <Nav />

      <main>
        {/* HERO */}
        <section className="lp-hero">
          <div className="ws-wrap lp-hero-in">
            <div className="lp-hero-copy">
              <span className="ws-eyebrow"><i />{HERO.eyebrow}</span>
              <h1 className="lp-h1">
                <span>{HERO.title[0]}</span>
                <span>{HERO.title[1]}</span>
                <span className="acc"><ChainWord /></span>
              </h1>
              <p className="ws-sub lp-left">{HERO.sub}</p>
              <div className="ws-cta lp-left-cta">
                <Magnetic><Link className="ws-btn primary lg" href="/app">Launch app</Link></Magnetic>
                <Magnetic><a className="ws-btn lg" href={PORTAL} target="_blank" rel="noreferrer">Join Telegram</a></Magnetic>
              </div>
              <p className="ws-note lp-left">{HERO.note}</p>
            </div>
            <HeroStage data={data} loading={loading} />
          </div>
        </section>

        <Ticker data={data} />

        <section className="ws-chains">
          <div className="ws-wrap">
            <p>One balance, seven networks</p>
            <div className="ws-chain-row">
              {CHAINS.map(([k, n]) => (<span key={k} className="ws-chain"><ChainLogo chain={k} size={20} />{n}</span>))}
            </div>
          </div>
        </section>

        {/* SHOWCASE */}
        <section id="features" className="ws-sec">
          <div className="ws-wrap">
            <Reveal><span className="ws-kicker">The product</span>
              <h2 className="ws-h2 lp-h2">Built for the way meme tokens actually move.</h2></Reveal>
            <div className="lp-rows">
              {SHOWCASE.map((f, i) => (
                <div key={f.id} className={`lp-row${i % 2 ? " rev" : ""}`}>
                  <Reveal className="lp-row-copy">
                    <span className="ws-kicker">{f.kicker}</span>
                    <h3>{f.title}</h3>
                    <p>{f.body}</p>
                    <ul>{f.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
                  </Reveal>
                  <Reveal delay={0.1} className="lp-row-art"><TiltFrame title={MOCK_TITLE[f.mock]} tag={f.mock === "paper" ? "real call, example" : "live data"}>{mocks[f.mock]}</TiltFrame></Reveal>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* TELEGRAM */}
        <section id="telegram" className="ws-sec">
          <div className="ws-wrap lp-tg">
            <Reveal className="lp-tg-copy">
              <span className="ws-kicker">Telegram alerts</span>
              <h2 className="ws-h2 lp-h2">Your phone buzzes when it matters.</h2>
              <p className="ws-lead">Signals and win milestones are pushed to Telegram while you are away from your desk. Choose what you get with /settings.</p>
              <ol className="lp-steps">
                {TELEGRAM_STEPS.map(([t, d]) => (<li key={t}><b>{t}</b><span>{d}</span></li>))}
              </ol>
              <div className="ws-cta" style={{ justifyContent: "flex-start" }}>
                <a className="ws-btn primary lg" href={BOT} target="_blank" rel="noreferrer">Connect Telegram</a>
                <a className="ws-btn lg" href={PORTAL} target="_blank" rel="noreferrer">Join the channel</a>
              </div>
              <p className="ws-note" style={{ textAlign: "left" }}>Alerts need the SPECTER tier or above.</p>
            </Reveal>
            <Reveal delay={0.1} className="lp-tg-art"><TelegramPhone data={data} /></Reveal>
          </div>
        </section>

        {/* TIERS */}
        <section id="omen" className="ws-sec">
          <div className="ws-wrap">
            <Reveal>
              <span className="ws-kicker">$OMEN tiers</span>
              <h2 className="ws-h2 lp-h2">Hold OMEN. Pay less. Unlock more.</h2>
              <p className="ws-lead">Your tier comes from the OMEN in your wallet. No staking, no lockups. OMEN has not launched yet, so tiers are not live.</p>
            </Reveal>
            <div className="ws-tiers lp-tiers">
              {TIER_ORDER.map((k, i) => {
                const t = TIERS[k];
                return (
                  <Reveal key={k} delay={i * 0.07} className={`lp-tier-wrap${k === "WRAITH" ? " top" : ""}`}>
                    <div className={`ws-tier${k === "WRAITH" ? " top" : ""}`} style={{ ["--tc" as string]: TIER_COLOR[k] }}>
                      {k === "WRAITH" && <span className="lp-badge">Top tier</span>}
                      <span className="lp-glyph" aria-hidden="true"><TierGlyph tier={k} size={34} /></span>
                      <h3>{t.label}</h3>
                      <span className="need">{NEED[k]}</span>
                      <span className="fee">{t.feeBps === 0 ? "0% trading fee" : `${(t.feeBps / 100).toFixed(t.feeBps % 100 ? 1 : 0)}% trading fee`}</span>
                      <ul>
                        {SHOW.map(([id, label]) => {
                          const on = t.features.find((f) => f.id === id)?.unlocked ?? false;
                          const soon = SOON_IDS.has(id);
                          return <li key={id} className={on ? "" : "off"}><b>{on ? "✓" : "–"}</b>{label}{soon && <em className="lp-soonpill">soon</em>}</li>;
                        })}
                      </ul>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* SOON */}
        <section id="soon" className="ws-sec">
          <div className="ws-wrap">
            <Reveal>
              <span className="ws-kicker">Roadmap</span>
              <h2 className="ws-h2 lp-h2">Coming soon.</h2>
              <p className="ws-lead">Planned, not live. Join the channel to hear first.</p>
            </Reveal>
            <div className="lp-soon">
              {SOON.map((s, i) => (
                <Reveal key={s.title} delay={i * 0.06}>
                  <div className="lp-soon-card">
                    <span className="lp-soonbadge">SOON</span>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
            <div className="ws-cta" style={{ justifyContent: "flex-start", marginTop: 26 }}>
              <a className="ws-btn primary" href={PORTAL} target="_blank" rel="noreferrer">Get launch updates on Telegram</a>
            </div>
          </div>
        </section>

        {/* FAQ + CTA */}
        <section id="faq" className="ws-sec">
          <div className="ws-wrap">
            <Reveal><span className="ws-kicker">FAQ</span><h2 className="ws-h2 lp-h2">Quick answers.</h2></Reveal>
            <div className="ws-faq">
              {FAQ.map(([q, a]) => (<details key={q}><summary>{q}</summary><p>{a}</p></details>))}
            </div>
            <div className="ws-final">
              <h2 className="lp-h2">See it before the crowd does.</h2>
              <p>Open the scanner, add some cash and make your first trade in minutes.</p>
              <div className="ws-cta">
                <Magnetic><Link className="ws-btn primary lg" href="/app">Launch app</Link></Magnetic>
                <a className="ws-btn lg" href={PORTAL} target="_blank" rel="noreferrer">Join Telegram</a>
              </div>
            </div>
            <footer className="ws-foot">
              <span>Wraith © {new Date().getFullYear()} · Not financial advice. Meme tokens are high risk.</span>
              <span><a href={PORTAL} target="_blank" rel="noreferrer">Telegram channel</a> · <a href={BOT} target="_blank" rel="noreferrer">Alerts bot</a> · <Link href="/app">App</Link></span>
            </footer>
          </div>
        </section>
      </main>
    </div>
  );
}
