"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("theme");
    } catch {}
    if (!saved) document.documentElement.classList.toggle("dark", mq.matches);
  };
  mq.addEventListener("change", onSystem);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", onSystem);
  };
}

/**
 * Light/dark theme without a flash: an inline script in <head> (theme-script.ts) sets the `dark` class from the
 * saved choice or the system preference before first paint. This hook reads and changes that class:
 * "dark" | "light" on the client, null during server rendering.
 */
export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => null,
  );
  const setTheme = (t: "dark" | "light") => {
    document.documentElement.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem("theme", t);
    } catch {}
  };
  return { theme, setTheme };
}
