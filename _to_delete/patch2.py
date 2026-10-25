p='components/TokenPanel.tsx'
s=open(p,encoding='utf-8').read()
b='  // ── SOL/USD for converting live trades'
assert s.count(b)==1
s=s.replace(b,'''  // ── exact on-chain pool price (PumpSwap): updates ~every second, no indexer lag ──
  const poolAddr = snap?.pairAddress ?? null;
  const poolDex = snap?.dexId ?? "";
  useEffect(() => {
    if (!mint || !poolAddr || !/pump/i.test(poolDex)) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const r = await fetch(`/api/live-price?mint=${encodeURIComponent(mint)}&pool=${encodeURIComponent(poolAddr)}`, { cache: "no-store" });
        if (r.status === 404) return; // unsupported pool layout: stop polling
        if (r.ok && alive) {
          const d: { priceUsd?: number; solUsd?: number } = await r.json();
          if (d.priceUsd && d.priceUsd > 0) {
            if (d.solUsd) solUsdRef.current = d.solUsd;
            lastLive.current = Date.now();
            setSnap((cur) => (cur ? { ...cur, priceUsd: d.priceUsd!, marketCap: cur.supply ? d.priceUsd! * cur.supply : cur.marketCap } : cur));
          }
        }
      } catch { /* retry */ }
      if (alive) timer = setTimeout(run, document.hidden ? 5000 : 1200);
    };
    void run();
    return () => { alive = false; clearTimeout(timer); };
  }, [mint, poolAddr, poolDex]);

'''+b)
open(p,'w',encoding='utf-8').write(s)
print('ok')
