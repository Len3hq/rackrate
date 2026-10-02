/**
 * Independent audit of a feed: re-derives every publisher's submitted price from the seeds revealed onchain
 * (plus any logged demo scenarios) and reports matches. Needs no secrets, only public chain data.
 *
 *   node src/audit.ts --feed H100_DEMO_1790925309 --from-block 67481015
 *
 * A submission is "unverifiable" until every seed it depends on (its period plus lookahead) is revealed.
 */
import { parseArgs } from "node:util";
import { type AbiEvent, type Address, type Hex, keccak256, parseAbiItem, toBytes } from "viem";
import { publicClient } from "./lib/chain.ts";
import { loadAbi, loadDeployment, loadEnv } from "./lib/config.ts";
import { paramsFor, periodOf, publisherPrice, scenarioKindAt, seedLookahead } from "./lib/priceModel.ts";

loadEnv();

const { values } = parseArgs({
  options: {
    feed: { type: "string" },
    "from-block": { type: "string" },
  },
});
if (!values.feed || !values["from-block"]) {
  console.error("Usage: node src/audit.ts --feed <name> --from-block <block>");
  process.exit(1);
}

const LOG_CHUNK = 100n;
const dep = loadDeployment();
const pub = publicClient();
const feedName = values.feed;
const feedId = keccak256(toBytes(feedName));

const events = {
  submitted: parseAbiItem(
    "event PriceSubmitted(bytes32 indexed feedId, uint64 indexed epoch, address indexed publisher, uint64 price)",
  ),
  revealed: parseAbiItem(
    "event SeedRevealed(bytes32 indexed feedId, uint64 indexed periodId, address indexed publisher, bytes32 seed)",
  ),
  scenario: parseAbiItem("event Scenario(bytes32 indexed feedId, uint64 indexed epoch, uint8 kind)"),
};

type DecodedLog = { args: Record<string, unknown> };

async function logsOf(event: AbiEvent): Promise<DecodedLog[]> {
  const latest = await pub.getBlockNumber();
  const out: DecodedLog[] = [];
  for (let from = BigInt(values["from-block"] as string); from <= latest; from += LOG_CHUNK) {
    const to = from + LOG_CHUNK - 1n < latest ? from + LOG_CHUNK - 1n : latest;
    const logs = await pub.getLogs({
      address: dep.RackOracle,
      event,
      args: { feedId } as never,
      fromBlock: from,
      toBlock: to,
    });
    out.push(...(logs as unknown as DecodedLog[]));
  }
  return out;
}

const feed = (await pub.readContract({
  address: dep.RackOracle,
  abi: loadAbi("RackOracle"),
  functionName: "getFeed",
  args: [feedId],
})) as { exists: boolean; isDemo: boolean };
if (!feed.exists) throw new Error(`Feed ${feedName} not found`);

const params = paramsFor(feedName, feed.isDemo);
const lookahead = BigInt(seedLookahead(params));
const [submitted, revealed, scenarioLogs] = await Promise.all([
  logsOf(events.submitted),
  logsOf(events.revealed),
  logsOf(events.scenario),
]);

const seeds = new Map<string, Hex>(); // `${publisher}:${period}` -> seed
for (const l of revealed) seeds.set(`${(l.args.publisher as Address).toLowerCase()}:${l.args.periodId}`, l.args.seed as Hex);
const scenarios = scenarioLogs.map((l) => ({ epoch: l.args.epoch as bigint, kind: Number(l.args.kind) }));

const byPublisher = new Map<string, { match: number; mismatch: number; unverifiable: number }>();
for (const l of submitted) {
  const who = (l.args.publisher as Address).toLowerCase();
  const epoch = l.args.epoch as bigint;
  const stats = byPublisher.get(who) ?? { match: 0, mismatch: 0, unverifiable: 0 };
  byPublisher.set(who, stats);

  const P = periodOf(epoch, params.periodEpochs);
  const needed: bigint[] = [];
  for (let q = P - 1n >= 0n ? P - 1n : 0n; q <= P + lookahead; q++) needed.push(q);
  if (needed.some((q) => !seeds.has(`${who}:${q}`))) {
    stats.unverifiable++;
    continue;
  }
  const expected = publisherPrice((q) => seeds.get(`${who}:${q}`) as Hex, params, epoch, who, scenarioKindAt(scenarios, epoch));
  if (expected === l.args.price) stats.match++;
  else stats.mismatch++;
}

console.log(`Audit of ${feedName}: ${submitted.length} submissions, ${revealed.length} revealed seeds, ${scenarios.length} scenarios`);
for (const [who, s] of byPublisher) {
  console.log(`  ${who}: ${s.match} match, ${s.mismatch} mismatch, ${s.unverifiable} not yet verifiable`);
}
