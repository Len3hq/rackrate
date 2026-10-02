"use client";

import { motion } from "motion/react";
import { type Market, impliedRate } from "@/lib/data";
import { usd } from "@/lib/format";

/**
 * The forward curve: for each listed week, the implied $/GPU-hour of the best bid and ask (whisker), against the
 * current index (dashed). Implied rate = floor + LONG price / hours in the week.
 */
export function ForwardCurve({ markets, index }: { markets: Market[]; index: number | null }) {
  const W = 640;
  const H = 200;
  const pts = markets.map((m) => ({ m, bid: impliedRate(m, m.bid), ask: impliedRate(m, m.ask) }));
  const values = pts.flatMap((p) => [p.bid, p.ask]).filter((v): v is number => v !== null);
  if (index !== null) values.push(index);
  if (values.length === 0) return <p className="py-10 text-center text-sm text-muted">No quotes on the books yet.</p>;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const span = Math.max(hi - lo, 0.2);
  lo -= span * 0.35;
  hi += span * 0.35;
  const x = (i: number) => 60 + (pts.length === 1 ? (W - 90) / 2 : (i / (pts.length - 1)) * (W - 100));
  const y = (v: number) => 16 + (1 - (v - lo) / (hi - lo)) * (H - 44);
  const mids = pts.map((p, i) => (p.bid !== null && p.ask !== null ? { x: x(i), y: y((p.bid + p.ask) / 2) } : null));
  const line = mids.filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p!.x},${p!.y}`).join("");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Forward curve of implied H100 rates by week">
      {[0.25, 0.5, 0.75].map((f) => {
        const v = lo + (hi - lo) * f;
        return (
          <g key={f}>
            <line x1={50} x2={W - 10} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={44} y={y(v)} dy="0.32em" textAnchor="end" className="fill-[var(--muted)] font-mono text-[10px]">
              {v.toFixed(2)}
            </text>
          </g>
        );
      })}
      {index !== null && (
        <g>
          <line x1={50} x2={W - 10} y1={y(index)} y2={y(index)} stroke="var(--mint)" strokeDasharray="4 4" />
          <text x={W - 12} y={y(index) - 6} textAnchor="end" className="fill-[var(--mint)] text-[10px]">
            Index now {usd(index)}
          </text>
        </g>
      )}
      <motion.path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
      {pts.map((p, i) => (
        <g key={p.m.series}>
          {p.bid !== null && p.ask !== null && <line x1={x(i)} x2={x(i)} y1={y(p.ask)} y2={y(p.bid)} stroke="var(--accent)" strokeWidth={6} strokeLinecap="round" opacity={0.25} />}
          {p.ask !== null && <circle cx={x(i)} cy={y(p.ask)} r={3.5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={1.5} />}
          {p.bid !== null && <circle cx={x(i)} cy={y(p.bid)} r={3.5} fill="var(--accent)" />}
          <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-[var(--muted)] font-mono text-[10px]">
            {p.m.week.replace(/^\d{4}-/, "")}
          </text>
        </g>
      ))}
    </svg>
  );
}
