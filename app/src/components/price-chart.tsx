"use client";

import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usd, utcHour } from "@/lib/format";

export interface ChartPoint {
  time: number;
  price: number | null; // null = gap (not interpolated)
  /** Optional range shaded behind the line (e.g. the spread across providers). */
  low?: number;
  high?: number;
}

/**
 * Line chart of the hourly index. Missing epochs break the line instead of being interpolated, matching how the
 * oracle treats gaps. Hover or touch shows the exact print.
 */
export function PriceChart({
  points,
  height = 240,
  compact = false,
  label = "Hourly H100 index price",
  timeLabel = utcHour,
  decimals = 4,
  dots = false,
}: {
  points: ChartPoint[];
  height?: number;
  compact?: boolean;
  label?: string;
  timeLabel?: (time: number) => string;
  decimals?: number;
  /** Mark every point (for short daily series). */
  dots?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const pad = compact ? { t: 8, r: 4, b: 8, l: 4 } : { t: 16, r: 12, b: 28, l: 48 };
  const geo = useMemo(() => {
    const prices = points.flatMap((p) => [p.price, p.low ?? null, p.high ?? null]).filter((p): p is number => p !== null);
    if (prices.length === 0 || width === 0) return null;
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    const span = Math.max(hi - lo, 0.05);
    lo -= span * 0.15;
    hi += span * 0.15;
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;
    const x = (i: number) => pad.l + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
    const y = (p: number) => pad.t + (1 - (p - lo) / (hi - lo)) * h;
    let line = "";
    let area = "";
    let segStart = -1;
    points.forEach((p, i) => {
      if (p.price === null) {
        if (segStart >= 0) area += `L${x(i - 1)},${pad.t + h}L${x(segStart)},${pad.t + h}Z`;
        segStart = -1;
        return;
      }
      const cmd = segStart < 0 ? "M" : "L";
      if (segStart < 0) segStart = i;
      line += `${cmd}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`;
      area += `${cmd}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`;
    });
    if (segStart >= 0) area += `L${x(points.length - 1)},${pad.t + h}L${x(segStart)},${pad.t + h}Z`;
    const ticks = Array.from({ length: 4 }, (_, k) => lo + ((hi - lo) * (k + 0.5)) / 4);
    const banded = points.every((p) => p.low !== undefined && p.high !== undefined);
    const band = banded
      ? points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.high as number).toFixed(1)}`).join("") +
        [...points].reverse().map((p, k) => `L${x(points.length - 1 - k).toFixed(1)},${y(p.low as number).toFixed(1)}`).join("") +
        "Z"
      : "";
    return { line, area, band, x, y, ticks, h, w };
  }, [points, width, height, pad.l, pad.r, pad.t, pad.b]);

  const onMove = (clientX: number) => {
    if (!geo || !ref.current) return;
    const rel = clientX - ref.current.getBoundingClientRect().left - pad.l;
    const i = Math.round((rel / geo.w) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  const hp = hover !== null ? points[hover] : null;
  const gradId = compact ? "pc-grad-c" : "pc-grad";

  return (
    <div
      ref={ref}
      className="relative w-full select-none"
      style={{ height }}
      onMouseMove={(e) => onMove(e.clientX)}
      onMouseLeave={() => setHover(null)}
      onTouchMove={(e) => onMove(e.touches[0].clientX)}
      onTouchEnd={() => setHover(null)}
    >
      {geo && (
        <svg width={width} height={height} className="absolute inset-0 overflow-visible" role="img" aria-label={label}>
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {!compact &&
            geo.ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={width - pad.r} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--line)" />
                <text x={pad.l - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--muted)] font-mono text-[10px]">
                  {t.toFixed(2)}
                </text>
              </g>
            ))}
          {geo.band && <motion.path d={geo.band} fill="var(--accent)" fillOpacity={0.1} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.2 }} />}
          <motion.path d={geo.band ? "" : geo.area} fill={`url(#${gradId})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.3 }} />
          <motion.path
            d={geo.line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={compact ? 1.75 : 2}
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          />
          {dots &&
            points.map((p, i) =>
              p.price === null ? null : <circle key={p.time} cx={geo.x(i)} cy={geo.y(p.price)} r={2.5} fill="var(--accent)" />,
            )}
          {hp && hp.price !== null && hover !== null && (
            <g>
              <line x1={geo.x(hover)} x2={geo.x(hover)} y1={pad.t} y2={pad.t + geo.h} stroke="var(--line-strong)" strokeDasharray="3 3" />
              <circle cx={geo.x(hover)} cy={geo.y(hp.price)} r={4} fill="var(--mint)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {hp && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-xl border border-line-strong bg-surface px-2.5 py-1.5 text-xs shadow-card"
          style={{ left: Math.min(Math.max(geo ? geo.x(hover ?? 0) : 0, 70), width - 70) }}
        >
          <p className="font-mono font-medium tnum">{hp.price === null ? "Gap (not printed)" : `${usd(hp.price, decimals)}/hr`}</p>
          {hp.low !== undefined && hp.high !== undefined && (
            <p className="text-muted tnum">
              Range {usd(hp.low, decimals)} to {usd(hp.high, decimals)}
            </p>
          )}
          <p className="text-muted">{timeLabel(hp.time)}</p>
        </div>
      )}
    </div>
  );
}
