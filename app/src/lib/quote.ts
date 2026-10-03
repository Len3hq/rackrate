import { type Address, type PublicClient, encodeAbiParameters, keccak256, numberToHex, pad } from "viem";
import { deployment, hedgeRouterAbi } from "./generated";
import { kuruTradeAbi } from "./kuru";

/**
 * Exact quotes for the HedgeRouter, by simulating the real transaction against the live Kuru books. rrUSD balance
 * and allowance are overridden in the simulation (ERC20 storage: balances at slot 0, allowances at slot 1), so a
 * quote works before the user has connected, funded or approved anything.
 */
const QUOTER: Address = "0x000000000000000000000000000000000000bEEF";
const slot = (key: Address, base: bigint | `0x${string}`) =>
  keccak256(
    typeof base === "bigint"
      ? encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [key, base])
      : encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [key, base]),
  );
const HUGE = pad(numberToHex(10n ** 30n), { size: 32 });

/** Give `who` a large balance of `token` and a large allowance to `spender`, inside the simulation only. */
function fund(token: Address, who: Address, spender: Address) {
  return {
    address: token,
    stateDiff: [
      { slot: slot(who, 0n), value: HUGE },
      { slot: slot(spender, slot(who, 1n)), value: HUGE },
    ],
  };
}

const overrides = (who: Address) => [fund(deployment.rrUSD as Address, who, deployment.HedgeRouter as Address)];

export interface HedgeLegInput {
  series: Address;
  book: Address;
  units: bigint;
}

export async function quoteHedge(client: PublicClient, legs: HedgeLegInput[], account?: Address) {
  const who = account ?? QUOTER;
  const { result } = await client.simulateContract({
    address: deployment.HedgeRouter as Address,
    abi: hedgeRouterAbi,
    functionName: "hedge",
    account: who,
    args: [legs.map((l) => ({ ...l, minProceeds: 0n }))],
    stateOverride: overrides(who),
  });
  return { cost: result[0], proceeds: result[1] };
}

export async function quoteBuy(client: PublicClient, legs: { book: Address; quoteIn: bigint }[], account?: Address) {
  const who = account ?? QUOTER;
  const { result } = await client.simulateContract({
    address: deployment.HedgeRouter as Address,
    abi: hedgeRouterAbi,
    functionName: "buyLongs",
    account: who,
    args: [legs.map((l) => ({ ...l, minLongOut: 0n }))],
    stateOverride: overrides(who),
  });
  return { longOut: result };
}

/** rrUSD received for selling `units` LONG straight into a Kuru book from the wallet (OutcomeToken uses the same slots). */
export async function quoteSellLong(client: PublicClient, book: Address, long: Address, units: bigint, account?: Address) {
  const who = account ?? QUOTER;
  const { result } = await client.simulateContract({
    address: book,
    abi: kuruTradeAbi,
    functionName: "placeAndExecuteMarketSell",
    account: who,
    args: [units, 0n, false, true],
    stateOverride: [fund(long, who, book)],
  });
  return result;
}

/**
 * The smallest rrUSD budget (to the cent) that buys at least `units` LONG through the router. Kuru market buys take
 * a budget rather than a size, so this brackets the budget from the quoted fills and then bisects it, leaving less
 * than 0.0001 LONG of leftover.
 */
export async function budgetForLong(client: PublicClient, book: Address, units: bigint, ask: number, account?: Address) {
  const cent = 10_000n;
  const fill = async (b: bigint) => (await quoteBuy(client, [{ book, quoteIn: b * cent }], account)).longOut;
  let hi = (BigInt(Math.ceil(ask * 1e6)) * units) / 1_000_000n / cent + 1n; // in cents
  let out = await fill(hi);
  for (let i = 0; out < units && i < 5; i++) {
    if (out === 0n) throw new Error("Not enough liquidity on the book to buy back this position.");
    hi = (hi * units * 1002n) / (out * 1000n) + 1n;
    out = await fill(hi);
  }
  if (out < units) throw new Error("Not enough liquidity on the book to buy back this position.");
  let lo = (hi * 99n) / 100n; // search the last 1%: the result is the cheapest budget found that still fills
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const m = await fill(mid);
    if (m >= units) [hi, out] = [mid, m];
    else lo = mid;
  }
  return { budget: hi * cent, longOut: out };
}

/** Slippage guard applied to quoted amounts (0.5%). */
export const withSlippage = (x: bigint) => (x * 995n) / 1000n;
