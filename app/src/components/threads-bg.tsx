"use client";

import { useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useTheme } from "@/lib/theme";

const Threads = dynamic(() => import("./reactbits/Threads"), { ssr: false });

/** React Bits "Threads" (WebGL) in the brand violet, which reads as a bundle of rate lines. Static under reduced motion. */
export function ThreadsBackground({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  const { theme } = useTheme();
  if (theme === null || reduce) return null;
  const color: [number, number, number] = theme === "dark" ? [0.627, 0.545, 1] : [0.333, 0.196, 0.878];
  return (
    <div className={`pointer-events-none ${className}`} aria-hidden="true">
      <Threads color={color} amplitude={1.1} distance={0.15} />
    </div>
  );
}
