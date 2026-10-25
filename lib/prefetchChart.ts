"use client";

let timer: ReturnType<typeof setTimeout> | null = null;
let lastFire = 0;
const seen = new Map<string, number>();

/**
 * Warm the server's chart cache when the pointer rests on a row (350ms dwell), so the chart opens fast.
 * Passing over rows cancels earlier ones, and fires are spaced out so we never burn the shared
 * GeckoTerminal allowance (30 req/min) just by moving the mouse.
 */
export function prefetchChart(mint: string, onCurve = false) {
  if (typeof window === "undefined" || !mint) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const now = Date.now();
    if (now - (seen.get(mint) ?? 0) < 60_000) return;
    if (now - lastFire < 4000) return;
    lastFire = now;
    seen.set(mint, now);
    if (seen.size > 200) seen.clear();
    void fetch(`/api/token-chart?address=${encodeURIComponent(mint)}&tf=15m${onCurve ? "&curve=1" : ""}`, { cache: "no-store" }).catch(() => undefined);
  }, 350);
}
