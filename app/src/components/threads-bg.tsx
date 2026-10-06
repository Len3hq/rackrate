"use client";

import { useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useTheme } from "@/lib/theme";

const Threads = dynamic(() => import("./reactbits/Threads"), { ssr: false });

/**
 * React Bits "Threads" (WebGL) in the brand violet, which reads as a bundle of rate lines. It starts only once the
 * page is idle, and only on screens and devices that can afford a full-screen shader: on phones, low-core devices,
 * Save-Data connections or reduced motion the section keeps its static gradient instead.
 */
export function ThreadsBackground({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  const { theme } = useTheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    const capable = window.matchMedia("(min-width: 768px)").matches && (nav.hardwareConcurrency ?? 4) >= 4 && !nav.connection?.saveData;
    if (!capable) return;
    const start = () => setReady(true);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(start, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(start, 1200);
    return () => clearTimeout(t);
  }, []);

  if (!ready || theme === null || reduce) return null;
  const color: [number, number, number] = theme === "dark" ? [0.627, 0.545, 1] : [0.333, 0.196, 0.878];
  return (
    <div className={`pointer-events-none ${className}`} aria-hidden="true">
      <Threads color={color} amplitude={1.1} distance={0.15} />
    </div>
  );
}
