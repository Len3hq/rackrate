"use client";

import { CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState } from "react";
import { type Address, type PublicClient, erc20Abi, maxUint256 } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import type { Market } from "@/lib/data";
import { num, toNum, usd } from "@/lib/format";
import { deployment, hedgeRouterAbi, seriesAbi } from "@/lib/generated";
import { MIN_SIZE, kuruTradeAbi } from "@/lib/kuru";
import { budgetForLong, quoteSellLong, withSlippage } from "@/lib/quote";
import { type TxRequest, txError, useTx } from "@/lib/tx";
import { Button, Skeleton } from "../ui";

const ROUTER = deployment.HedgeRouter as Address;
const USD = deployment.rrUSD as Address;

interface Step {
  label: string;
  tx: TxRequest;
}

interface Plan {
  steps: Step[];
  back: bigint; // net rrUSD returned to the wallet
  dust: bigint; // LONG left over (below Kuru's minimum order size)
}

/**
 * Plans the unwind of an open position. Matched LONG+SHORT pairs are redeemed for their collateral; extra LONG is
 * sold into the week's Kuru book from the wallet; extra SHORT is matched by buying LONG back through the router,
 * then redeemed. Every amount is quoted by simulating the real call.
 */
async function plan(client: PublicClient, m: Market, account: Address, long: bigint, short: bigint): Promise<Plan> {
  const book = m.book as Address;
  const perPair = BigInt(Math.round(m.collateralPerUnit * 1e6));
  const steps: Step[] = [];
  let back = 0n;
  let dust = 0n;

  if (short > long) {
    if (m.ask === null) throw new Error("There are no asks on this week's book to buy LONG back from.");
    const need = short - long;
    const { budget, longOut } = await budgetForLong(client, book, need, m.ask, account);
    const allowance = await client.readContract({ address: USD, abi: erc20Abi, functionName: "allowance", args: [account, ROUTER] });
    if (allowance < budget) steps.push({ label: "Approve rrUSD", tx: { address: USD, abi: erc20Abi, functionName: "approve", args: [ROUTER, maxUint256] } });
    steps.push({
      label: `Buy ${num(toNum(need), 4)} LONG for ${usd(toNum(budget))}`,
      tx: { address: ROUTER, abi: hedgeRouterAbi, functionName: "buyLongs", args: [[{ book, quoteIn: budget, minLongOut: need }]] },
    });
    steps.push({ label: `Redeem ${num(toNum(short), 4)} pairs`, tx: { address: m.series, abi: seriesAbi, functionName: "redeemPair", args: [short] } });
    back = (short * perPair) / 1_000_000n - budget;
    dust = long + longOut - short;
  } else {
    if (short > 0n) {
      steps.push({ label: `Redeem ${num(toNum(short), 4)} pairs`, tx: { address: m.series, abi: seriesAbi, functionName: "redeemPair", args: [short] } });
      back = (short * perPair) / 1_000_000n;
    }
    const extra = long - short;
    if (extra >= MIN_SIZE) {
      const proceeds = await quoteSellLong(client, book, m.long, extra, account);
      const allowance = await client.readContract({ address: m.long, abi: erc20Abi, functionName: "allowance", args: [account, book] });
      if (allowance < extra) steps.push({ label: "Approve LONG for the Kuru book", tx: { address: m.long, abi: erc20Abi, functionName: "approve", args: [book, maxUint256] } });
      steps.push({
        label: `Sell ${num(toNum(extra), 4)} LONG for ${usd(toNum(proceeds))}`,
        tx: { address: book, abi: kuruTradeAbi, functionName: "placeAndExecuteMarketSell", args: [extra, withSlippage(proceeds), false, true] },
      });
      back += proceeds;
    } else {
      dust = extra;
    }
  }
  return { steps, back, dust };
}

export function ClosePanel({ m, long, short, onClose }: { m: Market; long: bigint; short: bigint; onClose: () => void }) {
  const client = usePublicClient();
  const { address } = useAccount();
  const { send, pending } = useTx();
  const [done, setDone] = useState(-1); // index of the last confirmed step

  const q = useQuery({
    queryKey: ["close", m.series, long.toString(), short.toString(), address],
    queryFn: () => plan(client as PublicClient, m, address as Address, long, short),
    enabled: !!client && !!address && done < 0,
    retry: false,
  });

  async function run() {
    if (!q.data) return;
    for (let i = done + 1; i < q.data.steps.length; i++) {
      const s = q.data.steps[i];
      if (!(await send(s.tx, `${s.label} (${m.week})`))) return;
      setDone(i);
    }
    onClose();
  }

  const steps = q.data?.steps ?? [];
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="col-span-full overflow-hidden">
      <div className="mt-2 rounded-xl bg-surface-2 p-4">
        <p className="text-sm font-medium">Close this position</p>
        {q.isLoading && (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
        {q.isError && (
          <p className="mt-3 flex gap-2 text-sm text-rose">
            <WarningCircle size={18} className="shrink-0" />
            {/FillOrKill|Insufficient|reverted/i.test(txError(q.error)) ? "Not enough liquidity on the book to close right now." : txError(q.error)}
          </p>
        )}
        {q.data && steps.length === 0 && <p className="mt-3 text-sm text-muted">This position is below Kuru&apos;s 0.01 minimum order size, so there is nothing to close.</p>}
        {q.data && steps.length > 0 && (
          <>
            <ol className="mt-3 space-y-2 text-sm">
              {steps.map((s, i) => (
                <li key={s.label} className="flex items-center gap-2">
                  {i <= done ? (
                    <CheckCircle size={16} weight="fill" className="text-mint" />
                  ) : pending && i === done + 1 ? (
                    <CircleNotch size={16} className="animate-spin text-accent" />
                  ) : (
                    <span className="grid h-4 w-4 place-items-center rounded-full border border-line-strong text-[10px] text-muted">{i + 1}</span>
                  )}
                  <span className={i <= done ? "text-muted line-through" : ""}>{s.label}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-sm">
              You get back about <span className="font-mono font-medium text-mint tnum">{usd(toNum(q.data.back))}</span> in rrUSD.
              {q.data.dust > 0n && <span className="text-muted"> {num(toNum(q.data.dust), 4)} LONG below the minimum order size stays in your wallet.</span>}
            </p>
            <div className="mt-4 flex gap-2">
              <Button disabled={!!pending} onClick={run}>
                {done >= 0 ? "Continue" : `Close position${steps.length > 1 ? ` (${steps.length} steps)` : ""}`}
              </Button>
              <Button variant="ghost" disabled={!!pending} onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
