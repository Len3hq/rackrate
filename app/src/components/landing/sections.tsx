"use client";

import { ArrowsLeftRight, Broadcast, CheckCircle, Circle, Lightning, ShieldCheck, Stack } from "@phosphor-icons/react";
import { motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PUBLISHERS, liveWeekly, useMarkets, useOracle } from "@/lib/data";
import { usd } from "@/lib/format";
import CountUp from "../reactbits/CountUp";
import SpotlightCard from "../reactbits/SpotlightCard";
import { PriceChart } from "../price-chart";
import { Reveal } from "../reveal";
import { Skeleton } from "../ui";

const Section = ({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) => (
  <section id={id} className={`mx-auto max-w-[1280px] px-4 md:px-6 ${className}`}>
    {children}
  </section>
);

// ---------------------------------------------------------------------------------------------------------------

export function StatsBand() {
  const oracle = useOracle(168);
  const markets = useMarkets();
  const now = Math.floor(Date.now() / 1000);
  const weeks = liveWeekly(markets.data, now).length;
  const items = [
    { label: "H100 index now", value: oracle.data?.lastPrice, prefix: "$", suffix: "/hr", digits: 4 },
    { label: "7-day average", value: oracle.data?.avg7d ?? undefined, prefix: "$", suffix: "/hr", digits: 4 },
    { label: "Weeks open for trading", value: markets.data ? weeks : undefined, digits: 0 },
    { label: "Independent publishers", value: PUBLISHERS.length, digits: 0 },
  ];
  return (
    <Section className="mt-6">
      <div className="grid grid-cols-2 gap-y-8 border-y border-line py-8 md:grid-cols-4 md:divide-x md:divide-line">
        {items.map((it) => (
          <div key={it.label} className="px-1 md:px-6">
            <p className="font-mono text-2xl font-medium tracking-tight tnum md:text-[28px]">
              {it.value === undefined ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <>
                  {it.prefix}
                  <CountUp to={Number(it.value.toFixed(it.digits))} from={0} duration={1.4} />
                  {it.suffix && <span className="text-base text-muted">{it.suffix}</span>}
                </>
              )}
            </p>
            <p className="mt-1 text-sm text-muted">{it.label}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export function Audiences() {
  const cells = [
    {
      img: "/images/gpu-cluster.jpg",
      alt: "Rows of GPU servers in a data centre",
      who: "For GPU owners",
      title: "Sell next week's hours at today's price.",
      body: "Hedge mints a LONG and SHORT pair, sells the LONG on Kuru and hands you the SHORT. If rental rates fall, the SHORT pays the difference.",
      cta: "Hedge revenue",
    },
    {
      img: "/images/server-racks.jpg",
      alt: "Server racks in a cooled machine room",
      who: "For AI teams",
      title: "Cap what next week's compute costs.",
      body: "Buy LONG for the weeks you plan to train. If rental rates rise, LONG pays the difference, so your effective rate stays where you bought it.",
      cta: "Lock compute cost",
    },
  ];
  return (
    <Section className="mt-28">
      <Reveal>
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-5xl md:leading-[1.05]">Two sides of every GPU-hour.</h2>
        <p className="mt-4 max-w-[60ch] text-base leading-relaxed text-ink-2 md:text-lg">
          Rental prices for H100s move week to week. Rackrate lets each side fix its rate in advance.
        </p>
      </Reveal>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {cells.map((c, i) => (
          <Reveal key={c.who} delay={i * 0.08} className="h-full">
            <Link href="/trade" className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="relative aspect-[16/10] overflow-hidden">
                <Image src={c.img} alt={c.alt} fill sizes="(min-width: 768px) 50vw, 100vw" className="photo-tone object-cover transition duration-700 ease-out-expo group-hover:scale-[1.03]" />
                <div className="photo-tint absolute inset-0" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0d0b12]/85 via-[#0d0b12]/25 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6 text-[#f3f1f9] md:p-8">
                  <p className="text-sm text-[#cfc8f5]">{c.who}</p>
                  <h3 className="mt-1 max-w-md text-2xl font-semibold tracking-tight md:text-3xl">{c.title}</h3>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-4 p-6 md:flex-row md:items-end md:justify-between md:p-8">
                <p className="max-w-[52ch] text-sm leading-relaxed text-ink-2">{c.body}</p>
                <span className="shrink-0 text-sm font-medium text-accent transition group-hover:translate-x-0.5">{c.cta} →</span>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
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
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Know the outcome before the week starts.</h2>
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

// ---------------------------------------------------------------------------------------------------------------

const STEPS = [
  { name: "Mint", body: "Deposit the full range in rrUSD to mint one LONG and one SHORT. No leverage and no margin calls." },
  { name: "Trade", body: "LONG trades on Kuru's onchain order book. The HedgeRouter mints and sells a multi-week ladder in one transaction." },
  { name: "Print", body: "Three publishers, one on Chainlink CRE, submit the index every hour. The median is finalized onchain." },
  { name: "Settle", body: "After 168 hourly prints, LONG pays the average above the floor and SHORT pays the rest up to the cap." },
];

export function Lifecycle() {
  return (
    <Section className="mt-28">
      <Reveal>
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-5xl md:leading-[1.05]">From mint to settlement in one week.</h2>
      </Reveal>
      <div className="relative mt-14">
        {/* The rate line from the logo, drawn as the section scrolls into view. */}
        <svg viewBox="0 0 1000 60" preserveAspectRatio="none" className="absolute left-0 right-0 top-2 hidden h-14 w-full md:block" aria-hidden="true">
          <motion.path
            d="M0 50 H180 V10 H330 V45 H520 V22 H760 V30 H1000"
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
        <ol className="grid gap-10 md:grid-cols-4 md:gap-8 md:pt-24">
          {STEPS.map((s, i) => (
            <Reveal key={s.name} delay={0.15 + i * 0.12}>
              <li className="border-l border-line pl-5 md:border-l-0 md:pl-0">
                <p className="font-mono text-sm text-accent">{s.name}</p>
                <p className="mt-3 max-w-[34ch] leading-relaxed text-ink-2">{s.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export function OracleSection() {
  const oracle = useOracle(48);
  const latest = oracle.data?.points.at(-1);
  return (
    <Section className="mt-28">
      <div className="grid items-stretch gap-6 md:grid-cols-[0.9fr_1.1fr]">
        <Reveal className="relative min-h-[320px] overflow-hidden rounded-2xl border border-line">
          <Image src="/images/rack-closeup.jpg" alt="Cabled servers in a data centre rack" fill sizes="(min-width: 768px) 45vw, 100vw" className="photo-tone object-cover" />
          <div className="photo-tint absolute inset-0" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0d0b12]/80 to-transparent" />
          <p className="absolute bottom-0 p-6 text-2xl font-semibold leading-tight tracking-tight text-[#f3f1f9] md:p-8 md:text-3xl">
            Settlement uses the median of independent publishers. Never one feed.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-6 shadow-card md:p-8">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">Oracle</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">An hourly H100 index, checked onchain.</h2>
            <p className="mt-3 max-w-[56ch] leading-relaxed text-ink-2">
              Each hour is finalized from at least two submissions, checked against bounds and a jump limit. Hours without enough data are recorded as gaps and never filled in.
            </p>
            <div className="mt-6">{oracle.data ? <PriceChart points={oracle.data.points} height={140} compact /> : <Skeleton className="h-[140px] w-full" />}</div>
            <ul className="mt-6 space-y-2">
              {PUBLISHERS.map((p, i) => (
                <li key={p.address} className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-2.5 text-sm">
                  <span className="flex items-center gap-3">
                    <Broadcast size={16} className="text-accent" />
                    <span className="font-medium">{p.name}</span>
                    <span className="hidden text-muted sm:inline">{p.kind}</span>
                  </span>
                  {latest ? (
                    latest.submitted[i] ? (
                      <span className="inline-flex items-center gap-1.5 text-mint"><CheckCircle size={15} weight="fill" /> Printed last hour</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-muted"><Circle size={15} /> No submission</span>
                    )
                  ) : (
                    <Skeleton className="h-4 w-28" />
                  )}
                </li>
              ))}
            </ul>
            <Link href="/oracle" className="mt-6 text-sm font-medium text-accent hover:underline">Inspect every hour →</Link>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export function Features() {
  return (
    <Section className="mt-28">
      <Reveal>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">Why Monad</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight md:text-5xl md:leading-[1.05]">Every piece runs onchain.</h2>
      </Reveal>
      <div className="mt-10 grid gap-4 md:grid-cols-6">
        <Reveal className="md:col-span-4">
          <SpotlightCard className="h-full p-7 md:p-9">
            <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,var(--accent-soft),transparent_60%)]" aria-hidden="true" />
            <div className="relative">
              <ArrowsLeftRight size={26} className="text-accent" />
              <h3 className="mt-5 text-xl font-semibold tracking-tight md:text-2xl">A four-week hedge is one transaction.</h3>
              <p className="mt-2 max-w-[56ch] leading-relaxed text-ink-2">
                The HedgeRouter mints each week, sells the LONG side into the book and returns your SHORT positions together. Fill-or-kill: either every week fills at your limit or nothing happens.
              </p>
            </div>
          </SpotlightCard>
        </Reveal>
        <Reveal className="md:col-span-2" delay={0.06}>
          <SpotlightCard className="h-full p-7">
            <ShieldCheck size={26} className="text-mint" />
            <h3 className="mt-5 text-lg font-semibold tracking-tight">Fully collateralized</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">Every pair is backed by the full range in rrUSD. The most you can lose is known before you trade.</p>
          </SpotlightCard>
        </Reveal>
        <Reveal className="md:col-span-2" delay={0.1}>
          <SpotlightCard className="h-full p-7">
            <Stack size={26} className="text-accent" />
            <h3 className="mt-5 text-lg font-semibold tracking-tight">Kuru order book</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">Each week has its own LONG/rrUSD market on Kuru, a fully onchain central limit order book.</p>
          </SpotlightCard>
        </Reveal>
        <Reveal className="md:col-span-2" delay={0.14}>
          <SpotlightCard className="h-full bg-[linear-gradient(160deg,var(--accent),#2a1680)] p-7 text-[#f3f1f9]">
            <Lightning size={26} weight="fill" className="text-[#6cf2be]" />
            <h3 className="mt-5 text-lg font-semibold tracking-tight">Cheap enough to print hourly</h3>
            <p className="mt-2 text-sm leading-relaxed text-[#e4defc]">Monad&apos;s fast blocks and low fees let every hour of the index be submitted, checked and finalized onchain.</p>
          </SpotlightCard>
        </Reveal>
        <Reveal className="md:col-span-2" delay={0.18}>
          <SpotlightCard className="h-full p-7">
            <Broadcast size={26} className="text-accent" />
            <h3 className="mt-5 text-lg font-semibold tracking-tight">Chainlink CRE publisher</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">One of the three publishers is a Chainlink Runtime Environment workflow that computes the price and delivers it onchain as a report.</p>
          </SpotlightCard>
        </Reveal>
      </div>
    </Section>
  );
}
