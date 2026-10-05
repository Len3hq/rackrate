"use client";

import { ArrowUpRight, ClockCounterClockwise } from "@phosphor-icons/react";
import { useAccount } from "wagmi";
import type { Market } from "@/lib/data";
import { num, toNum, usd, utcTime } from "@/lib/format";
import { INDEXER_URL, type ActivityRow, useActivity } from "@/lib/indexer";
import { explorer } from "@/lib/wagmi";
import { Pill, Skeleton } from "../ui";

const LABEL: Record<ActivityRow["kind"], { text: string; tone: "accent" | "mint" | "rose" | "neutral" }> = {
  HEDGE: { text: "Hedged", tone: "accent" },
  BUY: { text: "Bought LONG", tone: "mint" },
  SELL: { text: "Sold LONG", tone: "rose" },
  MINT: { text: "Minted pairs", tone: "neutral" },
  REDEEM: { text: "Redeemed pairs", tone: "neutral" },
  CLAIM: { text: "Claimed payout", tone: "mint" },
};

/** What the row did, in plain amounts. All amounts have 6 decimals. */
function detail(a: ActivityRow): string {
  const units = num(toNum(BigInt(a.units)), 4);
  const paid = usd(toNum(BigInt(a.amountIn)));
  const got = usd(toNum(BigInt(a.amountOut)));
  switch (a.kind) {
    case "HEDGE":
      return `${units} GPU-weeks: ${paid} in, ${got} received`;
    case "BUY":
      return `${num(toNum(BigInt(a.amountOut)), 4)} LONG for ${paid}`;
    case "SELL":
      return `${units} LONG for ${got}`;
    case "MINT":
      return `${units} pairs for ${paid}`;
    case "REDEEM":
      return `${units} pairs for ${got}`;
    case "CLAIM":
      return `${units} tokens for ${got}`;
  }
}

/** The connected wallet's actions across every week, from the Rackrate indexer. */
export function History({ markets }: { markets: Market[] }) {
  const { address } = useAccount();
  const activity = useActivity(address);
  const label = (series: string) => {
    const m = markets.find((x) => x.series.toLowerCase() === series);
    return m ? (m.isDemo ? `${m.gpu} demo week` : m.week) : `${series.slice(0, 8)}…`;
  };

  return (
    <section className="mt-8 rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <ClockCounterClockwise size={18} className="text-accent" />
        <h2 className="font-medium">History</h2>
      </div>
      {!INDEXER_URL ? (
        <p className="px-5 py-6 text-sm text-muted">History needs the Rackrate indexer, which is not connected to this deployment. Positions and balances above are read directly from the chain.</p>
      ) : activity.isError ? (
        <p className="px-5 py-6 text-sm text-muted">History is temporarily unavailable. Retrying automatically.</p>
      ) : !activity.data ? (
        <div className="space-y-3 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : activity.data.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No activity yet. Hedges, purchases, closes and claims will be listed here.</p>
      ) : (
        <ul>
          {activity.data.map((a) => (
            <li key={a.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 text-sm last:border-b-0 md:grid-cols-[9rem_8rem_1fr_auto]">
              <span className="text-muted md:order-none">{utcTime(a.timestamp).replace(" UTC", "")}</span>
              <span className="justify-self-end md:justify-self-start"><Pill tone={LABEL[a.kind].tone}>{LABEL[a.kind].text}</Pill></span>
              <span className="col-span-2 md:col-span-1">
                <span className="font-medium">{label(a.market)}</span>
                <span className="ml-2 font-mono text-xs text-ink-2 tnum">{detail(a)}</span>
              </span>
              <a href={`${explorer}/tx/${a.txHash}`} target="_blank" rel="noreferrer" className="col-span-2 inline-flex items-center gap-1 text-xs text-accent hover:underline md:col-span-1">
                Transaction <ArrowUpRight size={11} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
