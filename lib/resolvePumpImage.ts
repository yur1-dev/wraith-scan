// lib/resolvePumpImage.ts
// Resolves a token's logo from pump.fun's own API when DexScreener has
// nothing yet (brand-new / not-migrated coins). Cached in-memory so repeat
// renders of the same mint (scanner list re-renders, hover, etc.) don't
// refire the fetch.

const _imgCache = new Map<string, string | null>(); // null = resolved, no image found
const _inflight = new Map<string, Promise<string | null>>();

async function fetchFromPumpApi(mint: string): Promise<string | null> {
  try {
    const res = await fetch(`https://frontend-api.pump.fun/coins/${mint}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.image_uri || null;
  } catch {
    return null;
  }
}

export async function resolvePumpImage(mint: string): Promise<string | null> {
  if (_imgCache.has(mint)) return _imgCache.get(mint)!;
  if (_inflight.has(mint)) return _inflight.get(mint)!;

  const p = fetchFromPumpApi(mint).then((url) => {
    _imgCache.set(mint, url);
    _inflight.delete(mint);
    return url;
  });
  _inflight.set(mint, p);
  return p;
}

// Optional sync peek — used by components that want the cached value
// without awaiting (avoids a flash of the letter avatar on repeat renders).
export function peekPumpImage(mint: string): string | null | undefined {
  return _imgCache.get(mint); // undefined = not yet resolved
}
