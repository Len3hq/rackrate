"use client";

import { ArrowUpRight, Check } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { impliedRate, liveWeekly, useMarkets, useOracle } from "@/lib/data";
import { countdown, usd, utcDay } from "@/lib/format";
import { explorer } from "@/lib/wagmi";
import { Pill, Skeleton } from "../ui";
import { ForwardCurve } from "./curve";
import { type Mode, Ticket } from "./ticket";

export function TradeView() {
  const markets = useMarkets();
  const oracle = useOracle(24);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [mode, setMode] = useState<Mode>("hedge");
  const [selected, setSelected] = useState<Address[]>([]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  const weeks = liveWeekly(markets.data, now);
  // Default selection: the next week to start.
  useEffect(() => {
    if (selected.length === 0 && weeks.length > 0) setSelected([weeks[0].series]);
  }, [weeks, selected.length]);

  const toggle = (s: Address) => setSelected((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10 md:px-6 md:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">H100 weekly forwards</h1>
          <p className="mt-2 text-ink-2">Each week settles on the average of 168 hourly index prints, from Monday 00:00 UTC.</p>
        </div>
        <div className="flex gap-8">
          <Stat label="Index now" value={oracle.data ? `${usd(oracle.data.lastPrice, 4)}/hr` : null} />
          <Stat label="24h average" value={oracle.data?.avg24h ? `${usd(oracle.data.avg24h, 4)}/hr` : oracle.data ? "-" : null} />
        </div>
      </div>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-card md:p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Forward curve</h2>
              <span className="flex items-center gap-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" /> Bid</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-accent" /> Ask</span>
              </span>
            </div>
            <div className="mt-4">
              {markets.data ? <div className="-mx-2 overflow-x-auto px-2"><div className="min-w-[520px]"><ForwardCurve markets={weeks} index={oracle.data?.lastPrice ?? null} /></div></div> : <Skeleton className="h-[200px] w-full" />}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <div className="hidden grid-cols-[2.5rem_1.3fr_1fr_1fr_1fr] gap-4 border-b border-line px-5 py-3 text-xs text-muted md:grid">
              <span />
              <span>Week</span>
              <span className="text-right">Best bid</span>
              <span className="text-right">Best ask</span>
              <span className="text-right">Status</span>
            </div>
            {markets.isError && <p className="p-6 text-sm text-muted">Could not reach Monad testnet. Retrying automatically.</p>}
            {!markets.data && !markets.isError && (
              <div className="space-y-3 p-5">
                {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            )}
            {markets.data && weeks.length === 0 && <p className="p-6 text-sm text-muted">No weeks are open for trading right now. New weeks are listed every Monday.</p>}
            {weeks.map((m) => {
              const on = selected.includes(m.series);
              const started = now >= m.start;
              return (
                <div
                  key={m.series}
                  role="checkbox"
                  tabIndex={0}
                  aria-checked={on}
                  onClick={() => toggle(m.series)}
                  onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), toggle(m.series))}
                  className={`grid w-full cursor-pointer grid-cols-[1.75rem_1fr_auto_auto] items-center gap-x-3 gap-y-1 md:gap-x-4 border-b border-line px-5 py-4 text-left transition last:border-b-0 md:grid-cols-[2.5rem_1.3fr_1fr_1fr_1fr] ${on ? "bg-accent-soft" : "hover:bg-surface-2"}`}
                >
                  <span className={`grid h-5 w-5 place-items-center rounded-md border transition ${on ? "border-accent bg-accent text-accent-ink" : "border-line-strong"}`}>{on && <Check size={12} weight="bold" />}</span>
                  <span>
                    <span className="block font-medium">{m.week}</span>
                    <span className="block text-xs text-muted">
                      {utcDay(m.start)} to {utcDay(m.end)} ·{" "}
                      <a href={`${explorer}/address/${m.book}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-0.5 hover:text-accent">
                        Kuru book <ArrowUpRight size={10} />
                      </a>
                    </span>
                  </span>
                  <Quote price={m.bid} rate={impliedRate(m, m.bid)} />
                  <Quote price={m.ask} rate={impliedRate(m, m.ask)} />
                  <span className="col-span-3 col-start-2 md:col-span-1 md:col-start-auto md:text-right">
                    {started ? <Pill tone="mint">Printing, ends in {countdown(m.end - now)}</Pill> : <Pill>Starts in {countdown(m.start - now)}</Pill>}
                  </span>
                </div>
              );
            })}
          </section>
          <p className="text-xs leading-relaxed text-muted">
            Prices are per LONG token, which covers one H100 for the whole week. The $/hr figure is the implied rental rate: floor ($1) plus price divided by 168 hours. Range $1 to $5.
          </p>
        </div>

        <div className="lg:sticky lg:top-24">
          {markets.data ? <Ticket markets={weeks} mode={mode} setMode={setMode} selected={selected} toggle={toggle} /> : <Skeleton className="h-[560px] w-full rounded-2xl" />}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      {value === null ? <Skeleton className="mt-1 h-6 w-24" /> : <p className="mt-0.5 font-mono text-lg tnum">{value}</p>}
    </div>
  );
}

function Quote({ price, rate }: { price: number | null; rate: number | null }) {
  return (
    <span className="text-right">
      <span className="block font-mono text-sm tnum">{price !== null ? usd(price) : "-"}</span>
      <span className="block font-mono text-xs text-muted tnum">{rate !== null ? `${usd(rate)}/hr` : "no quote"}</span>
    </span>
  );
}
