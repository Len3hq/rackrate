/**
 * Demo session tool. Each session gets a fresh 30-second demo feed (so no backlog of idle epochs),
 * its publishers, and one demo series that settles in minutes.
 *
 *   node src/demo.ts start [--gpu H100] [--epochs 20]
 *   node src/demo.ts scenario <spike|crash|reset>
 *   node src/demo.ts status
 *   node src/demo.ts settle
 *
 * Owner actions use DEPLOYER_PRIVATE_KEY. Publisher addresses come from PUBLISHER_B_PRIVATE_KEY and
 * PUBLISHER_C_PRIVATE_KEY (override with --publishers 0xA,0xB).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Address, type Hex, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainTime, ctxFromKeyEnv, send } from "./lib/chain.ts";
import { ROOT, env, loadAbi, loadDeployment, loadEnv, log } from "./lib/config.ts";
import { gpuSpec } from "./lib/gpus.ts";
import { SCENARIO } from "./lib/priceModel.ts";

loadEnv();

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    gpu: { type: "string", default: "H100" },
    epochs: { type: "string", default: "20" },
    publishers: { type: "string" },
  },
});

const SESSION_FILE = resolve(ROOT, "bots", ".demo-session.json");
const DEMO_TICK = 30n;
const STATUS = ["Open", "Printed", "Missing", "RejectedBounds", "RejectedJump"];

interface Session {
  feedName: string;
  feedId: Hex;
  series: Address;
  book: Address;
  startEpoch: string;
  endEpoch: string;
  fromBlock: string;
}

const dep = loadDeployment();
const oracleAbi = loadAbi("RackOracle");
const factoryAbi = loadAbi("SeriesFactory");
const seriesAbi = loadAbi("Series");
const registryAbi = loadAbi("MarketRegistry");
const owner = ctxFromKeyEnv("DEPLOYER_PRIVATE_KEY");

const oracle = (functionName: string, args: readonly unknown[], extraGas?: bigint) =>
  send(owner, { address: dep.RackOracle, abi: oracleAbi, functionName, args, extraGas });
const readOracle = <T>(functionName: string, args: readonly unknown[]) =>
  owner.pub.readContract({ address: dep.RackOracle, abi: oracleAbi, functionName, args }) as Promise<T>;

function loadSession(): Session {
  if (!existsSync(SESSION_FILE)) throw new Error("No demo session. Run `node src/demo.ts start` first.");
  return JSON.parse(readFileSync(SESSION_FILE, "utf8")) as Session;
}

function publisherAddresses(): Address[] {
  if (values.publishers) return values.publishers.split(",").map((a) => a.trim() as Address);
  return ["PUBLISHER_B_PRIVATE_KEY", "PUBLISHER_C_PRIVATE_KEY"].map(
    (k) => privateKeyToAccount(env(k) as Hex).address,
  );
}

async function start(): Promise<void> {
  const gpu = values.gpu.toUpperCase();
  const spec = gpuSpec(gpu);
  const epochs = BigInt(values.epochs);
  const now = await chainTime(owner.pub);
  const feedName = `${gpu}_DEMO_${now}`;
  const feedId = keccak256(toBytes(feedName));
  const fromBlock = await owner.pub.getBlockNumber();

  await oracle("createFeed", [
    feedId,
    {
      genesis: now - (now % DEMO_TICK),
      epochLength: Number(DEMO_TICK),
      finalizeDelay: 10,
      minPublishers: 2,
      maxJumpBps: 5000,
      minPrice: spec.oracleMin,
      maxPrice: spec.oracleMax,
      isDemo: true,
    },
  ]);
  log("demo", `created feed ${feedName}`);
  for (const p of publisherAddresses()) {
    await oracle("setPublisher", [feedId, p, true]);
    log("demo", `publisher ${p} allowlisted`);
  }

  // Start two epochs out so publishers have time to commit seeds before the first print.
  const cur = await readOracle<bigint>("currentEpoch", [feedId]);
  const startEpoch = cur + 2n;
  const endEpoch = startEpoch + epochs - 1n;
  await send(owner, {
    address: dep.SeriesFactory,
    abi: factoryAbi,
    functionName: "createSeries",
    args: [
      {
        feedId,
        startEpoch,
        endEpoch,
        floor: spec.floor,
        cap: spec.cap,
        minCoverageBps: 9000,
        settleGrace: 120,
        label: `${gpu} DEMO ${now}`,
        symbolStem: `${gpu}D${now % 100000n}`,
      },
    ],
  });
  const series = (await owner.pub.readContract({
    address: dep.SeriesFactory,
    abi: factoryAbi,
    functionName: "seriesByStart",
    args: [feedId, startEpoch],
  })) as Address;

  const registry = (dep as typeof dep & { MarketRegistry: Address }).MarketRegistry;
  await send(owner, { address: registry, abi: registryAbi, functionName: "createMarket", args: [series] });
  const book = (await owner.pub.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "bookOf",
    args: [series],
  })) as Address;
  log("demo", `Kuru order book ${book}`);

  const session: Session = {
    feedName,
    feedId,
    series,
    book,
    startEpoch: startEpoch.toString(),
    endEpoch: endEpoch.toString(),
    fromBlock: fromBlock.toString(),
  };
  writeFileSync(SESSION_FILE, `${JSON.stringify(session, null, 2)}\n`);
  log("demo", `series ${series}: epochs ${startEpoch}-${endEpoch} (~${(Number(epochs) * 30) / 60} min)`);
  log("demo", `run publishers with: --feeds ${feedName} --from-block ${fromBlock}`);
}

async function scenario(kindName: string): Promise<void> {
  const kind = SCENARIO[kindName as keyof typeof SCENARIO];
  if (kind === undefined) throw new Error(`Scenario must be one of ${Object.keys(SCENARIO).join(", ")}`);
  const s = loadSession();
  await oracle("scenario", [s.feedId, kind]);
  log("demo", `scenario "${kindName}" logged on ${s.feedName}`);
}

async function status(): Promise<void> {
  const s = loadSession();
  const now = await chainTime(owner.pub);
  const cur = await readOracle<bigint>("currentEpoch", [s.feedId]);
  log("demo", `${s.feedName} current epoch ${cur} (chain time ${now})`);
  for (let e = BigInt(s.startEpoch); e <= BigInt(s.endEpoch) && e <= cur; e++) {
    const [st, count, price] = await readOracle<[number, number, bigint]>("getEpoch", [s.feedId, e]);
    console.log(`  epoch ${e}: ${STATUS[st].padEnd(14)} submissions ${count}  price $${(Number(price) / 1e6).toFixed(4)}`);
  }
  const read = (fn: string) =>
    owner.pub.readContract({ address: s.series, abi: seriesAbi, functionName: fn, args: [] });
  const settled = (await read("settled")) as boolean;
  console.log(`  series ${s.series}: ${settled ? `settled at $${(Number(await read("settlementPrice")) / 1e6).toFixed(4)}` : "not settled"}`);
}

async function settle(): Promise<void> {
  const s = loadSession();
  if (await readOracle<boolean>("canFinalize", [s.feedId])) await oracle("finalize", [s.feedId, 100n]);
  await send(owner, { address: s.series, abi: seriesAbi, functionName: "settle", args: [] });
  const price = await owner.pub.readContract({ address: s.series, abi: seriesAbi, functionName: "settlementPrice" });
  log("demo", `series settled at $${(Number(price) / 1e6).toFixed(4)}`);
}

const [cmd, arg] = positionals;
const commands: Record<string, () => Promise<void>> = {
  start,
  scenario: () => scenario(arg),
  status,
  settle,
};
if (!commands[cmd]) {
  console.error("Usage: node src/demo.ts <start|scenario <spike|crash|reset>|status|settle>");
  process.exit(1);
}
await commands[cmd]();
