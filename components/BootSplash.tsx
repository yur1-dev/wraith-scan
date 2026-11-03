"use client";

import { useEffect } from "react";

/** Fades out the instant ghost splash (shown only when running as an installed app) once the page is ready. */
export default function BootSplash() {
  useEffect(() => {
    const el = document.getElementById("wx-boot");
    if (!el) return;
    const t1 = setTimeout(() => el.classList.add("out"), 250);
    const t2 = setTimeout(() => { el.hidden = true; }, 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return null;
}
