/**
 * Rackrate keeper. Every tick:
 *   1. lists upcoming weekly series (Monday 00:00 UTC to Monday 00:00 UTC, 168 hourly epochs) for each hourly
 *      feed, keeping `--weeks` weeks open ahead (factory owner action),
 *   2. creates the Kuru order book for every live series that has none (MarketRegistry, permissionless),
 *   3. settles every finished series whose window the oracle has finalized (permissionless).
 *
 * Usage:
 *   node src/keeper.ts --feeds H100 --weeks 4            # loop (default every 5 minutes)
 *   node src/keeper.ts --once                            # one pass
 */
import { parseArgs } from "node:util";
import { type Address, type Hex, keccak256, toBytes } from "viem";
import {
  type Ctx,
  chainTime,
  ctxFromKeyEnv,
  errorMessage,
  revertName,
  send,
} from "./lib/chain.ts";
import { loadAbi, loadDeployment, loadEnv, log } from "./lib/config.ts";
import { gpuSpec } from "./lib/gpus.ts";
import { gpuOf } from "./lib/priceModel.ts";
import { HOURS_PER_WEEK, isoWeek, upcomingMondays } from "./lib/weeks.ts";

loadEnv();

const { values } = parseArgs({
  options: {
    feeds: { type: "string", default: "H100" },
    weeks: { type: "string", default: "4" },
    interval: { type: "string", default: "300" },
    once: { type: "boolean", default: false },
  },
});

/** Settlement waits this long past the end of a window if coverage is low (Series gap rule). */
const SETTLE_GRACE = 24 * 3600;
const MIN_COVERAGE_BPS = 9000;

const dep = loadDeployment() as ReturnType<typeof loadDeployment> & { MarketRegistry?: Address };
if (!dep.MarketRegistry) throw new Error("MarketRegistry missing from deployments (run DeployMarketRegistry.s.sol)");
const registryAddress = dep.MarketRegistry;
const oracleAbi = loadAbi("RackOracle");
const factoryAbi = loadAbi("SeriesFactory");
const seriesAbi = loadAbi("Series");
const registryAbi = loadAbi("MarketRegistry");
const ctx: Ctx = ctxFromKeyEnv("DEPLOYER_PRIVATE_KEY"); // factory owner; other actions are permissionless
const scope = "keeper";

interface OnchainFeed {
  exists: boolean;
  isDemo: boolean;
  epochLength: number;
  genesis: bigint;
  firstEpoch: bigint;
  nextEpoch: bigint;
}

const read = <T>(address: Address, abi: typeof oracleAbi, functionName: string, args: readonly unknown[] = []) =>
  ctx.pub.readContract({ address, abi, functionName, args }) as Promise<T>;

async function listWeeks(now: bigint): Promise<void> {
  for (const name of values.feeds.split(",").map((s) => s.trim())) {
    const feedId = keccak256(toBytes(name));
    const f = await read<OnchainFeed>(dep.RackOracle, oracleAbi, "getFeed", [feedId]);
    if (!f.exists || f.isDemo || f.epochLength !== 3600) {
      log(scope, `${name}: not an hourly feed, skipping week listing`);
      continue;
    }
    const spec = gpuSpec(gpuOf(name));
    for (const monday of upcomingMondays(now, Number(values.weeks))) {
      if ((monday - f.genesis) % 3600n !== 0n) throw new Error(`${name}: genesis not hour-aligned`);
      const startEpoch = (monday - f.genesis) / 3600n;
      if (startEpoch < f.firstEpoch) continue;
      const existing = await read<Address>(dep.SeriesFactory, factoryAbi, "seriesByStart", [feedId, startEpoch]);
      if (BigInt(existing) !== 0n) continue;

      const { year, week } = isoWeek(monday);
      const ww = String(week).padStart(2, "0");
      await send(ctx, {
        address: dep.SeriesFactory,
        abi: factoryAbi,
        functionName: "createSeries",
        args: [
          {
            feedId,
            startEpoch,
            endEpoch: startEpoch + HOURS_PER_WEEK - 1n,
            floor: spec.floor,
            cap: spec.cap,
            minCoverageBps: MIN_COVERAGE_BPS,
            settleGrace: SETTLE_GRACE,
            label: `${gpuOf(name)} ${year}-W${ww}`,
            symbolStem: `${gpuOf(name)}W${ww}`,
          },
        ],
      });
      log(scope, `${name}: listed ${year}-W${ww} (epochs ${startEpoch}-${startEpoch + HOURS_PER_WEEK - 1n})`);
    }
  }
}

async function allSeries(): Promise<Address[]> {
  const n = await read<bigint>(dep.SeriesFactory, factoryAbi, "seriesCount");
  const out: Address[] = [];
  for (let i = 0n; i < n; i++) out.push(await read<Address>(dep.SeriesFactory, factoryAbi, "allSeries", [i]));
  return out;
}

async function maintainSeries(now: bigint): Promise<void> {
  for (const s of await allSeries()) {
    const [settled, windowEnd, feedId, endEpoch] = await Promise.all([
      read<boolean>(s, seriesAbi, "settled"),
      read<bigint>(s, seriesAbi, "windowEnd"),
      read<Hex>(s, seriesAbi, "feedId"),
      read<bigint>(s, seriesAbi, "endEpoch"),
    ]);
    if (settled) continue;

    // Order book for live series.
    if (now < windowEnd) {
      const book = await read<Address>(registryAddress, registryAbi, "bookOf", [s]);
      if (BigInt(book) === 0n) {
        await send(ctx, { address: registryAddress, abi: registryAbi, functionName: "createMarket", args: [s] });
        const created = await read<Address>(registryAddress, registryAbi, "bookOf", [s]);
        log(scope, `series ${s}: Kuru book ${created}`);
      }
      continue;
    }

    // Settlement once the oracle has finalized the whole window.
    const f = await read<OnchainFeed>(dep.RackOracle, oracleAbi, "getFeed", [feedId]);
    if (f.nextEpoch <= endEpoch) continue;
    try {
      await send(ctx, { address: s, abi: seriesAbi, functionName: "settle" });
      const price = await read<bigint>(s, seriesAbi, "settlementPrice");
      log(scope, `series ${s}: settled at $${(Number(price) / 1e6).toFixed(4)}`);
    } catch (err) {
      const name = revertName(err);
      if (name === "CoverageTooLow") log(scope, `series ${s}: coverage below 90%, waiting for the grace period`);
      else throw err;
    }
  }
}

async function tick(): Promise<void> {
  const now = await chainTime(ctx.pub);
  await listWeeks(now);
  await maintainSeries(now);
}

log(scope, `registry ${registryAddress}, feeds ${values.feeds}, ${values.weeks} weeks ahead`);
if (values.once) {
  await tick();
} else {
  for (;;) {
    try {
      await tick();
    } catch (err) {
      log(scope, `tick failed, retrying next interval: ${errorMessage(err)}`);
    }
    await new Promise((r) => setTimeout(r, Number(values.interval) * 1000));
  }
}
