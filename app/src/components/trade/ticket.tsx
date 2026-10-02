"use client";

import { CheckCircle, Info, WarningCircle } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type Address, type PublicClient, maxUint256 } from "viem";
import { useAccount, usePublicClient, useReadContracts } from "wagmi";
import type { Market } from "@/lib/data";
import { num, parseUnits6, toNum, usd } from "@/lib/format";
import { deployment, hedgeRouterAbi, rRUSDAbi } from "@/lib/generated";
import { quoteBuy, quoteHedge, withSlippage } from "@/lib/quote";
import { txError, useTx } from "@/lib/tx";
import { ConnectButton } from "../connect";
import { Button, Skeleton } from "../ui";

export type Mode = "hedge" | "buy";

const ROUTER = deployment.HedgeRouter as Address;
const USD = deployment.rrUSD as Address;

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface LegQuote {
  m: Market;
  amountIn: bigint; // rrUSD in (hedge: collateral, buy: spend)
  out: bigint; // rrUSD proceeds (hedge) or LONG received (buy)
  rate: number; // locked $/GPU-hour
}

async function quoteLegs(client: PublicClient, mode: Mode, markets: Market[], amount: bigint, account?: Address): Promise<LegQuote[]> {
  return Promise.all(
    markets.map(async (m) => {
      if (mode === "hedge") {
        const q = await quoteHedge(client, [{ series: m.series, book: m.book as Address, units: amount }], account);
        const perGpu = toNum(q.proceeds) / toNum(amount);
        return { m, amountIn: q.cost, out: q.proceeds, rate: m.floor + perGpu / m.epochs };
      }
      const q = await quoteBuy(client, [{ book: m.book as Address, quoteIn: amount }], account);
      const pricePerLong = q.longOut > 0n ? toNum(amount) / toNum(q.longOut) : Number.NaN;
      return { m, amountIn: amount, out: q.longOut, rate: m.floor + pricePerLong / m.epochs };
    }),
  );
}

export function Ticket({ markets, mode, setMode, selected, toggle }: { markets: Market[]; mode: Mode; setMode: (m: Mode) => void; selected: Address[]; toggle: (s: Address) => void }) {
  const client = usePublicClient();
  const { address, isConnected } = useAccount();
  const { send, pending } = useTx();
  const [input, setInput] = useState("1");
  const [done, setDone] = useState<string | null>(null);

  const chosen = useMemo(() => markets.filter((m) => selected.includes(m.series)), [markets, selected]);
  const raw = parseUnits6(input);
  const step = mode === "hedge" ? 10_000n : 100n; // hedge: 0.01 GPU-week (Kuru min size); buy: $0.0001 (Kuru price precision)
  const inputError = !input ? null : raw === null ? "Enter a positive number" : raw % step !== 0n ? "Use at most 2 decimals" : null;
  const amount = useDebounced(raw !== null && !inputError ? raw : null);

  useEffect(() => setDone(null), [mode, input, selected]);
  useEffect(() => setInput(mode === "hedge" ? "1" : "500"), [mode]);

  const quote = useQuery({
    queryKey: ["quote", mode, chosen.map((m) => `${m.series}${m.bid}${m.ask}`).join(), amount?.toString(), address],
    queryFn: () => quoteLegs(client as PublicClient, mode, chosen, amount as bigint, address),
    enabled: !!client && !!amount && chosen.length > 0,
    retry: false,
    refetchInterval: 20_000,
  });

  const wallet = useReadContracts({
    contracts: [
      { address: USD, abi: rRUSDAbi, functionName: "balanceOf", args: [address as Address] },
      { address: USD, abi: rRUSDAbi, functionName: "allowance", args: [address as Address, ROUTER] },
      { address: USD, abi: rRUSDAbi, functionName: "lastClaim", args: [address as Address] },
    ],
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const balance = wallet.data?.[0].result as bigint | undefined;
  const allowance = wallet.data?.[1].result as bigint | undefined;
  const lastClaim = Number((wallet.data?.[2].result as bigint | undefined) ?? 0n);
  const faucetReady = lastClaim === 0 || Date.now() / 1000 > lastClaim + 86_400;

  const legs = quote.data ?? [];
  const totalIn = legs.reduce((s, l) => s + l.amountIn, 0n);
  const totalOut = legs.reduce((s, l) => s + l.out, 0n);
  const avgRate = legs.length ? legs.reduce((s, l) => s + l.rate, 0) / legs.length : null;

  const needsFunds = balance !== undefined && totalIn > balance;
  const needsApproval = allowance !== undefined && totalIn > allowance;

  async function execute() {
    if (mode === "hedge") {
      const ok = await send(
        {
          address: ROUTER,
          abi: hedgeRouterAbi,
          functionName: "hedge",
          args: [legs.map((l) => ({ series: l.m.series, book: l.m.book as Address, units: amount as bigint, minProceeds: withSlippage(l.out) }))],
        },
        `Hedge ${num(toNum(amount as bigint))} GPU${amount === 1_000_000n ? "" : "s"} across ${legs.length} week${legs.length > 1 ? "s" : ""}`,
      );
      if (ok) setDone(`You hold ${num(toNum(amount as bigint) * legs.length)} SHORT and received ${usd(toNum(totalOut))}.`);
    } else {
      const ok = await send(
        {
          address: ROUTER,
          abi: hedgeRouterAbi,
          functionName: "buyLongs",
          args: [legs.map((l) => ({ book: l.m.book as Address, quoteIn: amount as bigint, minLongOut: withSlippage(l.out) }))],
        },
        `Buy LONG for ${legs.length} week${legs.length > 1 ? "s" : ""}`,
      );
      if (ok) setDone(`You hold ${num(toNum(totalOut), 4)} LONG across ${legs.length} week${legs.length > 1 ? "s" : ""}.`);
    }
  }

  const quoteFailed = quote.isError ? txError(quote.error) : null;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card md:p-6">
      <div role="tablist" className="relative grid grid-cols-2 rounded-full bg-surface-2 p-1 text-sm">
        {(["hedge", "buy"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`relative z-10 rounded-full py-2 font-medium transition ${mode === m ? "text-ink" : "text-muted hover:text-ink"}`}>
            {mode === m && <motion.span layoutId="ticket-tab" className="absolute inset-0 -z-10 rounded-full bg-surface shadow-sm" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            {m === "hedge" ? "Hedge revenue" : "Lock compute cost"}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        {mode === "hedge"
          ? "Sell future GPU-hours: mint each week, sell the LONG side and keep the SHORT, which pays if rates fall."
          : "Buy LONG for the weeks you need compute. It pays if rates rise, capping your effective cost."}
      </p>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium">Weeks</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {markets.map((m) => {
            const on = selected.includes(m.series);
            return (
              <button key={m.series} onClick={() => toggle(m.series)} aria-pressed={on} className={`rounded-xl border px-3 py-1.5 text-sm transition ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:border-line-strong"}`}>
                {m.week.replace(/^\d{4}-/, "")}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5 flex flex-col gap-2">
        <label htmlFor="amount" className="text-sm font-medium">
          {mode === "hedge" ? "GPUs per week" : "Spend per week (rrUSD)"}
        </label>
        <div className={`flex items-center rounded-xl border bg-bg px-3 transition focus-within:border-accent ${inputError ? "border-rose" : "border-line-strong"}`}>
          <input id="amount" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value.replace(",", "."))} className="h-11 w-full bg-transparent font-mono text-lg outline-none tnum" aria-describedby="amount-help" />
          <span className="text-sm text-muted">{mode === "hedge" ? "H100" : "rrUSD"}</span>
        </div>
        <p id="amount-help" className={`text-xs ${inputError ? "text-rose" : "text-muted"}`}>
          {inputError ?? (mode === "hedge" ? "One GPU for one week = 168 GPU-hours." : "Spent at the best asks on each week's book.")}
        </p>
      </div>

      <div className="mt-5 rounded-xl bg-surface-2 p-4">
        {chosen.length === 0 ? (
          <p className="text-sm text-muted">Pick at least one week.</p>
        ) : quote.isLoading || (!quote.data && !quoteFailed && amount) ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : quoteFailed ? (
          <p className="flex gap-2 text-sm text-rose">
            <WarningCircle size={18} className="shrink-0" />
            {/FillOrKill|InsufficientLiquidity|reverted/i.test(quoteFailed) ? "Not enough liquidity on the book for this size. Try a smaller amount." : quoteFailed}
          </p>
        ) : legs.length > 0 ? (
          <dl className="space-y-2 text-sm">
            {legs.map((l) => (
              <div key={l.m.series} className="flex items-center justify-between">
                <dt className="text-muted">{l.m.week.replace(/^\d{4}-/, "")}</dt>
                <dd className="font-mono tnum">
                  {mode === "hedge" ? `+${usd(toNum(l.out))}` : `${num(toNum(l.out), 4)} LONG`}
                  <span className="ml-2 text-muted">{usd(l.rate)}/hr</span>
                </dd>
              </div>
            ))}
            <div className="my-2 border-t border-line" />
            {mode === "hedge" ? (
              <>
                <Row label="Collateral in" value={usd(toNum(totalIn))} />
                <Row label="Received now" value={usd(toNum(totalOut))} />
                <Row label="SHORT tokens" value={num(toNum(amount ?? 0n) * legs.length)} />
              </>
            ) : (
              <>
                <Row label="Total spend" value={usd(toNum(totalIn))} />
                <Row label="LONG received" value={num(toNum(totalOut), 4)} />
              </>
            )}
            <div className="flex items-center justify-between pt-1">
              <dt className="font-medium">{mode === "hedge" ? "Locked revenue" : "Locked cost"}</dt>
              <dd className="font-mono text-base font-medium text-mint tnum">{avgRate !== null ? `${usd(avgRate)}/GPU-hr` : "-"}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      <div className="mt-5">
        {!isConnected ? (
          <ConnectButton className="[&>button]:w-full" />
        ) : needsFunds ? (
          faucetReady ? (
            <Button className="w-full" size="lg" disabled={!!pending} onClick={() => send({ address: USD, abi: rRUSDAbi, functionName: "faucet" }, "Claim 10,000 test rrUSD")}>
              Get 10,000 test rrUSD
            </Button>
          ) : (
            <Button className="w-full" size="lg" disabled>
              Not enough rrUSD (faucet resets daily)
            </Button>
          )
        ) : needsApproval ? (
          <Button className="w-full" size="lg" disabled={!!pending} onClick={() => send({ address: USD, abi: rRUSDAbi, functionName: "approve", args: [ROUTER, maxUint256] }, "Approve rrUSD for the HedgeRouter")}>
            Approve rrUSD
          </Button>
        ) : (
          <Button className="w-full" size="lg" disabled={!!pending || !quote.data || legs.length === 0 || quote.isFetching} onClick={execute}>
            {pending ?? (mode === "hedge" ? `Hedge ${legs.length || ""} week${legs.length === 1 ? "" : "s"}` : `Buy ${legs.length || ""} week${legs.length === 1 ? "" : "s"}`)}
          </Button>
        )}
        {isConnected && balance !== undefined && (
          <p className="mt-2 text-center text-xs text-muted">
            Balance {usd(toNum(balance))} rrUSD. Quotes refresh every 20s with a 0.5% slippage limit.
          </p>
        )}
      </div>

      <AnimatePresence>
        {done && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex gap-2 rounded-xl bg-mint-soft p-3 text-sm text-mint">
            <CheckCircle size={18} weight="fill" className="shrink-0" />
            <span>
              {done}{" "}
              <Link href="/portfolio" className="font-medium underline">
                View portfolio
              </Link>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="mt-4 flex gap-2 text-xs leading-relaxed text-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        Testnet only. Liquidity comes from a team-run test market maker, not organic volume.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono tnum">{value}</dd>
    </div>
  );
}
