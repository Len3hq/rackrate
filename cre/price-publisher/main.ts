/**
 * Rackrate price publisher — Chainlink CRE workflow (publisher A of RackOracle).
 *
 * On each cron trigger, for every configured hourly feed:
 *   1. read the feed state, chain time and this publisher's submissions / seed commitments (two Multicall3 reads),
 *   2. compute the index price with the same deterministic model the publisher bots use (secret master seed from
 *      CRE Secrets); from 2026-W42 the hourly H100 level follows real providers' published H100 prices, fetched
 *      through CRE's HTTP capability with the nodes agreeing on the median (bots/src/lib/reference.ts),
 *   3. build a batch of oracle actions (commit due seeds, submit the current epoch, reveal due seeds),
 *   4. sign it as a CRE report and deliver it to CreReceiver through the Chainlink forwarder.
 *
 * Every node computes the same actions from the same finalized chain state and secret, so the report reaches
 * consensus. Testnet: before 2026-W42 (and on demo feeds) the index is simulated, not market data.
 */
import {
  CronCapability,
  EVMClient,
  LAST_FINALIZED_BLOCK_NUMBER,
  Runner,
  TxStatus,
  type Runtime,
  bytesToHex,
  encodeCallMsg,
  getNetwork,
  handler,
  hexToBase64,
} from "@chainlink/cre-sdk";
import {
  type Address,
  type Hex,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toBytes,
  zeroAddress,
} from "viem";
import {
  type Anchor,
  gpuOf,
  paramsFor,
  periodOf,
  periodSeed,
  publisherPrice,
  seedCommitment,
  seedLookahead,
} from "../../bots/src/lib/priceModel.ts";
import { ANCHOR_START, REFERENCE_FEEDS, anchorStartEpoch } from "../../bots/src/lib/reference.ts";
import { referenceLevel } from "./reference-http.ts";

type Config = {
  schedule: string;
  chainName: string;
  oracle: Address;
  receiver: Address;
  multicall3: Address;
  /** Hourly feed names, e.g. ["H100"]. Demo feeds are driven by the publisher bots. */
  feeds: string[];
  /** Gas budget: base overhead plus a per-action allowance (Monad bills the full gas limit). */
  gasBase: number;
  gasPerSubmit: number;
  gasPerCommit: number;
  gasPerReveal: number;
  /** Optional override of the real-price start (unix seconds), for tests. */
  anchorStart?: number;
};

const ActionKind = { Submit: 0, CommitSeed: 1, RevealSeed: 2 } as const;

type Action = { kind: number; feedId: Hex; a: bigint; b: bigint; data: Hex };

type FeedState = {
  exists: boolean;
  isDemo: boolean;
  epochLength: number;
  finalizeDelay: number;
  genesis: bigint;
  nextEpoch: bigint;
};

const oracleAbi = parseAbi([
  "function getFeed(bytes32 feedId) view returns ((bool exists, bool isDemo, uint8 minPublishers, uint8 publisherCount, uint8 consecutiveJumpRejects, uint16 maxJumpBps, uint32 epochLength, uint32 finalizeDelay, uint64 genesis, uint64 firstEpoch, uint64 nextEpoch, uint64 minPrice, uint64 maxPrice, uint64 lastPrice))",
  "function currentEpoch(bytes32 feedId) view returns (uint64)",
  "function hasSubmitted(bytes32 feedId, uint64 epoch, address publisher) view returns (bool)",
  "function seedCommits(bytes32 feedId, uint64 periodId, address publisher) view returns (bytes32 hash, uint64 revealAfter, bool revealed)",
]);

const multicallAbi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);

const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

type Call = { target: Address; callData: Hex };

/** One finalized-block eth_call to Multicall3 that runs several reads. */
function multicall(runtime: Runtime<Config>, evm: EVMClient, calls: Call[]): Hex[] {
  const data = encodeFunctionData({
    abi: multicallAbi,
    functionName: "aggregate3",
    args: [calls.map((c) => ({ target: c.target, allowFailure: false, callData: c.callData }))],
  });
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: runtime.config.multicall3, data }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();
  const results = decodeFunctionResult({
    abi: multicallAbi,
    functionName: "aggregate3",
    data: bytesToHex(reply.data),
  }) as readonly { success: boolean; returnData: Hex }[];
  return results.map((r) => r.returnData);
}

function oracleCall(cfg: Config, functionName: string, args: readonly unknown[]): Call {
  return {
    target: cfg.oracle,
    callData: encodeFunctionData({ abi: oracleAbi, functionName: functionName as never, args: args as never }),
  };
}

function decode<T>(functionName: string, data: Hex): T {
  return decodeFunctionResult({ abi: oracleAbi, functionName: functionName as never, data }) as T;
}

/** Builds this publisher's actions for one feed. */
function actionsForFeed(runtime: Runtime<Config>, evm: EVMClient, feedName: string, master: Hex): Action[] {
  const cfg = runtime.config;
  const me = cfg.receiver;
  const feedId = keccak256(toBytes(feedName));

  // Read 1: feed state, current epoch, chain time.
  const [feedRaw, curRaw, tsRaw] = multicall(runtime, evm, [
    oracleCall(cfg, "getFeed", [feedId]),
    oracleCall(cfg, "currentEpoch", [feedId]),
    {
      target: cfg.multicall3,
      callData: encodeFunctionData({ abi: multicallAbi, functionName: "getCurrentBlockTimestamp" }),
    },
  ]);
  const feed = decode<FeedState>("getFeed", feedRaw);
  if (!feed.exists) {
    runtime.log(`${feedName}: feed not found, skipping`);
    return [];
  }
  if (feed.isDemo) {
    runtime.log(`${feedName}: demo feeds are published by the bots, skipping`);
    return [];
  }
  const cur = decode<bigint>("currentEpoch", curRaw);
  const now = decodeFunctionResult({ abi: multicallAbi, functionName: "getCurrentBlockTimestamp", data: tsRaw }) as bigint;

  const params = paramsFor(feedName, feed.isDemo);
  const len = BigInt(feed.epochLength);
  const period = BigInt(params.periodEpochs);
  const lookahead = BigInt(seedLookahead(params));
  const p = periodOf(cur, params.periodEpochs);
  const seedFor = (q: bigint) => periodSeed(master, feedId, q);

  const commitRange: bigint[] = [];
  for (let q = p; q <= p + lookahead; q++) commitRange.push(q);
  const revealRange: bigint[] = [];
  for (let q = p - 1n; q >= 0n && q >= p - 2n * lookahead - 2n; q--) revealRange.push(q);
  // Backfill the previous epoch only while it can still count (before its finalize delay has passed).
  const epochs: bigint[] = [cur];
  if (cur > 0n && cur - 1n >= feed.nextEpoch && now < feed.genesis + cur * len + BigInt(feed.finalizeDelay)) {
    epochs.unshift(cur - 1n);
  }

  // Read 2: our submissions and seed commitments.
  const reads = multicall(runtime, evm, [
    ...epochs.map((e) => oracleCall(cfg, "hasSubmitted", [feedId, e, me])),
    ...commitRange.map((q) => oracleCall(cfg, "seedCommits", [feedId, q, me])),
    ...revealRange.map((q) => oracleCall(cfg, "seedCommits", [feedId, q, me])),
  ]);
  const submitted = reads.slice(0, epochs.length).map((d) => decode<boolean>("hasSubmitted", d));
  const commits = reads
    .slice(epochs.length)
    .map((d) => decode<readonly [Hex, bigint, boolean]>("seedCommits", d));
  const ahead = commits.slice(0, commitRange.length);
  const past = commits.slice(commitRange.length);

  const actions: Action[] = [];
  // 1. Commit every seed the current price depends on (commit before use).
  commitRange.forEach((q, i) => {
    if (ahead[i][0] !== ZERO_HASH) return;
    const revealAfter = feed.genesis + ((q + 1n) * period + 1n) * len;
    actions.push({ kind: ActionKind.CommitSeed, feedId, a: q, b: revealAfter, data: seedCommitment(seedFor(q)) });
  });
  // 2. Submit prices for open epochs (never for an epoch other publishers already finalized).
  const real = REFERENCE_FEEDS.has(gpuOf(feedName));
  const anchorFrom = anchorStartEpoch(feed.genesis, len, cfg.anchorStart ?? ANCHOR_START);
  const memo = new Map<string, number | null>();
  epochs.forEach((e, i) => {
    if (submitted[i] || e < feed.nextEpoch) return;
    let anchor: Anchor | undefined;
    if (real && e >= anchorFrom) {
      const epochStart = Number(feed.genesis + e * len);
      const level = referenceLevel(runtime, epochStart, memo);
      if (level === null) {
        runtime.log(`${feedName}: epoch ${e}: reference prices unavailable, not submitting`);
        return;
      }
      anchor = { from: anchorFrom, level, epochStart };
    }
    const price = publisherPrice(seedFor, params, e, me, 0, anchor);
    actions.push({ kind: ActionKind.Submit, feedId, a: e, b: price, data: ZERO_HASH });
    runtime.log(`${feedName}: epoch ${e} price $${(Number(price) / 1e6).toFixed(4)}${anchor ? ` (real level $${anchor.level.toFixed(4)})` : ""}`);
  });
  // 3. Reveal seeds whose reveal time has passed.
  revealRange.forEach((q, i) => {
    const [hash, revealAfter, revealed] = past[i];
    if (hash === ZERO_HASH || revealed || now < revealAfter) return;
    actions.push({ kind: ActionKind.RevealSeed, feedId, a: q, b: 0n, data: seedFor(q) });
  });
  return actions;
}

const onCronTrigger = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainName });
  if (!network) throw new Error(`Unknown chain ${cfg.chainName}`);
  const evm = new EVMClient(network.chainSelector.selector);

  const master = runtime.getSecret({ id: "PRICE_MASTER_SECRET" }).result().value as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(master)) throw new Error("PRICE_MASTER_SECRET must be 32-byte hex");

  const actions = cfg.feeds.flatMap((f) => actionsForFeed(runtime, evm, f, master));
  if (actions.length === 0) {
    runtime.log("Nothing to publish this run");
    return "noop";
  }

  const payload = encodeAbiParameters(parseAbiParameters("(uint8 kind, bytes32 feedId, uint64 a, uint64 b, bytes32 data)[]"), [
    actions,
  ]);
  const count = (k: number) => actions.filter((x) => x.kind === k).length;
  const gasLimit =
    cfg.gasBase +
    count(ActionKind.Submit) * cfg.gasPerSubmit +
    count(ActionKind.CommitSeed) * cfg.gasPerCommit +
    count(ActionKind.RevealSeed) * cfg.gasPerReveal;

  const report = runtime
    .report({ encodedPayload: hexToBase64(payload), encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256" })
    .result();
  const write = evm
    .writeReport(runtime, { receiver: cfg.receiver, report, gasConfig: { gasLimit: String(gasLimit) } })
    .result();

  const txHash = bytesToHex(write.txHash || new Uint8Array(32));
  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Report delivery failed (status ${write.txStatus}): ${write.errorMessage ?? ""} tx ${txHash}`);
  }
  runtime.log(`Delivered ${actions.length} action(s) with gas limit ${gasLimit}: tx ${txHash}`);
  return txHash;
};

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
