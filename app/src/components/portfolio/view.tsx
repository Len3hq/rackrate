"use client";

import { ArrowUpRight, Drop, Wallet } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { type Market, useHoldings, useMarkets } from "@/lib/data";
import { countdown, num, toNum, usd, windowLabel } from "@/lib/format";
import { deployment, rRUSDAbi, seriesAbi } from "@/lib/generated";
import { useTx } from "@/lib/tx";
import { ConnectButton } from "../connect";
import { Button, ButtonLink, Pill, Skeleton } from "../ui";
import { ClosePanel } from "./close";
import { History } from "./history";
import { AddToken } from "../add-token";

function status(m: Market, now: number) {
  if (m.settled) return { label: `Settled at ${usd(m.settlementPrice)}/hr`, tone: "accent" as const };
  if (now >= m.end) return { label: "Awaiting settlement", tone: "neutral" as const };
  if (now >= m.start) return { label: `Printing, ends in ${countdown(m.end - now)}`, tone: "mint" as const };
  return { label: `Starts in ${countdown(m.start - now)}`, tone: "neutral" as const };
}

/** Value of a position: payouts once settled, otherwise marked to the book (SHORT = pair collateral minus LONG ask). */
function value(m: Market, long: number, short: number): number | null {
  if (m.settled) return long * m.longPayout + short * m.shortPayout;
  const longMark = long > 0 ? (m.bid === null ? null : long * m.bid) : 0;
  const shortMark = short > 0 ? (m.ask === null ? null : short * (m.collateralPerUnit - m.ask)) : 0;
  return longMark === null || shortMark === null ? null : longMark + shortMark;
}

export function PortfolioView() {
  const { isConnected } = useAccount();
  const markets = useMarkets();
  const holdings = useHoldings(markets.data);
  const { send, pending } = useTx();
  const [closing, setClosing] = useState<Address | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5_000);
    return () => clearInterval(t);
  }, []);

  if (!isConnected) {
    return (
      <Shell>
        <div className="flex flex-col items-center rounded-2xl border border-line bg-surface px-6 py-20 text-center shadow-card">
          <Wallet size={36} className="text-accent" />
          <h2 className="mt-4 text-xl font-semibold">Connect a wallet to see your positions</h2>
          <p className="mt-2 max-w-[44ch] text-sm text-muted">Any browser wallet on Monad testnet works. You can claim free test rrUSD once connected.</p>
          <ConnectButton className="mt-6" />
        </div>
      </Shell>
    );
  }

  const h = holdings.data;
  const rows = (markets.data ?? [])
    .filter((m) => h?.positions.has(m.series))
    .map((m) => {
      const p = h!.positions.get(m.series)!;
      const long = toNum(p.long);
      const short = toNum(p.short);
      return { m, p, long, short, value: value(m, long, short) };
    })
    .sort((a, b) => a.m.start - b.m.start);
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const faucetIn = h ? h.faucetReadyAt - now : 0;

  return (
    <Shell>
      {holdings.isError && !h && (
        <p className="mb-4 rounded-xl bg-rose-soft px-4 py-3 text-sm text-rose" role="status">
          Could not load your balances from Monad testnet. Retrying automatically.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Tile label="rrUSD balance" value={h ? usd(toNum(h.usd)) : null}>
          <div className="mt-1 -ml-1.5"><AddToken address={deployment.rrUSD} symbol="rrUSD" /></div>
          <Button
            variant="secondary"
            className="mt-4 w-full"
            disabled={!!pending || !h || faucetIn > 0}
            onClick={() => send({ address: deployment.rrUSD, abi: rRUSDAbi, functionName: "faucet" }, "Claim 10,000 test rrUSD")}
          >
            <Drop size={16} /> {faucetIn > 0 ? `Faucet ready in ${countdown(faucetIn)}` : "Claim 10,000 rrUSD"}
          </Button>
          <a
            href="https://faucet.monad.xyz"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
          >
            Need MON for gas? Monad faucet <ArrowUpRight size={12} />
          </a>
        </Tile>
        <Tile label="Positions value (est.)" value={h ? usd(total) : null} note="Marked to the best bid and ask, or to payouts once settled." />
        <Tile label="Open weeks" value={h ? String(rows.filter((r) => !r.m.settled).length) : null} note="Weeks where you hold LONG or SHORT." />
      </div>

      <section className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <div className="hidden grid-cols-[1.4fr_0.8fr_0.8fr_1.2fr_1fr_auto] gap-4 border-b border-line px-5 py-3 text-xs text-muted md:grid">
          <span>Week</span>
          <span className="text-right">LONG</span>
          <span className="text-right">SHORT</span>
          <span>Status</span>
          <span className="text-right">Value</span>
          <span className="w-32" />
        </div>
        {!h && <div className="space-y-3 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
        {h && rows.length === 0 && (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <p className="font-medium">No positions yet</p>
            <p className="mt-1 max-w-[42ch] text-sm text-muted">Hedge a week of GPU revenue or lock a compute cost and it will show up here.</p>
            <ButtonLink href="/trade" className="mt-5">Open the app</ButtonLink>
          </div>
        )}
        {rows.map(({ m, p, long, short, value: v }, i) => {
          const st = status(m, now);
          return (
            <motion.div
              key={m.series}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="grid grid-cols-2 items-center gap-x-4 gap-y-2 border-b border-line px-5 py-4 last:border-b-0 md:grid-cols-[1.4fr_0.8fr_0.8fr_1.2fr_1fr_auto]"
            >
              <div className="col-span-2 md:col-span-1">
                <p className="font-medium">{m.isDemo ? `${m.gpu} demo week` : m.week}</p>
                <p className="text-xs text-muted">{windowLabel(m.start, m.end)}</p>
                <div className="-ml-1.5 mt-1 flex gap-1">
                  {p.long > 0n && <AddToken address={m.long} symbol={m.symbol} compact />}
                  {p.short > 0n && <AddToken address={m.short} symbol={m.symbol.replace(/L$/, "S")} compact />}
                </div>
              </div>
              <p className="font-mono text-sm tnum md:text-right"><span className="text-muted md:hidden">LONG </span>{num(long, 4)}</p>
              <p className="font-mono text-sm tnum md:text-right"><span className="text-muted md:hidden">SHORT </span>{num(short, 4)}</p>
              <div><Pill tone={st.tone}>{st.label}</Pill></div>
              <p className="font-mono text-sm tnum md:text-right">{v === null ? "-" : usd(v)}</p>
              <div className="col-span-2 flex justify-end md:col-span-1 md:w-32">
                {m.settled ? (
                  <Button className="w-full md:w-auto" disabled={!!pending} onClick={() => send({ address: m.series, abi: seriesAbi, functionName: "claim", args: [p.long, p.short] }, `Claim ${m.week} payout`)}>
                    Claim {v !== null ? usd(v) : ""}
                  </Button>
                ) : now >= m.end ? (
                  <Button variant="secondary" className="w-full md:w-auto" disabled={!!pending} onClick={() => send({ address: m.series, abi: seriesAbi, functionName: "settle" }, `Settle ${m.week}`)}>
                    Settle
                  </Button>
                ) : (
                  <Button variant="secondary" className="w-full md:w-auto" disabled={!!pending} onClick={() => setClosing(closing === m.series ? null : m.series)} aria-expanded={closing === m.series}>
                    {closing === m.series ? "Hide" : "Close"}
                  </Button>
                )}
              </div>
              <AnimatePresence>
                {closing === m.series && <ClosePanel m={m} long={p.long} short={p.short} onClose={() => setClosing(null)} />}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </section>
      {markets.data && <History markets={markets.data} />}
      <p className="mt-4 text-xs leading-relaxed text-muted">
        At settlement each LONG pays (weekly average minus floor) times 168 and each SHORT pays (cap minus average) times 168, in rrUSD. Before settlement, Close sells or buys back LONG on Kuru and redeems matched LONG and SHORT pairs for their full collateral.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10 md:px-6 md:py-14">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Portfolio</h1>
      <p className="mt-2 text-ink-2">Your rrUSD, positions and payouts.</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

function Tile({ label, value, note, children }: { label: string; value: string | null; note?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <p className="text-sm text-muted">{label}</p>
      {value === null ? <Skeleton className="mt-2 h-8 w-32" /> : <p className="mt-1 font-mono text-2xl tnum">{value}</p>}
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
      {children}
    </div>
  );
}
