"use client";
import { useEffect, useState } from "react";

const KEY = "wraith_test_mode";
const EVT = "wraith:test-mode";

export function readTestMode(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function setTestMode(on: boolean) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVT));
}
export function useTestMode(): readonly [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(readTestMode());
    const h = () => setOn(readTestMode());
    window.addEventListener(EVT, h);
    window.addEventListener("storage", h);
    return () => { window.removeEventListener(EVT, h); window.removeEventListener("storage", h); };
  }, []);
  return [on, setTestMode] as const;
}
