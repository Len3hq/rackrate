"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { liveWeekly, useMarkets } from "@/lib/data";
import { usd } from "@/lib/format";
import { Reveal } from "../reveal";

export const Section = ({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) => (
  <section id={id} className={`mx-auto max-w-[1280px] px-4 md:px-6 ${className}`}>
    {children}
  </section>
);

// ---------------------------------------------------------------------------------------------------------------

/** The 40-second launch video. Nothing downloads until the visitor presses play (preload none, poster only). */
export function LaunchVideo() {
  return (
    <Section id="video" className="mt-28">
      <Reveal>
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-5xl md:leading-[1.05]">Rackrate in 40 seconds.</h2>
        <p className="mt-4 max-w-[60ch] text-base leading-relaxed text-ink-2 md:text-lg">
          Who it is for, how a fully collateralized week works, and how it settles on an hourly index.
        </p>
      </Reveal>
      <Reveal delay={0.08}>
        <div className="mt-10 overflow-hidden rounded-2xl border border-line-strong bg-[#0d0b12] shadow-card">
          <video
            className="block aspect-video w-full"
            controls
            playsInline
            preload="none"
            poster="/video/rackrate-launch-poster.jpg"
            aria-label="Rackrate launch video"
          >
            <source src="/video/rackrate-launch.mp4" type="video/mp4" />
          </video>
        </div>
        <p className="mt-3 text-xs text-muted">Music: Ramzuto, &quot;Vida Loca&quot;.</p>
      </Reveal>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const FLOOR = 1;
const CAP = 5;
const HOURS = 168;

/** Interactive payoff: what a GPU owner earns for one GPU-week, hedged versus unhedged, for any weekly average. */
export function PayoffExplorer() {
  const markets = useMarkets();
  const now = Math.floor(Date.now() / 1000);
  const live = liveWeekly(markets.data, now)[0];
  const bid = live?.bid ?? 466;
  const [avg, setAvg] = useState(3.2);

  const clamp = (x: number) => Math.min(Math.max(x, FLOOR), CAP);
  const unhedged = avg * HOURS;
  const shortPays = (CAP - clamp(avg)) * HOURS;
  const netCost = (CAP - FLOOR) * HOURS - bid; // collateral in minus LONG sale proceeds
  const hedged = unhedged + shortPays - netCost;
  const locked = FLOOR + bid / HOURS;

  const W = 560;
  const H = 220;
  const xs = (a: number) => 36 + ((a - 0.5) / 5.5) * (W - 48);
  const ys = (v: number) => H - 24 - (v / (6 * HOURS)) * (H - 40);
  const path = useMemo(() => {
    const pts = Array.from({ length: 56 }, (_, i) => 0.5 + (i / 55) * 5.5);
    const un = pts.map((a, i) => `${i ? "L" : "M"}${xs(a).toFixed(1)},${ys(a * HOURS).toFixed(1)}`).join("");
    const he = pts
      .map((a, i) => `${i ? "L" : "M"}${xs(a).toFixed(1)},${ys(a * HOURS + (CAP - clamp(a)) * HOURS - netCost).toFixed(1)}`)
      .join("");
    return { un, he };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netCost]);

  return (
    <Section className="mt-28">
      <Reveal>
        <div className="grid gap-10 rounded-2xl border border-line bg-surface p-6 shadow-card md:grid-cols-[1fr_1.25fr] md:p-10">
          <div className="flex flex-col">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">Before and after</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Know the outcome before the week starts.</h2>
            <p className="mt-4 max-w-[48ch] leading-relaxed text-ink-2">
              Drag the weekly average. A hedged GPU owner earns about {usd(locked)}/hr whatever happens between the {usd(FLOOR, 0)} floor and {usd(CAP, 0)} cap.
            </p>
            <label htmlFor="avg" className="mt-8 text-sm text-muted">
              Weekly average H100 rate
            </label>
            <div className="mt-2 flex items-center gap-4">
              <input
                id="avg"
                type="range"
                min={0.5}
                max={6}
                step={0.05}
                value={avg}
                onChange={(e) => setAvg(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-[var(--accent)]"
              />
              <span className="w-24 shrink-0 text-right font-mono text-lg tnum">{usd(avg)}/hr</span>
            </div>
            <dl className="mt-8 grid grid-cols-2 gap-6">
              <div>
                <dt className="text-sm text-muted">Unhedged week</dt>
                <dd className="mt-1 font-mono text-2xl tnum">{usd(unhedged, 0)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Hedged week</dt>
                <dd className="mt-1 font-mono text-2xl text-mint tnum">{usd(hedged, 0)}</dd>
              </div>
            </dl>
            <p className="mt-auto pt-8 text-xs leading-relaxed text-muted">
              One GPU for 168 hours, hedged at {live ? "the live best bid" : "an example bid"} of {usd(bid)}. Outside the range the hedge is partial.
            </p>
          </div>
          <div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Weekly revenue, hedged versus unhedged">
              <rect x={xs(FLOOR)} y={8} width={xs(CAP) - xs(FLOOR)} height={H - 32} fill="var(--accent-soft)" rx={8} />
              <text x={xs(FLOOR) + 8} y={24} className="fill-[var(--accent)] text-[11px]">Protected range</text>
              <path d={path.un} fill="none" stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 5" />
              <path d={path.he} fill="none" stroke="var(--mint)" strokeWidth={2.5} />
              <line x1={xs(avg)} x2={xs(avg)} y1={8} y2={H - 24} stroke="var(--line-strong)" />
              <motion.circle cx={xs(avg)} cy={ys(unhedged)} r={5} fill="var(--surface)" stroke="var(--muted)" strokeWidth={2} />
              <motion.circle cx={xs(avg)} cy={ys(hedged)} r={6} fill="var(--mint)" stroke="var(--surface)" strokeWidth={2} />
              {[1, 2, 3, 4, 5].map((a) => (
                <text key={a} x={xs(a)} y={H - 6} textAnchor="middle" className="fill-[var(--muted)] font-mono text-[11px]">
                  ${a}
                </text>
              ))}
            </svg>
            <div className="mt-3 flex gap-5 text-xs text-muted">
              <span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 bg-mint" /> Hedged</span>
              <span className="inline-flex items-center gap-2"><span className="h-0 w-5 border-t-2 border-dashed border-[var(--muted)]" /> Unhedged</span>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
