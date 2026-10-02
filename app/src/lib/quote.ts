import { type Address, type PublicClient, encodeAbiParameters, keccak256, numberToHex, pad } from "viem";
import { deployment, hedgeRouterAbi } from "./generated";

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

function overrides(who: Address) {
  const router = deployment.HedgeRouter as Address;
  return [
    {
      address: deployment.rrUSD as Address,
      stateDiff: [
        { slot: slot(who, 0n), value: HUGE },
        { slot: slot(router, slot(who, 1n)), value: HUGE },
      ],
    },
  ];
}

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

/** Slippage guard applied to quoted amounts (0.5%). */
export const withSlippage = (x: bigint) => (x * 995n) / 1000n;
