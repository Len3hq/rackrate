/**
 * Settlement status of every series (read-only): hours printed versus the coverage needed, when settlement can
 * happen, and the result once settled.
 *
 *   node src/settlement.ts            # weekly series
 *   node src/settlement.ts --all      # include demo series
 */
import { parseArgs } from "node:util";
import type { Address, Hex } from "viem";
import { chainTime, publicClient } from "./lib/chain.ts";
import { loadAbi, loadDeployment, loadEnv } from "./lib/config.ts";

loadEnv();
const { values } = parseArgs({ options: { all: { type: "boolean", default: false } } });

const dep = loadDeployment();
const pub = publicClient();
const oracleAbi = loadAbi("RackOracle");
const factoryAbi = loadAbi("SeriesFactory");
const seriesAbi = loadAbi("Series");
const read = <T>(address: Address, abi: typeof oracleAbi, functionName: string, args: readonly unknown[] = []) =>
  pub.readContract({ address, abi, functionName, args }) as Promise<T>;

const KIND = ["None", "Full", "Partial", "NoData"];
const usd = (micro: bigint) => `$${(Number(micro) / 1e6).toFixed(4)}`;
const when = (ts: bigint) => new Date(Number(ts) * 1000).toISOString().replace(".000Z", "Z");

const now = await chainTime(pub);
const n = await read<bigint>(dep.SeriesFactory, factoryAbi, "seriesCount");
for (let i = 0n; i < n; i++) {
  const s = await read<Address>(dep.SeriesFactory, factoryAbi, "allSeries", [i]);
  const [isDemo, feedId, start, end, minCov, grace, settled, windowEnd, longAddr] = await Promise.all([
    read<boolean>(s, seriesAbi, "isDemo"),
    read<Hex>(s, seriesAbi, "feedId"),
    read<bigint>(s, seriesAbi, "startEpoch"),
    read<bigint>(s, seriesAbi, "endEpoch"),
    read<number>(s, seriesAbi, "minCoverageBps"),
    read<number>(s, seriesAbi, "settleGrace"),
    read<boolean>(s, seriesAbi, "settled"),
    read<bigint>(s, seriesAbi, "windowEnd"),
    read<Address>(s, seriesAbi, "long"),
  ]);
  if (isDemo && !values.all) continue;
  const symbol = await read<string>(longAddr, loadAbi("OutcomeToken"), "symbol");
  const total = end - start + 1n;
  const feed = await read<{ nextEpoch: bigint; firstEpoch: bigint }>(dep.RackOracle, oracleAbi, "getFeed", [feedId]);
  const lastFinal = feed.nextEpoch - 1n < end ? feed.nextEpoch - 1n : end;
  const [, printed] =
    lastFinal >= start ? await read<[bigint, bigint, bigint]>(dep.RackOracle, oracleAbi, "windowStats", [feedId, start, lastFinal]) : [0n, 0n, 0n];
  const elapsed = lastFinal >= start ? lastFinal - start + 1n : 0n;
  const needed = (total * BigInt(minCov) + 9999n) / 10000n;
  const missed = elapsed - printed;
  const allowed = total - needed;

  console.log(`\n${symbol.replace(/L$/, "")}  ${s}`);
  if (settled) {
    const [kind, price, longPay, shortPay] = await Promise.all([
      read<number>(s, seriesAbi, "settlementKind"),
      read<bigint>(s, seriesAbi, "settlementPrice"),
      read<bigint>(s, seriesAbi, "longPayoutPerUnit"),
      read<bigint>(s, seriesAbi, "shortPayoutPerUnit"),
    ]);
    console.log(`  SETTLED (${KIND[kind]}) at ${usd(price)}/hr: LONG pays ${usd(longPay)}, SHORT pays ${usd(shortPay)} per token`);
    continue;
  }
  console.log(`  window ends ${when(windowEnd)}  (${now >= windowEnd ? "ended" : "running"})`);
  console.log(`  hours printed ${printed} of ${elapsed} finalized so far (${total} in the window); full settlement needs ${needed}`);
  if (missed > allowed) {
    console.log(`  coverage: ${missed} missed > ${allowed} allowed, so it settles on the printed hours after the grace period: from ${when(windowEnd + BigInt(grace))}`);
  } else {
    const left = allowed - missed;
    console.log(
      left === 0n
        ? `  coverage: ${missed} missed of ${allowed} allowed; one more miss and it settles after the grace period (from ${when(windowEnd + BigInt(grace))})`
        : `  coverage: ${missed} missed of ${allowed} allowed; ${left} more can be missed and it still settles in full at window end`,
    );
  }
  if (now >= windowEnd && feed.nextEpoch <= end) console.log("  waiting for the oracle to finalize the window's last hour");
}
