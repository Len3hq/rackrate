"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { motion } from "motion/react";
import Link from "next/link";
import { impliedRate, liveWeekly, useMarkets, useOracle } from "@/lib/data";
import { usd, utcDay } from "@/lib/format";
import { PriceChart } from "../price-chart";
import { Skeleton } from "../ui";

/** Hero visual: the live H100 forward curve, read from the Kuru books and the oracle on every refresh. */
export function LiveCurve() {
  const markets = useMarkets();
  const oracle = useOracle(48);
  const now = Math.floor(Date.now() / 1000);
  const weeks = liveWeekly(markets.data, now).slice(0, 4);
  const failed = markets.isError || oracle.isError;

  return (
    <div className="relative rounded-2xl border border-line-strong bg-surface/85 p-5 shadow-card backdrop-blur-md md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">H100 index, $/GPU-hour</p>
          {oracle.data ? (
            <p className="mt-1 font-mono text-3xl font-medium tracking-tight tnum">{usd(oracle.data.lastPrice, 4)}</p>
          ) : (
            <Skeleton className="mt-2 h-8 w-32" />
          )}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-mint-soft px-2 py-1 text-xs font-medium text-mint">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint" />
          </span>
          Live on testnet
        </span>
      </div>

      <div className="mt-3 -mx-1">
        {oracle.data ? <PriceChart points={oracle.data.points} height={92} compact /> : <Skeleton className="h-[92px] w-full" />}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 pb-2 text-xs text-muted">
          <span>Week</span>
          <span className="text-right">Sell at</span>
          <span className="text-right">Buy at</span>
        </div>
        {failed && <p className="py-4 text-sm text-muted">Monad testnet is not responding. Retrying shortly.</p>}
        {!failed && !markets.data && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="my-2 h-9 w-full" />)}
        {weeks.map((m, i) => (
          <motion.div
            key={m.series}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.07, ease: [0.16, 1, 0.3, 1], duration: 0.6 }}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 rounded-xl py-2"
          >
            <div>
              <p className="text-sm font-medium">{m.week}</p>
              <p className="text-xs text-muted">{utcDay(m.start)} to {utcDay(m.end)}</p>
            </div>
            <p className="text-right font-mono text-sm tnum">{m.bid !== null ? `${usd(impliedRate(m, m.bid))}/hr` : "-"}</p>
            <p className="text-right font-mono text-sm tnum">{m.ask !== null ? `${usd(impliedRate(m, m.ask))}/hr` : "-"}</p>
          </motion.div>
        ))}
      </div>
      <Link href="/trade" className="group mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
        Trade these weeks <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
