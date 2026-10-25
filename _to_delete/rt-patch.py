import re,sys,shutil
p=sys.argv[1]
s=open(p,encoding='utf-8').read()
def rep(a,b):
    global s
    assert s.count(a)==1,(a,s.count(a))
    s=s.replace(a,b)
rep('const prevPrice = useRef<number | null>(null);',
'''const prevPrice = useRef<number | null>(null);
  const lastLive = useRef(0);
  const solUsdRef = useRef(0);''')
rep('''          if (!alive) return;
          setSnap(data);
          setSnapState("ready");''','''          if (!alive) return;
          // keep the websocket-driven price/mcap if a live trade landed recently (APIs lag a few seconds)
          setSnap((cur) =>
            cur && Date.now() - lastLive.current < 20_000
              ? { ...data, priceUsd: cur.priceUsd, marketCap: cur.marketCap ?? data.marketCap }
              : data,
          );
          setSnapState("ready");''')
rep('if (alive) timer = setTimeout(run, document.hidden ? 15_000 : 4_000);','if (alive) timer = setTimeout(run, document.hidden ? 15_000 : 2_500);')
rep('''  // ── was this token flagged by Wraith?''','''  // ── SOL/USD for converting live trades ────────────────────────────────
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/sol-price", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { solUsd?: number } | null) => { if (alive && d?.solUsd) solUsdRef.current = d.solUsd; })
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // ── real-time trades: every buy/sell moves price, mcap, chart and the swaps list ──
  useLiveTrades(mint, (t) => {
    const solUsd = solUsdRef.current;
    if (!(solUsd > 0)) return;
    const priceUsd = t.priceSol * solUsd;
    const usd = t.sol * solUsd;
    lastLive.current = Date.now();
    setTrades((prev) => (prev.some((x) => x.id === t.id) ? prev : [{ id: t.id, ts: t.ts, side: t.side, usd, tokens: t.tokens, priceUsd, wallet: t.wallet }, ...prev].slice(0, 80)));
    setSnap((s) => {
      if (!s) return s;
      const bump = <T extends { buys: number; sells: number }>(x: T): T => ({ ...x, buys: x.buys + (t.side === "buy" ? 1 : 0), sells: x.sells + (t.side === "sell" ? 1 : 0) });
      const addVol = (v: number) => v + usd;
      const marketCap = t.marketCapSol ? t.marketCapSol * solUsd : s.supply ? priceUsd * s.supply : s.marketCap;
      return {
        ...s,
        priceUsd,
        marketCap,
        txns: { m5: bump(s.txns.m5), h1: bump(s.txns.h1), h6: bump(s.txns.h6), h24: bump(s.txns.h24) },
        volume: { m5: addVol(s.volume.m5), h1: addVol(s.volume.h1), h6: addVol(s.volume.h6), h24: addVol(s.volume.h24) },
        volume24h: s.volume24h != null ? s.volume24h + usd : s.volume24h,
      };
    });
  });

  // ── was this token flagged by Wraith?''')
# import
m=re.search(r'^import .*$',s,re.M)
idx=[x.end() for x in re.finditer(r'^import .*;$',s,re.M)][-1]
s=s[:idx]+'\nimport { useLiveTrades } from "@/lib/useLiveTrades";'+s[idx:]
open(p,'w',encoding='utf-8').write(s)
print("ok")
