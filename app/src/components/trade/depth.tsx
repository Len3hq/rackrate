"use client";

import { motion } from "motion/react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { type Market, impliedRate } from "@/lib/data";
import { num, toNum, usd, utcTime } from "@/lib/format";
import { INDEXER_URL, useMarketTrades } from "@/lib/indexer";
import { explorer } from "@/lib/wagmi";
import { type Level, decodeL2, kuruDepthAbi } from "@/lib/kuru";
import { Skeleton } from "../ui";

/** Every resting price level on one week's Kuru book: asks above the spread, bids below, sized by bar length. */
export function Depth({ markets, focus, setFocus }: { markets: Market[]; focus: Address | null; setFocus: (s: Address) => void }) {
  const m = markets.find((x) => x.series === focus) ?? markets[0];
  const book = useReadContract({
    address: m?.book ?? undefined,
    abi: kuruDepthAbi,
    functionName: "getL2Book",
    query: { enabled: !!m?.book, refetchInterval: 15_000 },
  });
  const trades = useMarketTrades(m?.series);
  if (!m) return null;
  const depth = book.data ? decodeL2(book.data) : null;
  const max = depth ? Math.max(1, ...depth.bids.map((l) => l.size), ...depth.asks.map((l) => l.size)) : 1;
  const spread = depth?.asks[0] && depth?.bids[0] ? depth.asks[0].price - depth.bids[0].price : null;

  const Row = ({ l, side, i }: { l: Level; side: "bid" | "ask"; i: number }) => (
    <div className="relative grid grid-cols-3 items-center px-3 py-1.5 font-mono text-sm tnum">
      <motion.span
        className={`absolute inset-y-0.5 right-0 rounded-md ${side === "bid" ? "bg-mint-soft" : "bg-rose-soft"}`}
        initial={{ width: 0 }}
        animate={{ width: `${(l.size / max) * 100}%` }}
        transition={{ duration: 0.6, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
      />
      <span className={`relative ${side === "bid" ? "text-mint" : "text-rose"}`}>{usd(l.price)}</span>
      <span className="relative text-center text-muted">{usd(impliedRate(m, l.price))}/hr</span>
      <span className="relative text-right">{num(l.size)}</span>
    </div>
  );

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">Order book</h2>
        <div className="flex flex-wrap gap-1.5">
          {markets.map((x) => (
            <button key={x.series} onClick={() => setFocus(x.series)} aria-pressed={x.series === m.series} className={`rounded-xl px-2.5 py-1 text-xs transition ${x.series === m.series ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}>
              {x.week.replace(/^\d{4}-/, "")}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 px-3 text-xs text-muted">
        <span>Price (LONG)</span>
        <span className="text-center">Implied rate</span>
        <span className="text-right">Size (GPU-weeks)</span>
      </div>
      {!depth ? (
        <Skeleton className="mt-2 h-40 w-full" />
      ) : (
        <div className="mt-1">
          {[...depth.asks].reverse().map((l, i) => <Row key={`a${l.price}`} l={l} side="ask" i={i} />)}
          {depth.asks.length === 0 && <p className="px-3 py-2 text-sm text-muted">No asks</p>}
          <p className="my-1 border-y border-line px-3 py-1.5 text-xs text-muted">
            Spread {spread !== null ? `${usd(spread)} (${usd(spread / m.epochs, 4)}/hr)` : "-"}
          </p>
          {depth.bids.map((l, i) => <Row key={`b${l.price}`} l={l} side="bid" i={i} />)}
          {depth.bids.length === 0 && <p className="px-3 py-2 text-sm text-muted">No bids</p>}
        </div>
      )}
      {INDEXER_URL && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-medium">Recent trades</h3>
            {trades.data?.Market_by_pk && (
              <span className="text-xs text-muted">
                {trades.data.Market_by_pk.tradeCount} fills · {usd(toNum(BigInt(trades.data.Market_by_pk.volumeQuote)), 0)} volume
              </span>
            )}
          </div>
          {trades.isError && <p className="mt-2 text-sm text-muted">Trade history is temporarily unavailable.</p>}
          {!trades.data && !trades.isError && <Skeleton className="mt-2 h-16 w-full" />}
          {trades.data && trades.data.Trade.length === 0 && <p className="mt-2 text-sm text-muted">No fills on this week yet.</p>}
          {trades.data && trades.data.Trade.length > 0 && (
            <ul className="mt-2">
              {trades.data.Trade.map((t) => (
                <li key={t.id} className="grid grid-cols-[1fr_auto_auto] gap-4 py-1 font-mono text-xs tnum">
                  <a href={`${explorer}/tx/${t.txHash}`} target="_blank" rel="noreferrer" className="text-muted hover:text-accent">
                    {utcTime(t.timestamp).replace(" UTC", "")}
                  </a>
                  <span className={t.takerBuys ? "text-mint" : "text-rose"}>
                    {t.takerBuys ? "Buy" : "Sell"} {usd(Number(BigInt(t.price) / 10n ** 14n) / 1e4)}
                  </span>
                  <span className="text-right">{num(toNum(BigInt(t.size)), 4)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Weeks that have settled, newest first: final average and what each token paid. */
export function SettledWeeks({ markets }: { markets: Market[] | undefined }) {
  const settled = (markets ?? []).filter((m) => m.settled && !m.isDemo).sort((a, b) => b.start - a.start);
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card md:p-6">
      <h2 className="font-medium">Settled weeks</h2>
      {!markets ? (
        <Skeleton className="mt-3 h-12 w-full" />
      ) : settled.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No week has settled yet. The first, 2026-W41, settles once its last hour prints after Monday, Oct 12, 00:00 UTC.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2 font-normal">Week</th>
                <th className="pb-2 text-right font-normal">Average</th>
                <th className="pb-2 text-right font-normal">LONG paid</th>
                <th className="pb-2 text-right font-normal">SHORT paid</th>
              </tr>
            </thead>
            <tbody>
              {settled.map((m) => (
                <tr key={m.series} className="border-t border-line">
                  <td className="py-2 font-medium">{m.week}</td>
                  <td className="py-2 text-right font-mono tnum">{usd(m.settlementPrice, 4)}/hr</td>
                  <td className="py-2 text-right font-mono tnum">{usd(m.longPayout)}</td>
                  <td className="py-2 text-right font-mono tnum">{usd(m.shortPayout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
