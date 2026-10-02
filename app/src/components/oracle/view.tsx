"use client";

import { CheckCircle, Circle } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useState } from "react";
import { EPOCH_STATUS, PUBLISHERS, useOracle } from "@/lib/data";
import { deployment } from "@/lib/generated";
import { shortAddr, usd, utcHour } from "@/lib/format";
import { explorer } from "@/lib/wagmi";
import { PriceChart } from "../price-chart";
import { Pill, Skeleton } from "../ui";

const RANGES = [
  { label: "24h", hours: 24 },
  { label: "3d", hours: 72 },
  { label: "7d", hours: 168 },
];

export function OracleView() {
  const [hours, setHours] = useState(72);
  const oracle = useOracle(hours);
  const d = oracle.data;
  const recent = d ? [...d.points].reverse().slice(0, 24) : [];
  const printed = d ? d.points.filter((p) => p.status === 1).length : 0;

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10 md:px-6 md:py-14">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">H100 index oracle</h1>
      <p className="mt-2 max-w-[70ch] text-ink-2">
        One price per hour, finalized onchain from independent publishers. On testnet the index is simulated from committed seeds, so anyone can re-derive every print after the seeds are revealed.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Last print" value={d ? `${usd(d.lastPrice, 4)}/hr` : null} />
        <Stat label="24h average" value={d ? (d.avg24h ? `${usd(d.avg24h, 4)}/hr` : "-") : null} />
        <Stat label="7d average" value={d ? (d.avg7d ? `${usd(d.avg7d, 4)}/hr` : "-") : null} />
        <Stat label={`Printed, last ${hours}h`} value={d ? `${printed} of ${d.points.length}` : null} />
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-card md:p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Hourly index, $/GPU-hour</h2>
          <div className="flex rounded-full bg-surface-2 p-1 text-sm" role="tablist">
            {RANGES.map((r) => (
              <button key={r.hours} role="tab" aria-selected={hours === r.hours} onClick={() => setHours(r.hours)} className={`relative rounded-full px-3 py-1 ${hours === r.hours ? "text-ink" : "text-muted hover:text-ink"}`}>
                {hours === r.hours && <motion.span layoutId="range" className="absolute inset-0 -z-0 rounded-full bg-surface shadow-sm" />}
                <span className="relative">{r.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4">{d ? <PriceChart key={hours} points={d.points} height={300} /> : <Skeleton className="h-[300px] w-full" />}</div>
        {oracle.isError && <p className="text-sm text-muted">Could not reach Monad testnet. Retrying automatically.</p>}
      </section>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_360px]">
        <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_auto] gap-4 border-b border-line px-5 py-3 text-xs text-muted">
            <span>Hour (UTC)</span>
            <span>Status</span>
            <span className="text-right">Price</span>
            <span className="flex gap-3">{PUBLISHERS.map((p) => <span key={p.address} className="w-5 text-center" title={p.name}>{p.name === "Chainlink CRE" ? "A" : p.name.slice(-1)}</span>)}</span>
          </div>
          {!d && <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>}
          {recent.map((p) => (
            <div key={p.epoch} className="grid grid-cols-[1.4fr_1fr_1fr_auto] items-center gap-4 border-b border-line px-5 py-2.5 text-sm last:border-b-0">
              <span className="text-ink-2">{utcHour(p.time).replace(" UTC", "")}</span>
              <span><Pill tone={p.status === 1 ? "mint" : p.status === 0 ? "neutral" : "rose"}>{EPOCH_STATUS[p.status]}</Pill></span>
              <span className="text-right font-mono tnum">{p.price !== null ? usd(p.price, 4) : "-"}</span>
              <span className="flex gap-3">
                {p.submitted.map((s, j) => (
                  <span key={j} className="grid w-5 place-items-center">{s ? <CheckCircle size={16} weight="fill" className="text-mint" /> : <Circle size={16} className="text-muted" />}</span>
                ))}
              </span>
            </div>
          ))}
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2 className="font-medium">Publishers</h2>
            <ul className="mt-3 space-y-3 text-sm">
              {PUBLISHERS.map((p) => (
                <li key={p.address} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-medium">{p.name === "Chainlink CRE" ? "A " : `${p.name.slice(-1)} `}</span>
                    {p.name}
                    <span className="block text-xs text-muted">{p.kind}</span>
                  </span>
                  <a href={`${explorer}/address/${p.address}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent hover:underline">{shortAddr(p.address)}</a>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-5 text-sm shadow-card">
            <h2 className="font-medium">Feed rules</h2>
            {d ? (
              <dl className="mt-3 space-y-2">
                <Rule k="Median of at least" v={`${d.minPublishers} submissions`} />
                <Rule k="Accepted range" v={`${usd(d.minPrice)} to ${usd(d.maxPrice)}`} />
                <Rule k="Jump limit per hour" v={`${d.maxJumpBps / 100}%`} />
                <Rule k="Missing hours" v="Recorded as gaps" />
              </dl>
            ) : (
              <Skeleton className="mt-3 h-24 w-full" />
            )}
            <a href={`${explorer}/address/${deployment.RackOracle}`} target="_blank" rel="noreferrer" className="mt-4 inline-block text-accent hover:underline">RackOracle contract →</a>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p className="text-xs text-muted">{label}</p>
      {value === null ? <Skeleton className="mt-2 h-6 w-24" /> : <p className="mt-1 font-mono text-lg tnum">{value}</p>}
    </div>
  );
}

function Rule({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
