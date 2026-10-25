p='hooks/useMarket.ts'
s=open(p,encoding='utf-8').read()
a='''  return { tokens, loading, error, stale, updatedAt, refresh: () => void load() };'''
assert s.count(a)==1
s=s.replace(a,'''  // Light live overlay: every ~4s refresh price / mcap / % / volume for the rows on screen (list itself stays as ranked).
  const mintsKey = tokens.map((t) => t.address).join(",");
  useEffect(() => {
    if (!mintsKey) return;
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/market-live?mints=${mintsKey.split(",").slice(0, 30).join(",")}`, { cache: "no-store" });
        if (!r.ok || !alive) return;
        const d: { prices?: Record<string, Partial<MarketToken>> } = await r.json();
        const px = d.prices ?? {};
        if (!alive || !Object.keys(px).length) return;
        setTokens((cur) => cur.map((t) => (px[t.address] ? { ...t, ...px[t.address] } : t)));
        setUpdatedAt(Date.now());
      } catch { /* keep last */ }
    };
    const t = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [mintsKey]);

  return { tokens, loading, error, stale, updatedAt, refresh: () => void load() };''')
open(p,'w',encoding='utf-8').write(s)
print('ok')
