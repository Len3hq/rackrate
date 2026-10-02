/**
 * Rackrate oracle publisher (simulated testnet index).
 *
 * Every tick, for each configured feed:
 *   1. commit the seed hash for the current and next period (once each),
 *   2. submit this publisher's price for the current epoch (and the previous one if still open),
 *   3. reveal seeds of periods whose reveal time has passed,
 *   4. finalize any finalizable backlog (permissionless).
 *
 * Usage:
 *   node src/publisher.ts --key PUBLISHER_B_PRIVATE_KEY --feeds H100,H200,B200
 *   node src/publisher.ts --key PUBLISHER_C_PRIVATE_KEY --feeds H100_DEMO_1791000000 --rogue
 */
import { parseArgs } from "node:util";
import { type Hex, keccak256, parseAbiItem, toBytes } from "viem";
import { type Ctx, chainTime, ctxFromKeyEnv, errorMessage, revertName, send } from "./lib/chain.ts";
import { env, loadAbi, loadDeployment, loadEnv, log } from "./lib/config.ts";
import {
  paramsFor,
  periodOf,
  periodSeed,
  publisherPrice,
  scenarioKindAt,
  seedCommitment,
  seedLookahead,
} from "./lib/priceModel.ts";

loadEnv();

const { values } = parseArgs({
  options: {
    key: { type: "string", default: "PUBLISHER_B_PRIVATE_KEY" },
    feeds: { type: "string", default: "H100" },
    interval: { type: "string", default: "5" },
    rogue: { type: "boolean", default: false },
    once: { type: "boolean", default: false },
    "from-block": { type: "string" },
  },
});

/** Gas headroom for a submit that also finalizes the epoch (the last publisher in triggers finalization). */
const FINALIZE_HEADROOM = 150_000n;
/** Rogue mode multiplies this publisher's price, to show the median ignoring an outlier. */
const ROGUE_MULT = 13n;
const LOG_CHUNK = 100n;

const master = env("PRICE_MASTER_SECRET") as Hex;
if (!/^0x[0-9a-fA-F]{64}$/.test(master)) throw new Error("PRICE_MASTER_SECRET must be a 32-byte hex value");

const dep = loadDeployment();
const oracleAbi = loadAbi("RackOracle");
const ctx: Ctx = ctxFromKeyEnv(values.key);
const me = ctx.account.address;
const scope = `publisher ${me.slice(0, 8)}`;
const scenarioEvent = parseAbiItem("event Scenario(bytes32 indexed feedId, uint64 indexed epoch, uint8 kind)");

interface FeedState {
  name: string;
  id: Hex;
  scenarios: { epoch: bigint; kind: number }[];
  scannedTo?: bigint;
}

interface OnchainFeed {
  exists: boolean;
  isDemo: boolean;
  epochLength: number;
  genesis: bigint;
  nextEpoch: bigint;
}

const feeds: FeedState[] = values.feeds.split(",").map((name) => ({
  name: name.trim(),
  id: keccak256(toBytes(name.trim())),
  scenarios: [],
}));

function read<T>(functionName: string, args: readonly unknown[]): Promise<T> {
  return ctx.pub.readContract({ address: dep.RackOracle, abi: oracleAbi, functionName, args }) as Promise<T>;
}

/**
 * Reverts caused by another publisher acting between our read and our send (e.g. it finalized the epoch
 * first). Expected with several publishers; the next tick sees the new state.
 */
const RACE_REVERTS = new Set(["EpochAlreadyFinalized", "AlreadySubmitted", "SeedAlreadyCommitted", "SeedAlreadyRevealed"]);

/** Sends a transaction; returns false (and logs) if it lost a benign race. */
async function tx(functionName: string, args: readonly unknown[], extraGas?: bigint): Promise<boolean> {
  try {
    await send(ctx, { address: dep.RackOracle, abi: oracleAbi, functionName, args, extraGas });
    return true;
  } catch (err) {
    const name = revertName(err);
    if (name && RACE_REVERTS.has(name)) {
      log(scope, `${functionName} skipped: ${name} (state changed since last read)`);
      return false;
    }
    throw err;
  }
}

async function scanScenarios(feed: FeedState): Promise<void> {
  const latest = await ctx.pub.getBlockNumber();
  let from = feed.scannedTo !== undefined ? feed.scannedTo + 1n : BigInt(values["from-block"] ?? latest - 2000n);
  while (from <= latest) {
    const to = from + LOG_CHUNK - 1n < latest ? from + LOG_CHUNK - 1n : latest;
    const logs = await ctx.pub.getLogs({
      address: dep.RackOracle,
      event: scenarioEvent,
      args: { feedId: feed.id },
      fromBlock: from,
      toBlock: to,
    });
    for (const l of logs) {
      feed.scenarios.push({ epoch: l.args.epoch as bigint, kind: Number(l.args.kind) });
      log(scope, `${feed.name}: scenario kind ${l.args.kind} from epoch ${l.args.epoch}`);
    }
    from = to + 1n;
  }
  feed.scannedTo = latest;
}

async function tickFeed(feed: FeedState, now: bigint): Promise<void> {
  const f = await read<OnchainFeed>("getFeed", [feed.id]);
  if (!f.exists) return log(scope, `${feed.name}: feed does not exist, skipping`);
  if (!(await read<boolean>("isPublisher", [feed.id, me]))) {
    return log(scope, `${feed.name}: not an allowlisted publisher, skipping`);
  }

  const params = paramsFor(feed.name, f.isDemo);
  const len = BigInt(f.epochLength);
  const genesis = BigInt(f.genesis);
  const period = BigInt(params.periodEpochs);
  const cur = (now - genesis) / len;
  const p = periodOf(cur, params.periodEpochs);
  const seedFor = (q: bigint) => periodSeed(master, feed.id, q);

  // 1. Commit seed hashes for every period the current price depends on (commit before use).
  const lookahead = BigInt(seedLookahead(params));
  for (let q = p; q <= p + lookahead; q++) {
    const [hash] = await read<[Hex, bigint, boolean]>("seedCommits", [feed.id, q, me]);
    if (BigInt(hash) !== 0n) continue;
    const revealAfter = genesis + ((q + 1n) * period + 1n) * len;
    if (await tx("commitSeed", [feed.id, q, seedCommitment(seedFor(q)), revealAfter])) {
      log(scope, `${feed.name}: committed seed for period ${q} (reveal after ${revealAfter})`);
    }
  }

  // 2. Submit prices for open epochs.
  if (f.isDemo) await scanScenarios(feed);
  const first = cur - 1n > f.nextEpoch ? cur - 1n : f.nextEpoch;
  for (let e = first; e <= cur; e++) {
    if (await read<boolean>("hasSubmitted", [feed.id, e, me])) continue;
    let price = publisherPrice(seedFor, params, e, me, scenarioKindAt(feed.scenarios, e));
    if (values.rogue) price *= ROGUE_MULT;
    if (await tx("submit", [feed.id, e, price], FINALIZE_HEADROOM)) {
      log(scope, `${feed.name}: epoch ${e} submitted $${(Number(price) / 1e6).toFixed(4)}${values.rogue ? " (rogue)" : ""}`);
    }
  }

  // 3. Reveal seeds of past periods (skips periods this publisher never committed).
  for (let q = p - 1n; q >= 0n && q >= p - 2n * lookahead - 2n; q--) {
    const [hash, revealAfter, revealed] = await read<[Hex, bigint, boolean]>("seedCommits", [feed.id, q, me]);
    if (BigInt(hash) === 0n || revealed || now < revealAfter) continue;
    if (await tx("revealSeed", [feed.id, q, seedFor(q)])) {
      log(scope, `${feed.name}: revealed seed for period ${q}`);
    }
  }

  // 4. Finalize any backlog.
  if (await read<boolean>("canFinalize", [feed.id])) {
    try {
      if (await tx("finalize", [feed.id, 50n])) {
        log(scope, `${feed.name}: finalized pending epochs`);
      }
    } catch (err) {
      log(scope, `${feed.name}: finalize skipped (${errorMessage(err)})`);
    }
  }
}

async function tick(): Promise<void> {
  const now = await chainTime(ctx.pub);
  for (const feed of feeds) {
    try {
      await tickFeed(feed, now);
    } catch (err) {
      log(scope, `${feed.name}: error: ${errorMessage(err)}`);
    }
  }
}

log(scope, `oracle ${dep.RackOracle}, feeds ${feeds.map((f) => f.name).join(", ")}${values.rogue ? ", ROGUE MODE" : ""}`);
if (values.once) {
  await tick();
} else {
  const intervalMs = Number(values.interval) * 1000;
  for (;;) {
    await tick();
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
